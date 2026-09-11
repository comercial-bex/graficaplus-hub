import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/webhook?token=... — o endereço que se cola no painel do
 * Z-API (Webhooks: "Ao receber", "Status da mensagem", "Ao conectar" e "Ao
 * desconectar").
 *
 * O receptor anterior era um `createServerFn`: função interna do app, com URL
 * de hash e envelope próprio. O Z-API manda o JSON dele para uma URL fixa, e
 * essa URL não existia — por isso zero mensagens e zero leads desde sempre.
 *
 * GET responde sem efeito colateral: serve para confirmar que a rota está
 * publicada.
 *
 * O processamento vive em `whatsapp-webhook.server.ts`, importado dentro do
 * handler para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async () => {
        const { saudeDoWebhook } = await import("@/lib/api/whatsapp-webhook.server");
        return saudeDoWebhook();
      },
      POST: async ({ request }) => {
        const { processarWebhookZapi } = await import("@/lib/api/whatsapp-webhook.server");
        return processarWebhookZapi(request);
      },
    },
  },
});
