import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/mcp — o MCP de leitura do Bex Print (JSON-RPC 2.0 por HTTP, sem
 * sessão). Token pessoal no cabeçalho; seis ferramentas de leitura.
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { atenderMcp } = await import("@/lib/api/mcp.server");
        return atenderMcp(request);
      },
      POST: async ({ request }) => {
        const { atenderMcp } = await import("@/lib/api/mcp.server");
        return atenderMcp(request);
      },
      DELETE: async ({ request }) => {
        const { atenderMcp } = await import("@/lib/api/mcp.server");
        return atenderMcp(request);
      },
    },
  },
});
