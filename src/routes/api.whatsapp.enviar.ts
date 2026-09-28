import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/enviar — consome a fila e manda pelo Z-API.
 *
 * O par que faltava do webhook. A entrada (receber) estava pronta desde
 * setembro; a saída não existia: `whatsapp_fila_envio` era escrita pela tela
 * de monitor e lida por ninguém.
 *
 * GET responde a saúde do envio, dizendo se o servidor tem as credenciais —
 * sem mostrar nenhuma. É o que separa "não configurei" de "configurei e não
 * sai", e essa distinção é metade do trabalho de achar o problema.
 *
 * O processamento vive em `whatsapp-enviar.server.ts`, importado dentro do
 * handler para o token nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/whatsapp/enviar")({
  server: {
    handlers: {
      GET: async () => {
        const { saudeDoEnvio } = await import("@/lib/api/whatsapp-enviar.server");
        return saudeDoEnvio();
      },
      POST: async ({ request }) => {
        const { processarFilaZapi } = await import("@/lib/api/whatsapp-enviar.server");
        return processarFilaZapi(request);
      },
    },
  },
});
