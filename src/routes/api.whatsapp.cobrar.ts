import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/cobrar: a rodada da cobrança de orçamento no grupo da equipe.
 *
 * Quem chama é o job `whatsapp-cobrar` do pg_cron (migração 20261112110000), a cada 5 minutos,
 * com o MESMO token do despachante no cabeçalho `x-despachante-token` (Vault do banco ou a
 * variável DESPACHANTE_TOKEN). Token errado ou ausente: 401, e nada é lido.
 *
 * O processamento vive em `whatsapp-cobranca.server.ts`, importado dentro do handler para a chave
 * de serviço nunca entrar no pacote do navegador. Sem GET: a situação aparece no Monitor do
 * WhatsApp, lida do histórico `whatsapp_cobrancas`.
 */
function json(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/whatsapp/cobrar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tokenDoServidorConfere } = await import("@/lib/api/whatsapp-enviar.server");
        if (!(await tokenDoServidorConfere(request))) return json(401, { ok: false, erro: "token inválido" });

        try {
          const { rodadaDeCobranca } = await import("@/lib/api/whatsapp-cobranca.server");
          return json(200, { ...(await rodadaDeCobranca()) });
        } catch (e) {
          return json(500, { ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
