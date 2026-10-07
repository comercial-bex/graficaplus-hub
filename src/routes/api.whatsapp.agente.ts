import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/whatsapp/agente — a assistente de IA para UMA mensagem recebida.
 *
 * O caminho normal NÃO passa por aqui: o webhook chama a assistente direto,
 * dentro da mesma requisição (ver `whatsapp-assistente.server.ts`). Esta porta
 * é para reprocessar à mão — por exemplo, depois de ligar a IA, rodar de novo
 * a última mensagem de uma conversa.
 *
 * Só do servidor: exige o token do despachante (DESPACHANTE_TOKEN) no
 * cabeçalho `x-despachante-token`. Sem a variável, 503. Nada do navegador.
 *
 * Corpo: { "conversa_id": "<uuid>", "mensagem_id": "<uuid>" }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/whatsapp/agente")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(process.env.DESPACHANTE_TOKEN ?? "")) {
          return json(503, { ok: false, erro: "DESPACHANTE_TOKEN não está no servidor" });
        }
        const { tokenDoServidorConfere } = await import("@/lib/api/whatsapp-enviar.server");
        if (!(await tokenDoServidorConfere(request))) return json(401, { ok: false, erro: "token inválido" });

        let corpo: { conversa_id?: unknown; mensagem_id?: unknown };
        try {
          corpo = (await request.json()) as typeof corpo;
        } catch {
          return json(400, { ok: false, erro: "corpo não é JSON" });
        }
        const conversaId = String(corpo?.conversa_id ?? "");
        const mensagemId = String(corpo?.mensagem_id ?? "");
        if (!UUID.test(conversaId) || !UUID.test(mensagemId)) {
          return json(400, { ok: false, erro: "informe conversa_id e mensagem_id (uuid)" });
        }
        const { rodarAssistente } = await import("@/lib/api/whatsapp-assistente.server");
        const resultado = await rodarAssistente(conversaId, mensagemId);
        return json(resultado.acao === "erro" ? 500 : 200, { ok: resultado.acao !== "erro", ...resultado });
      },
    },
  },
});
