import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/tv/parear — ENCERRADA em 06/10/2026: a TV da Oficina entra só pelo PIN
 * (decisão do dono, "só PIN mesmo"; a entrada é `/api/tv/pin`).
 *
 * A rota fica de pé só para dizer isso: uma TV que estava com a tela antiga do
 * código aberta recebe 410 com o motivo, sem nada ir ao banco, e ao recarregar
 * mostra o teclado do PIN. As TVs que já tinham entrado pelo código continuam
 * com o crachá delas até alguém revogar em /telas.
 */
export const Route = createFileRoute("/api/tv/parear")({
  server: {
    handlers: {
      GET: async () => {
        const { pareamentoEncerrado } = await import("@/lib/api/tv-comum.server");
        return pareamentoEncerrado();
      },
      POST: async () => {
        const { pareamentoEncerrado } = await import("@/lib/api/tv-comum.server");
        return pareamentoEncerrado();
      },
    },
  },
});
