import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/tv/painel — o painel das máquinas para a TV da Oficina.
 *
 * A TV manda o crachá no cabeçalho `x-tv-token`; o servidor confere o hash
 * dele em `tv_dispositivos` e devolve o jsonb de `tv_painel_maquinas()`.
 * 401 quando a TV não está pareada ou foi revogada, 503 quando o banco não
 * respondeu — nunca 200 com lista vazia no lugar de um erro.
 *
 * Não há POST: a TV só lê. Quem escreve na oficina é o impressor, logado, pelo
 * botão "Começar".
 *
 * O processamento vive em `tv-painel.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/tv/painel")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { responderPainel } = await import("@/lib/api/tv-painel.server");
        return responderPainel(request);
      },
    },
  },
});
