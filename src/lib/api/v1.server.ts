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
 *
 * `lerRecurso` é o miolo, sem HTTP: a API REST e o MCP (`mcp.server.ts`) usam
 * o mesmo caminho, com a mesma validação de filtros e a mesma janela.
 */

type Erro = { erro: string; mensagem: string };

const janelas = new Map<string, number[]>();

export type LeituraDoRecurso =
  | { ok: true; corpo: Record<string, unknown>; restante: number }
  | { ok: false; status: number; codigo: string; mensagem: string; cabecalhos?: Record<string, string> };

function json(corpo: unknown, status = 200, cabecalhos: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cabecalhos },
  });
}

function erro(status: number, codigo: string, mensagem: string, cabecalhos: Record<string, string> = {}): Response {
  return json({ erro: codigo, mensagem } satisfies Erro, status, cabecalhos);
}

/** O que o banco devolve em `erro` vira status e frase em português. */
export function erroDoBanco(codigo: string): { status: number; codigo: string; mensagem: string } {
  switch (codigo) {
    case "token_invalido":
      return { status: 401, codigo, mensagem: "Token inválido ou revogado. Gere outro em Ajustes, API e MCP." };
    case "token_expirado":
      return { status: 401, codigo, mensagem: "Este token venceu. Gere outro em Ajustes, API e MCP." };
    case "recurso_desconhecido":
      return { status: 404, codigo, mensagem: `Recurso desconhecido. Existem: ${RECURSOS.map((r) => r.chave).join(", ")}.` };
    case "filtro_invalido":
      return { status: 400, codigo, mensagem: "Algum filtro veio num formato que o banco não entendeu." };
    default:
      return { status: 500, codigo: "falha", mensagem: "Não foi possível consultar agora." };
  }
}

export function respostaDoErroDoBanco(codigo: string): Response {
  const e = erroDoBanco(codigo);
  return erro(e.status, e.codigo, e.mensagem);
}

/** Quantas chamadas ainda cabem neste minuto para este token; -1 quando estourou. */
export function contarNaJanela(token: string): number {
  const chave = createHash("sha256").update(token).digest("hex");
  const batidas = janelas.get(chave) ?? [];
  janelas.set(chave, batidas);
  return restanteNaJanela(batidas, Date.now());
}

/**
 * Lê um recurso em nome do token: valida token e filtros, respeita a janela e
 * chama `api_consultar`. Sem HTTP, para a API e o MCP dividirem o caminho.
 */
export async function lerRecurso(
  token: string | null,
  recurso: string,
  parametros: URLSearchParams,
): Promise<LeituraDoRecurso> {
  if (!token) return { ok: false, status: 401, codigo: "sem_token", mensagem: `Mande o token no cabeçalho ${CABECALHO_DO_TOKEN}.` };
  if (!pareceToken(token)) return { ok: false, ...erroDoBanco("token_invalido") };

  const restante = contarNaJanela(token);
  if (restante < 0) {
    return {
      ok: false,
      status: 429,
      codigo: "limite",
      mensagem: `Mais de ${REQUISICOES_POR_MINUTO} chamadas num minuto. Espere e tente de novo.`,
      cabecalhos: { "retry-after": "60", "x-ratelimit-remaining": "0" },
    };
  }

  const definicao = recursoPorChave(recurso);
  if (!definicao) return { ok: false, ...erroDoBanco("recurso_desconhecido") };
  const filtros = filtrosDaUrl(parametros, definicao);
  if (!filtros.ok) return { ok: false, status: 400, codigo: "filtro_invalido", mensagem: filtros.erro };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.rpc as any)("api_consultar", {
    p_token: token,
    p_recurso: recurso,
    p_filtros: filtros.filtros,
  });
  if (error) {
    console.error("[api/v1] api_consultar falhou", { recurso, mensagem: error.message });
    return { ok: false, ...erroDoBanco("falha") };
  }
  const corpo = (data ?? {}) as Record<string, unknown>;
  if (typeof corpo.erro === "string") return { ok: false, ...erroDoBanco(corpo.erro) };
  return { ok: true, corpo, restante };
}

export async function consultarRecurso(request: Request, recurso: string): Promise<Response> {
  const url = new URL(request.url);

  // O catálogo não precisa de token: é a mesma lista que a tela de Ajustes mostra.
  if (recurso === "recursos") {
    return json({ base: `${url.origin}/api/v1`, cabecalho: CABECALHO_DO_TOKEN, recursos: RECURSOS });
  }

  const leitura = await lerRecurso(tokenDoCabecalho(request.headers), recurso, url.searchParams);
  if (!leitura.ok) return erro(leitura.status, leitura.codigo, leitura.mensagem, leitura.cabecalhos ?? {});
  return json(leitura.corpo, 200, { "x-ratelimit-remaining": String(leitura.restante) });
}
