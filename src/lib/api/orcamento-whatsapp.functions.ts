import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { brCodePix } from "@/domain/pagamento/pix";
import { mensagensDoPix, pedidoDeSinal } from "@/domain/pagamento/sinal";

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
 * Desde 27/10/2026 (decisão do dono) vai junto o Pix do SINAL: o QR Code com o
 * valor e o copia e cola, pedindo o comprovante de volta. O comprovante que o
 * cliente manda pela mesma conversa é reconhecido pelo webhook e vira anexo do
 * orçamento (`anexar_comprovante_recebido`).
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

type Orc = {
  id: string;
  numero: number;
  titulo: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  cliente_id: string | null;
  valor_total: number | string | null;
  condicao_pagamento: Record<string, unknown> | null;
};

/** Enfileira um texto na conversa, na mesma fila da caixa (a ordem de saída é a de criação). */
async function enfileirarTexto(db: any, conversaId: string, usuarioId: string, texto: string, origem: string) {
  const { data: c } = await db.from("whatsapp_conversas").select("instancia_id").eq("id", conversaId).single();
  const { data: msg, error: erroMsg } = await db
    .from("whatsapp_mensagens")
    .insert({
      conversa_id: conversaId,
      instancia_id: c?.instancia_id,
      direcao: "saida",
      tipo: "texto",
      status: "pendente",
      texto,
      enviada_por: usuarioId,
      origem: "humano",
      payload: { origem },
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
      idempotency_key: `${origem}:${msg.id}`,
      created_by: usuarioId,
    })
    .select("id")
    .single();
  if (erroFila) throw new Error(erroFila.message);
  await db
    .from("whatsapp_conversas")
    .update({ ultima_mensagem: texto.slice(0, 500), ultima_mensagem_at: new Date().toISOString(), nao_lidas: 0 })
    .eq("id", conversaId);
  return fila.id as string;
}

/** O Pix do sinal: QR Code (imagem) com o copia e cola na legenda, na mesma conversa. */
async function enviarPixDoSinal(
  db: any,
  orc: Orc,
  conversaId: string,
  clienteNome: string | null,
  usuarioId: string,
): Promise<{ enviado: boolean; valor: number; motivo: string | null }> {
  const { data: cfg } = await db.from("empresa_config").select("nome, razao_social, cidade, pix_chave").eq("id", true).maybeSingle();
  const chave = String(cfg?.pix_chave ?? "").trim();
  const pedido = pedidoDeSinal({
    total: Number(orc.valor_total ?? 0),
    condicao: orc.condicao_pagamento,
    chaveConfigurada: chave.length > 0,
  });
  if (!pedido.enviar) return { enviado: false, valor: 0, motivo: pedido.motivo };

  const empresa = String(cfg?.nome ?? cfg?.razao_social ?? "BEX PRINT");
  const copiaECola = brCodePix({
    chave,
    valor: pedido.valor,
    nome: empresa,
    cidade: String(cfg?.cidade ?? "Macapa"),
    identificador: `ORC${orc.numero}`,
  });
  const msgs = mensagensDoPix({
    cliente: clienteNome,
    valor: pedido.valor,
    numeroDoOrcamento: orc.numero,
    empresa,
    parcelas: pedido.parcelas,
    copiaECola,
  });

  // O QR Code nasce aqui (no servidor) e sobe para a pasta da conversa: o cliente lê com a câmera do banco.
  const mod: any = await import("qrcode");
  const toBuffer = mod.toBuffer ?? mod.default?.toBuffer;
  const png: Buffer = await toBuffer(copiaECola, { type: "png", width: 512, margin: 2 });
  const nomeArquivo = `pix-orcamento-${orc.numero}.png`;
  const destino = `caixa/${conversaId}/${Date.now()}-${nomeArquivo}`;
  const { error: erroSobe } = await db.storage
    .from("whatsapp-midias")
    .upload(destino, png, { contentType: "image/png", upsert: false });
  if (erroSobe) throw new Error(erroSobe.message);
  const { error } = await db.rpc("whatsapp_responder_arquivo", {
    p_conversa_id: conversaId,
    p_usuario: usuarioId,
    p_tipo: "imagem",
    p_storage_path: destino,
    p_nome_arquivo: nomeArquivo,
    p_legenda: msgs.legendaDoQr,
  });
  if (error) throw new Error(error.message);
  // Depois do QR Code: a apresentação e, SOZINHO, o código para copiar.
  await enfileirarTexto(db, conversaId, usuarioId, msgs.introducao, "pix_sinal");
  await enfileirarTexto(db, conversaId, usuarioId, msgs.codigo, "pix_sinal_codigo");

  // Fica registrado no orçamento: o que foi pedido, quando, e com qual código. É isso que o
  // webhook usa para reconhecer o comprovante e o que a tela mostra como "aguardando".
  const condicao = { ...(orc.condicao_pagamento ?? {}) } as Record<string, unknown>;
  if (!String(condicao.forma ?? "").trim()) condicao.forma = "PIX";
  condicao.pix_enviado = { valor: pedido.valor, em: new Date().toISOString(), copia_e_cola: copiaECola };
  await db.from("orcamentos").update({ condicao_pagamento: condicao }).eq("id", orc.id);
  return { enviado: true, valor: pedido.valor, motivo: null };
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
      .select("id, numero, titulo, contato_nome, contato_telefone, cliente_id, valor_total, condicao_pagamento")
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

    let filaId: string;
    let comPdf = false;
    if (data.pdfCaminho) {
      // 4a. Com PDF: copia para a pasta da conversa e enfileira como documento.
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
      filaId = (r as { fila_id: string }).fila_id;
      comPdf = true;
    } else {
      // 4b. Sem PDF: só o texto com o link, na mesma fila.
      filaId = await enfileirarTexto(db, conversaId, context.userId, texto, "orcamento");
    }

    // 5. O Pix do sinal, logo depois do orçamento. Acessório: se falhar, o orçamento já saiu e
    //    o motivo volta para a tela em vez de derrubar o envio.
    let pix: { enviado: boolean; valor: number; motivo: string | null };
    try {
      pix = await enviarPixDoSinal(db, orc as Orc, conversaId, nome, context.userId);
    } catch (e) {
      pix = { enviado: false, valor: 0, motivo: e instanceof Error ? e.message : String(e) };
    }

    return { conversaId, filaId, comPdf, link, pix };
  });
