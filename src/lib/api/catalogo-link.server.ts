/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: catalogo_link_abrir não está nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import {
  CABECALHO_DO_CATALOGO,
  MENSAGEM_VITRINE_INVALIDA,
  tokenDoCatalogoBemFormado,
} from "@/domain/catalogo/link-do-catalogo";
import { vitrineFechada } from "@/domain/catalogo/vitrine";

/**
 * GET /api/catalogo/vitrine — o catálogo que o cliente abre pelo link.
 *
 * AS MESMAS TRÊS REGRAS DO PORTAL DO CLIENTE (`portal-comum.server.ts`):
 *
 * 1. Nenhuma tabela é lida direto. `supabaseAdmin` usa a chave de serviço, que
 *    ignora RLS: `.from("fornecedor_itens")` traria o código do fornecedor, e
 *    `.from("fornecedor_item_custos")`, o custo. Daqui só sai a chamada a
 *    `catalogo_link_abrir`, que monta a resposta com lista fechada de chaves —
 *    e a resposta ainda passa por `vitrineFechada` antes de sair.
 *
 * 2. Falha nunca vira vazio. Banco fora, chave de serviço ausente ou resposta
 *    que este código não conhece → 503 ("tente de novo"); link inválido,
 *    vencido ou cancelado → 401 com a mesma frase para os três. Uma vitrine
 *    vazia por erro diria ao cliente que não há nada para ele.
 *
 * 3. O token vem no cabeçalho `x-catalogo-token`, nunca na URL desta rota, e
 *    vai ao banco só como SHA-256. Nem token nem hash entram em log.
 */

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // A vitrine de ontem pode ter preço velho: nada de cache.
      "cache-control": "no-store",
    },
  });
}

function indisponivel(): Response {
  return resposta(503, { erro: "vitrine_indisponivel" });
}

function linkInvalido(): Response {
  return resposta(401, { erro: "link_invalido", mensagem: MENSAGEM_VITRINE_INVALIDA });
}

export async function responderVitrine(request: Request): Promise<Response> {
  const token = request.headers.get(CABECALHO_DO_CATALOGO);
  if (!tokenDoCatalogoBemFormado(token)) return linkInvalido();
  const hash = await hashDoSegredo(token);

  let data: unknown;
  try {
    const r = await (supabaseAdmin.rpc as any)("catalogo_link_abrir", { p_token_hash: hash });
    if (r.error) {
      // Só o nome da função e o código do Postgres: o que entra aqui é hash de credencial.
      console.error("[catalogo] catalogo_link_abrir falhou no banco", r.error.code ?? "sem código");
      return indisponivel();
    }
    data = r.data;
  } catch {
    console.error("[catalogo] catalogo_link_abrir não chegou ao banco");
    return indisponivel();
  }

  const situacao =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).situacao
      : undefined;
  if (situacao === "invalido" || situacao === "vencido" || situacao === "revogado") return linkInvalido();
  // Situação que este código não conhece nunca vira porta aberta.
  if (situacao !== "aberto") return indisponivel();

  const vitrine = vitrineFechada(data);
  if (!vitrine) {
    console.error("[catalogo] catalogo_link_abrir devolveu uma forma desconhecida");
    return indisponivel();
  }
  return resposta(200, vitrine);
}
