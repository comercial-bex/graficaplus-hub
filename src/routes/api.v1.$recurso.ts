import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/v1/:recurso — leitura dos dados da gráfica com token pessoal
 * (Ajustes › API e MCP). Só leitura; o banco lê como a pessoa dona do token.
 * `GET /api/v1/recursos` devolve o catálogo sem token.
 */
export const Route = createFileRoute("/api/v1/$recurso")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { consultarRecurso } = await import("@/lib/api/v1.server");
        return consultarRecurso(request, params.recurso);
      },
    },
  },
});
