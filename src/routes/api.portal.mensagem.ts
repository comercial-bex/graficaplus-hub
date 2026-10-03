import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/portal/mensagem — recado do cliente com link para a equipe.
 *
 * Grava uma solicitação aberta em `portal_cliente_solicitacoes`, que aparece na
 * ficha do cliente (aba Portal) e conta em "O que falta de mim" do atendimento.
 *
 * O processamento vive em `portal-link.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/portal/mensagem")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { processarMensagem } = await import("@/lib/api/portal-link.server");
        return processarMensagem(request);
      },
    },
  },
});
