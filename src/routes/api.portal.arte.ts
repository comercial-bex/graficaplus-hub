import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/portal/arte — o cliente com link aprova a arte ou pede ajuste.
 *
 * Só vale para a arte que a equipe mandou para aprovação (pedido aberto em
 * `arquivo_tokens_externos`), de uma OS deste cliente. A decisão passa pelo
 * MESMO miolo do link de aprovação (`decidir_arte_por_token`): grava a
 * resposta, muda o arquivo e anda a OS.
 *
 * O processamento vive em `portal-link.server.ts`, importado dentro do handler
 * para a chave de serviço nunca entrar no pacote do navegador.
 */
export const Route = createFileRoute("/api/portal/arte")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { processarArte } = await import("@/lib/api/portal-link.server");
        return processarArte(request);
      },
    },
  },
});
