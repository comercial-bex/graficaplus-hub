import { createHash } from "node:crypto";
import {
  CABECALHO_DO_TOKEN,
  filtrosDaUrl,
  pareceToken,
  RECURSOS,
  recursoPorChave,
  REQUISICOES_POR_MINUTO,
  restanteNaJanela,
  tokenDoCabecalho,
} from "@/domain/api/recursos";

/**
 * GET /api/v1/:recurso — a API de leitura com token pessoal (02/11/2026).
 *
 * O servidor só faz três coisas: lê o token do cabeçalho, segura quem passa de
 * 100 chamadas por minuto e repassa ao banco. Quem decide o que a pessoa vê é
 * `api_consultar`, que lê COMO ela (RLS). O token nunca é guardado aqui; a
 * janela de minuto usa o hash dele.
 */

type Erro = { erro: string; mensagem: string };

const janelas = new Map<string, number[]>();

function json(corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cabecalhos },
  });
}

function erro(status: number, codigo: string, mensagem: string, cabecalhos: Record<string, string> = {}): Response {
  return json({ erro: codigo, mensagem } satisfies Erro, status, cabecalhos);
}

/** O que o banco devolve em `erro` vira resposta HTTP com frase em português. */
export function respostaDoErroDoBanco(codigo: string): Response {
  switch (codigo) {
    case "token_invalido":
      return erro(401, codigo, "Token inválido ou revogado. Gere outro em Ajustes, API e MCP.");
    case "token_expirado":
      return erro(401, codigo, "Este token venceu. Gere outro em Ajustes, API e MCP.");
    case "recurso_desconhecido":
      return erro(404, codigo, `Recurso desconhecido. Existem: ${RECURSOS.map((r) => r.chave).join(", ")}.`);
    case "filtro_invalido":
      return erro(400, codigo, "Algum filtro veio num formato que o banco não entendeu.");
    default:
      return erro(500, "falha", "Não foi possível consultar agora.");
  }
}

export async function consultarRecurso(request: Request, recurso: string): Promise<Response> {
  const url = new URL(request.url);

  // O catálogo não precisa de token: é a mesma lista que a tela de Ajustes mostra.
  if (recurso === "recursos") {
    return json({ base: `${url.origin}/api/v1`, cabecalho: CABECALHO_DO_TOKEN, recursos: RECURSOS });
  }

  const token = tokenDoCabecalho(request.headers);
  if (!token) return erro(401, "sem_token", `Mande o token no cabeçalho ${CABECALHO_DO_TOKEN}.`);
  if (!pareceToken(token)) return erro(401, "token_invalido", "Token inválido ou revogado. Gere outro em Ajustes, API e MCP.");

  const chaveDaJanela = createHash("sha256").update(token).digest("hex");
  const batidas = janelas.get(chaveDaJanela) ?? [];
  janelas.set(chaveDaJanela, batidas);
  const restante = restanteNaJanela(batidas, Date.now());
  if (restante < 0) {
    return erro(429, "limite", `Mais de ${REQUISICOES_POR_MINUTO} chamadas num minuto. Espere e tente de novo.`, {
      "retry-after": "60",
      "x-ratelimit-remaining": "0",
    });
  }

  const definicao = recursoPorChave(recurso);
  if (!definicao) return respostaDoErroDoBanco("recurso_desconhecido");
  const filtros = filtrosDaUrl(url.searchParams, definicao);
  if (!filtros.ok) return erro(400, "filtro_invalido", filtros.erro);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)("api_consultar", {
    p_token: token,
    p_recurso: recurso,
    p_filtros: filtros.filtros,
  });
  if (error) {
    console.error("[api/v1] api_consultar falhou", { recurso, mensagem: error.message });
    return erro(500, "falha", "Não foi possível consultar agora.");
  }
  const corpo = (data ?? {}) as Record<string, unknown>;
  if (typeof corpo.erro === "string") return respostaDoErroDoBanco(corpo.erro);
  return json(corpo, 200, { "x-ratelimit-remaining": String(restante) });
}
