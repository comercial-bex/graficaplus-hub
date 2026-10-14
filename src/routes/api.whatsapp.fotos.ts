import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/fotos — completa a foto das conversas que ainda não têm
 * (14/10/2026). Quem chama é o pg_cron (job `whatsapp-fotos`), de tempos em
 * tempos, poucas por vez: a última foto que o webhook viu, se o link ainda
 * vale, ou o GET /profile-picture do Z-API.
 *
 * Só do servidor: exige o token do despachante no cabeçalho
 * `x-despachante-token` (variável DESPACHANTE_TOKEN ou Vault). Sem token, 401.
 *
 * Corpo (opcional): { "limite": 1..20 } — padrão 5.
 */
function json(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/whatsapp/fotos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tokenDoServidorConfere } = await import("@/lib/api/whatsapp-enviar.server");
        if (!(await tokenDoServidorConfere(request))) return json(401, { ok: false, erro: "token inválido" });

        const corpo = (await request.json().catch(() => ({}))) as { limite?: unknown };
        const pedido = Number(corpo?.limite ?? 5);
        const limite = Number.isFinite(pedido) ? Math.min(20, Math.max(1, Math.trunc(pedido))) : 5;
        try {
          const { fotosPendentes } = await import("@/lib/api/whatsapp-fotos.server");
          return json(200, { ok: true, ...(await fotosPendentes(limite)) });
        } catch (e) {
          return json(500, { ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  },
});
