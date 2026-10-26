import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mensagem de texto avulsa pelo WhatsApp da gráfica (Z-API), na conversa do número.
 *
 * Os botões "WhatsApp" que abriam o wa.me só deixavam o texto pronto no celular de quem
 * clicou: sem registro, sem prova de envio. Este caminho entra na mesma fila da caixa de
 * entrada (`whatsapp_fila_envio`) e fica no histórico da conversa. Quem clica é quem
 * autoriza o envio; nada sai sozinho. Exige `whatsapp.reply`.
 */
export const enviarTextoPeloSistema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        telefone: z.string().trim().min(8).max(40),
        nome: z.string().trim().max(120).optional(),
        texto: z.string().trim().min(1).max(4000),
        origem: z.string().trim().max(40).default("manual"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: pode, error: erroPermissao } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _permission: "whatsapp.reply",
    });
    if (erroPermissao) throw new Error(erroPermissao.message);
    if (!pode) throw new Error("Seu perfil não tem a permissão whatsapp › reply.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: conversa, error: erroConversa } = await db.rpc("whatsapp_conversa_do_numero", {
      p_telefone: data.telefone,
      p_nome: data.nome || null,
      p_usuario: context.userId,
    });
    if (erroConversa) throw new Error(erroConversa.message);
    const conversaId = (conversa as { id: string }).id;

    const { data: c } = await db.from("whatsapp_conversas").select("instancia_id").eq("id", conversaId).single();
    const { data: msg, error: erroMsg } = await db
      .from("whatsapp_mensagens")
      .insert({
        conversa_id: conversaId,
        instancia_id: c?.instancia_id,
        direcao: "saida",
        tipo: "texto",
        status: "pendente",
        texto: data.texto,
        enviada_por: context.userId,
        origem: "humano",
        payload: { origem: data.origem },
      })
      .select("id")
      .single();
    if (erroMsg) throw new Error(erroMsg.message);
    const { data: fila, error: erroFila } = await db
      .from("whatsapp_fila_envio")
      .insert({
        conversa_id: conversaId,
        mensagem_id: msg.id,
        payload: { tipo: "texto", texto: data.texto },
        status: "pendente",
        idempotency_key: `${data.origem}:${msg.id}`,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (erroFila) throw new Error(erroFila.message);
    await db
      .from("whatsapp_conversas")
      .update({ ultima_mensagem: data.texto.slice(0, 500), ultima_mensagem_at: new Date().toISOString(), nao_lidas: 0 })
      .eq("id", conversaId);
    return { conversaId, filaId: fila.id as string };
  });
