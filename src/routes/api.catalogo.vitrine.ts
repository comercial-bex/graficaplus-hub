import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/catalogo/vitrine — o catálogo que o cliente abre em /catalogo/$token.
 *
 * O token vem no cabeçalho `x-catalogo-token`; o servidor manda ao banco só o
 * SHA-256 dele e devolve a vitrine de `catalogo_link_abrir()` com lista
 * fechada de chaves: foto, nome, especificação, código BX e preço de venda —
 * sem fornecedor, sem custo. 401 para link inválido, vencido ou cancelado; 503
 * quando o banco não respondeu.
 *
 * O processamento vive em `catalogo-link.server.ts`, importado dentro do
 * handler para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/catalogo/vitrine")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { responderVitrine } = await import("@/lib/api/catalogo-link.server");
        return responderVitrine(request);
      },
    },
  },
});
