import { hashDoSegredo } from "@/domain/whatsapp/segredo-webhook";
import {
  CABECALHO_DO_LINK,
  MENSAGEM_LINK_INVALIDO,
  tokenBemFormado,
} from "@/domain/portal/link-do-portal";

/**
 * O que as rotas `/api/portal/*` (o portal do cliente por link) têm em comum.
 *
 * TRÊS REGRAS QUE VALEM PARA TUDO AQUI — as mesmas das rotas da TV
 *
 * 1. Nenhuma tabela é lida direto. `supabaseAdmin` usa a chave de serviço,
 *    que ignora RLS e GRANT de coluna: `.from("ordens_servico")` traria custo
 *    e margem. As rotas só chamam funções `portal_link_*`, que devolvem lista
 *    fechada de chaves. `tests/portal-rotas-sem-vazamento.test.ts` segura isso.
 *
 * 2. Falha nunca vira vazio nem vira "recebemos". Toda chamada passa por
 *    `lerDoBanco`, que devolve `{ ok: false }` quando o banco não respondeu, e
 *    a rota transforma isso em 503. A página antiga respondia "Recebemos sua
 *    solicitação com segurança. A equipe foi notificada." sem gravar nada.
 *
 * 3. O token vem no cabeçalho `x-portal-token`, nunca na URL da rota, e vai ao
 *    banco só como SHA-256. Nem token nem hash entram em log.
 */

export type Corpo = Record<string, unknown>;

/** Resposta JSON que nunca fica em cache: o painel de ontem é mentira hoje. */
export function respostaPortal(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** 503: o banco não respondeu ou falta a chave de serviço no servidor. */
export function portalIndisponivel(): Response {
  return respostaPortal(503, { erro: "portal_indisponivel" });
}

/** 401: link inválido, vencido ou cancelado — a mesma frase para os três. */
export function linkInvalido(): Response {
  return respostaPortal(401, { erro: "link_invalido", mensagem: MENSAGEM_LINK_INVALIDO });
}

/** 400: o pedido veio torto (campo faltando, formato errado). */
export function pedidoInvalido(mensagem: string): Response {
  return respostaPortal(400, { erro: "pedido_invalido", mensagem });
}

/** 422: o banco recusou com um motivo escrito para o cliente. */
export function recusado(mensagem: string): Response {
  return respostaPortal(422, { erro: "recusado", mensagem });
}

export type ResultadoDoBanco = { ok: true; valor: Corpo } | { ok: false };

type RespostaDaRpc = { data: unknown; error: { code?: string } | null };

/**
 * Executa uma chamada de função `portal_link_*` e só devolve `ok` quando veio
 * um objeto de verdade. Erro do banco, resposta nula e exceção (cliente sem a
 * chave de serviço, rede fora) caem todos no mesmo `{ ok: false }`.
 *
 * O registro leva só o nome da função e o código do Postgres: o que entra
 * nestas funções é hash de credencial, e log não é lugar para nada que saia
 * de uma.
 */
export async function lerDoBanco(
  nome: string,
  chamada: () => PromiseLike<RespostaDaRpc>,
): Promise<ResultadoDoBanco> {
  try {
    const { data, error } = await chamada();
    if (error) {
      console.error(`[portal] ${nome} falhou no banco`, error.code ?? "sem código");
      return { ok: false };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      console.error(`[portal] ${nome} não devolveu um objeto`);
      return { ok: false };
    }
    return { ok: true, valor: data as Corpo };
  } catch {
    console.error(`[portal] ${nome} não chegou ao banco`);
    return { ok: false };
  }
}

/**
 * A porta do link, como o banco descreveu:
 *   "aberta"       siga
 *   "fechada"      inválido, vencido ou cancelado — 401
 *   "desconhecida" resposta que este código não conhece — 503, nunca porta aberta
 */
export function portaDoLink(valor: Corpo): "aberta" | "fechada" | "desconhecida" {
  const situacao = valor.situacao;
  if (situacao === "aberto") return "aberta";
  if (situacao === "invalido" || situacao === "vencido" || situacao === "revogado")
    return "fechada";
  return "desconhecida";
}

/** Lê o token do cabeçalho e devolve o hash que vai ao banco. `null` se mal formado. */
export async function credencialDoPedido(request: Request): Promise<{ hash: string } | null> {
  const token = request.headers.get(CABECALHO_DO_LINK);
  if (!tokenBemFormado(token)) return null;
  return { hash: await hashDoSegredo(token) };
}

/** O corpo JSON do pedido como objeto, ou `null`. */
export async function corpoDoPedido(request: Request): Promise<Corpo | null> {
  try {
    const corpo: unknown = await request.json();
    if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) return null;
    return corpo as Corpo;
  } catch {
    return null;
  }
}
