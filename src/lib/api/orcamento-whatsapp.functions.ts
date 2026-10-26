import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "Enviar pelo sistema": o orçamento sai pelo Z-API, na conversa do cliente,
 * em vez de abrir o wa.me no celular de quem clicou.
 *
 * O botão antigo (wa.me) é um bilhete que a pessoa leva até o WhatsApp dela:
 * não anexa arquivo, não registra na caixa de entrada e não prova que saiu.
 * Aqui a mensagem entra na MESMA fila da caixa (`whatsapp_fila_envio`) — o PDF
 * vai como documento, o link de aprovação vai na legenda, e o histórico fica na
 * conversa do cliente.
 *
 * Quem pode: `whatsapp.reply` (as mesmas funções do banco conferem de novo) e
 * `orcamentos.send` (a função que gera o link confere).
 */

async function exigir(supabase: any, userId: string, permissao: string) {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Seu perfil não tem a permissão ${permissao.replace(".", " › ")}.`);
}

export const enviarOrcamentoPeloSistema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        orcamentoId: z.string().uuid(),
        origem: z.string().url(),
        /** Caminho (bucket documentos-pdf) do PDF já gerado; sem ele vai só o texto com o link. */
        pdfCaminho: z.string().min(3).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.reply");

    // 1. O link do cliente (a função do banco confere orcamentos.send).
    const { data: token, error: erroLink } = await (context.supabase.rpc as any)("orcamento_link_publico", {
      p_orcamento_id: data.orcamentoId,
    });
    if (erroLink) throw new Error(erroLink.message || "Não foi possível gerar o link do cliente.");
    if (typeof token !== "string" || !token) throw new Error("O banco não devolveu o link do cliente.");
    const link = `${new URL(data.origem).origin}/orcamento-publico/${token}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // 2. Para quem vai: o telefone do orçamento, ou o do cadastro do cliente.
    const { data: orc, error: erroOrc } = await db
      .from("orcamentos")
      .select("id, numero, titulo, contato_nome, contato_telefone, cliente_id")
      .eq("id", data.orcamentoId)
      .maybeSingle();
    if (erroOrc) throw new Error(erroOrc.message);
    if (!orc) throw new Error("Orçamento não encontrado.");

    let telefone: string = String(orc.contato_telefone ?? "").trim();
    let nome: string | null = orc.contato_nome ?? null;
    if (orc.cliente_id) {
      const { data: cli } = await db
        .from("clientes")
        .select("nome, whatsapp_principal, telefone")
        .eq("id", orc.cliente_id)
        .maybeSingle();
      if (!telefone) telefone = String(cli?.whatsapp_principal || cli?.telefone || "").trim();
      nome = nome || cli?.nome || null;
    }
    if (!telefone) {
      throw new Error("Sem telefone: preencha o celular no orçamento ou no cadastro do cliente.");
    }

    // 3. A conversa desse número (acha a existente ou abre uma vazia).
    const { data: conversa, error: erroConversa } = await db.rpc("whatsapp_conversa_do_numero", {
      p_telefone: telefone,
      p_nome: nome,
      p_usuario: context.userId,
    });
    if (erroConversa) throw new Error(erroConversa.message);
    const conversaId = (conversa as { id: string }).id;

    const texto = `Olá! Segue o orçamento nº ${orc.numero} — ${orc.titulo}.\nVocê pode conferir e aprovar por aqui: ${link}`;

    // 4a. Com PDF: copia para a pasta da conversa e enfileira como documento.
    if (data.pdfCaminho) {
      if (!data.pdfCaminho.startsWith(`orcamento/${data.orcamentoId}/`)) {
        throw new Error("Caminho do PDF inválido para este orçamento.");
      }
      const { data: arquivo, error: erroBaixa } = await db.storage.from("documentos-pdf").download(data.pdfCaminho);
      if (erroBaixa || !arquivo) throw new Error(erroBaixa?.message || "Não consegui ler o PDF gerado.");
      const nomeArquivo = `orcamento-${orc.numero}.pdf`;
      const destino = `caixa/${conversaId}/${Date.now()}-${nomeArquivo}`;
      const { error: erroSobe } = await db.storage
        .from("whatsapp-midias")
        .upload(destino, arquivo, { contentType: "application/pdf", upsert: false });
      if (erroSobe) throw new Error(erroSobe.message);

      const { data: r, error } = await db.rpc("whatsapp_responder_arquivo", {
        p_conversa_id: conversaId,
        p_usuario: context.userId,
        p_tipo: "documento",
        p_storage_path: destino,
        p_nome_arquivo: nomeArquivo,
        p_legenda: texto,
      });
      if (error) throw new Error(error.message);
      return { conversaId, filaId: (r as { fila_id: string }).fila_id, comPdf: true, link };
    }

    // 4b. Sem PDF: só o texto com o link, na mesma fila.
    const { data: msg, error: erroMsg } = await db
      .from("whatsapp_mensagens")
      .insert({
        conversa_id: conversaId,
        instancia_id: (await db.from("whatsapp_conversas").select("instancia_id").eq("id", conversaId).single()).data
          ?.instancia_id,
        direcao: "saida",
        tipo: "texto",
        status: "pendente",
        texto,
        enviada_por: context.userId,
        origem: "humano",
        payload: { origem: "orcamento" },
      })
      .select("id")
      .single();
    if (erroMsg) throw new Error(erroMsg.message);
    const { data: fila, error: erroFila } = await db
      .from("whatsapp_fila_envio")
      .insert({
        conversa_id: conversaId,
        mensagem_id: msg.id,
        payload: { tipo: "texto", texto },
        status: "pendente",
        idempotency_key: `orcamento:${msg.id}`,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (erroFila) throw new Error(erroFila.message);
    await db
      .from("whatsapp_conversas")
      .update({ ultima_mensagem: texto.slice(0, 500), ultima_mensagem_at: new Date().toISOString(), nao_lidas: 0 })
      .eq("id", conversaId);
    return { conversaId, filaId: fila.id as string, comPdf: false, link };
  });
