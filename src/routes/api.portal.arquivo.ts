import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/portal/arquivo — URL assinada (10 minutos) para o cliente com link
 * ver a arte ou baixar um arquivo/PDF do pedido dele.
 *
 * O banco (`portal_link_objeto`) decide se o arquivo é deste cliente e devolve
 * o caminho; o navegador nunca escolhe caminho. Comprovante não volta por aqui.
 *
 * O processamento vive em `portal-link.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/portal/arquivo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { processarArquivo } = await import("@/lib/api/portal-link.server");
        return processarArquivo(request);
      },
    },
  },
});
