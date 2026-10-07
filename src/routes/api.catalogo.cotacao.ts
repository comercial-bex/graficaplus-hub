import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/catalogo/cotacao — o cliente pede cotação do carrinho pelo link
 * da vitrine (/catalogo/$token).
 *
 * O token vem no cabeçalho `x-catalogo-token`; o corpo é {nome, telefone,
 * itens:[{codigo, modalidade, quantidade}]}. O servidor confere a forma, manda
 * ao banco só o hash do token e o hash da origem, e `catalogo_link_pedir_cotacao`
 * grava o pedido com freio por origem e por link. 200 registrado; 429 muitos
 * pedidos; 400 pedido fora da forma; 401 link que não abre; 503 banco fora.
 *
 * O processamento vive em `catalogo-cotacao.server.ts`, importado dentro do
 * handler para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/catalogo/cotacao")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { responderCotacao } = await import("@/lib/api/catalogo-cotacao.server");
        return responderCotacao(request);
      },
    },
  },
});
