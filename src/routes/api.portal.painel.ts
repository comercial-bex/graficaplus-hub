import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/portal/painel — o que o cliente com link vê em /publico/$token.
 *
 * O token vem no cabeçalho `x-portal-token`; o servidor manda ao banco só o
 * SHA-256 dele e devolve o jsonb de `portal_link_abrir()` sem mexer: OS do
 * cliente, artes esperando aprovação, orçamentos para responder e o que ele já
 * mandou — lista fechada de chaves, sem custo nem margem. 401 para link
 * inválido, vencido ou cancelado; 503 quando o banco não respondeu.
 *
 * O processamento vive em `portal-link.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/portal/painel")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { responderPainel } = await import("@/lib/api/portal-link.server");
        return responderPainel(request);
      },
    },
  },
});
