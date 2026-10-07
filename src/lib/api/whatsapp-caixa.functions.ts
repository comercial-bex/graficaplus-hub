import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Ações da caixa de entrada que ESCREVEM no banco.
 *
 * As funções SQL (whatsapp_assumir, whatsapp_nota…) têm EXECUTE revogado de
 * PUBLIC, anon e authenticated: só o servidor as chama, com a chave de serviço,
 * depois de conferir a permissão de quem pediu pela sessão dele. A função SQL
 * confere de novo (`_wa_exigir_resposta`) — duas trancas.
 */

async function exigir(supabase: any, userId: string, permissao: string) {
  const { data, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _permission: permissao,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Seu perfil não tem a permissão ${permissao.replace(".", " › ")}.`);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const acaoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("assumir"), conversaId: z.string().uuid() }),
  z.object({ acao: z.literal("transferir"), conversaId: z.string().uuid(), para: z.string().uuid() }),
  z.object({
    acao: z.literal("status"),
    conversaId: z.string().uuid(),
    status: z.enum(["aberta", "pendente", "arquivada"]),
  }),
  z.object({
    acao: z.literal("resolver"),
    conversaId: z.string().uuid(),
    motivo: z.enum(["atendido", "sem_resposta_necessaria", "spam", "duplicado", "outro"]),
    nota: z.string().max(1000).optional(),
  }),
  z.object({ acao: z.literal("nota"), conversaId: z.string().uuid(), texto: z.string().min(1).max(4000) }),
  z.object({ acao: z.literal("vincular_orcamento"), conversaId: z.string().uuid(), orcamentoId: z.string().uuid() }),
  z.object({ acao: z.literal("vincular_os"), conversaId: z.string().uuid(), osId: z.string().uuid() }),
  z.object({
    acao: z.literal("transferir_fila"),
    conversaId: z.string().uuid(),
    fila: z.enum(["comercial", "producao", "financeiro", "administrativo"]),
    motivo: z.string().trim().min(3).max(300),
  }),
  z.object({ acao: z.literal("devolver_ia"), conversaId: z.string().uuid() }),
]);

export type AcaoNaConversa = z.infer<typeof acaoSchema>;

export const acaoNaConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => acaoSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.reply");
    const db = (await admin()) as any;
    const u = context.userId;
    let r;
    switch (data.acao) {
      case "assumir":
        r = await db.rpc("whatsapp_assumir", { p_conversa_id: data.conversaId, p_usuario: u });
        break;
      case "transferir":
        r = await db.rpc("whatsapp_transferir", { p_conversa_id: data.conversaId, p_usuario: u, p_para: data.para });
        break;
      case "status":
        r = await db.rpc("whatsapp_mudar_status", { p_conversa_id: data.conversaId, p_usuario: u, p_status: data.status });
        break;
      case "resolver":
        r = await db.rpc("whatsapp_resolver", { p_conversa_id: data.conversaId, p_usuario: u, p_motivo: data.motivo, p_nota: data.nota ?? null });
        break;
      case "nota":
        r = await db.rpc("whatsapp_nota", { p_conversa_id: data.conversaId, p_usuario: u, p_texto: data.texto });
        break;
      case "vincular_orcamento":
        r = await db.rpc("whatsapp_vincular_orcamento", {
          p_conversa_id: data.conversaId,
          p_usuario: u,
          p_orcamento_id: data.orcamentoId,
        });
        break;
      case "vincular_os":
        r = await db.rpc("whatsapp_vincular_os", { p_conversa_id: data.conversaId, p_usuario: u, p_os_id: data.osId });
        break;
      case "transferir_fila":
        r = await db.rpc("whatsapp_transferir_fila", {
          p_conversa_id: data.conversaId,
          p_usuario: u,
          p_fila: data.fila,
          p_motivo: data.motivo,
        });
        break;
      case "devolver_ia":
        r = await db.rpc("whatsapp_devolver_ia", { p_conversa_id: data.conversaId, p_usuario: u });
        break;
    }
    if (r.error) throw new Error(r.error.message);
    const d = (r.data ?? {}) as { cliente_herdado?: boolean };
    return { ok: true, cliente_herdado: d.cliente_herdado === true };
  });

export const enfileirarArquivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversaId: z.string().uuid(),
        tipo: z.enum(["documento", "imagem"]),
        caminho: z.string().min(3).max(500),
        nomeArquivo: z.string().min(1).max(200),
        legenda: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.reply");
    // O arquivo tem de estar na pasta desta conversa: ninguém enfileira
    // um caminho qualquer do bucket.
    if (!data.caminho.startsWith(`caixa/${data.conversaId}/`)) {
      throw new Error("Caminho do arquivo inválido para esta conversa.");
    }
    const db = (await admin()) as any;
    const { data: r, error } = await db.rpc("whatsapp_responder_arquivo", {
      p_conversa_id: data.conversaId,
      p_usuario: context.userId,
      p_tipo: data.tipo,
      p_storage_path: data.caminho,
      p_nome_arquivo: data.nomeArquivo,
      p_legenda: data.legenda ?? null,
    });
    if (error) throw new Error(error.message);
    return r as { mensagem_id: string; fila_id: string };
  });

/**
 * Abrir a conversa marca como lida PARA ESTA PESSOA (whatsapp_conversa_leituras)
 * — e zera o contador global para quem pode responder, como antes. Só precisa
 * ler o WhatsApp: a leitura de cada um é dele.
 */
export const marcarLidaPorMim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversaId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.read");
    const db = (await admin()) as any;
    const { error } = await db.rpc("whatsapp_marcar_lida", { p_conversa_id: data.conversaId, p_usuario: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** As filas (setores) de cada pessoa da equipe. Só o administrador muda. */
export const definirFilasDaPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        usuarioId: z.string().uuid(),
        filas: z.array(z.enum(["comercial", "producao", "financeiro", "administrativo"])).max(4),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = (await admin()) as any;
    const { error } = await db.rpc("whatsapp_definir_filas_usuario", {
      p_admin: context.userId,
      p_usuario_alvo: data.usuarioId,
      p_filas: data.filas,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const configSchema = z.object({
  ia_ativa: z.boolean(),
  horario_inicio: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  horario_fim: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  dias_semana: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  mensagem_fora_horario: z.string().trim().min(5).max(500),
  assinatura: z.string().trim().min(2).max(60),
  endereco: z.string().trim().max(300).nullable(),
  horario_texto: z.string().trim().max(200).nullable(),
});

/** Configurações da assistente de IA e do horário. Exige whatsapp › manage. */
export const salvarConfiguracoesWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    if (data.horario_inicio >= data.horario_fim) throw new Error("O início do horário precisa ser antes do fim.");
    const db = (await admin()) as any;
    const { error } = await db.rpc("whatsapp_salvar_configuracoes", { p_usuario: context.userId, p_config: data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reprocessarMensagensSemTexto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ehAdmin, error } = await (context.supabase.rpc as any)("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    if (!ehAdmin) throw new Error("Só o administrador pode reprocessar mensagens.");
    const db = (await admin()) as any;
    const { data, error: e2 } = await db.rpc("whatsapp_reprocessar_sistema");
    if (e2) throw new Error(e2.message);
    return { corrigidas: Number(data ?? 0) };
  });

/**
 * QR Code da instância, pelo servidor: o token do Z-API nunca vai ao
 * navegador — só a imagem (data URI) e o estado da conexão.
 */
export const qrCodeZapi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigir(context.supabase, context.userId, "whatsapp.manage");
    const { data: inst, error } = await context.supabase
      .from("whatsapp_instancias")
      .select("id, zapi_instance_id, conectado")
      .eq("ativa", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inst) throw new Error("Nenhuma instância cadastrada.");
    if (inst.conectado) return { conectado: true as const, imagem: null, erro: null };
    const token = process.env.ZAPI_TOKEN ?? "";
    const clientToken = process.env.ZAPI_CLIENT_TOKEN ?? "";
    if (!token) return { conectado: false as const, imagem: null, erro: "Token do Z-API não configurado no servidor." };
    try {
      const resp = await fetch(
        `https://api.z-api.io/instances/${inst.zapi_instance_id}/token/${token}/qr-code/image`,
        { headers: clientToken ? { "Client-Token": clientToken } : {} },
      );
      const corpo = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (corpo.connected === true) return { conectado: true as const, imagem: null, erro: null };
      const valor = typeof corpo.value === "string" ? corpo.value : null;
      if (!resp.ok || !valor) {
        return {
          conectado: false as const,
          imagem: null,
          erro: `O Z-API não devolveu o QR Code (${resp.status}): ${String(corpo.error ?? corpo.message ?? "sem detalhe")}`,
        };
      }
      const imagem = valor.startsWith("data:") ? valor : `data:image/png;base64,${valor}`;
      return { conectado: false as const, imagem, erro: null };
    } catch (e) {
      return { conectado: false as const, imagem: null, erro: `Falha ao falar com o Z-API: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
