import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ResultadoDoReprocesso =
  | { ok: true; caminho: string; reaproveitada: boolean; mensagem_id: string }
  | { ok: false; erro: string };

/**
 * "Reprocessar mídia" do Monitor: refaz a cópia da mídia de um evento do
 * webhook que ficou "processado com falha".
 *
 * Quem pode: `whatsapp.manage`, conferido no banco (`has_permission`) com a
 * chave de serviço — a mesma régua de `whatsapp-enviar.server.ts`. O
 * `.server` é importado dentro do handler para a chave nunca entrar no
 * pacote do navegador.
 */
export const reprocessarMidiaDoEvento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventoId: string }) => {
    if (!input || typeof input.eventoId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.eventoId)) {
      throw new Error("Evento inválido.");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<ResultadoDoReprocesso> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pode, error: erroPermissao } = await supabaseAdmin.rpc("has_permission", {
      _user_id: context.userId,
      _permission: "whatsapp.manage",
    });
    if (erroPermissao) {
      throw new Error(`Não foi possível conferir a permissão: ${erroPermissao.message}`);
    }
    if (pode !== true) {
      throw new Error("Reprocessar mídia exige a permissão whatsapp › manage.");
    }

    const { reprocessarMidia } = await import("@/lib/api/whatsapp-webhook.server");
    return reprocessarMidia(data.eventoId);
  });
