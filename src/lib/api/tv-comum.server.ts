/**
 * O que as duas rotas da TV (`/api/tv/parear` e `/api/tv/painel`) têm em comum.
 *
 * DUAS REGRAS QUE VALEM PARA TUDO AQUI
 *
 * 1. Nenhuma tabela é lida direto. O `supabaseAdmin` usa a chave de serviço,
 *    que ignora RLS e GRANT de coluna: uma consulta solta numa tabela-base é o
 *    caminho mais curto para custo e margem aparecerem na parede. As rotas da
 *    TV só chamam FUNÇÕES do banco (`tv_*`), que devolvem lista fechada de
 *    chaves. `tests/tv-rotas-sem-vazamento.test.ts` segura isso.
 *
 * 2. Falha nunca vira vazio. Toda chamada passa por `lerDoBanco`, que devolve
 *    `{ ok: false }` quando o banco não respondeu, e a rota transforma isso em
 *    503. Uma TV que recebe 200 com listas vazias mostra "oficina parada" — e
 *    a oficina não está parada, o banco é que caiu.
 */

type Corpo = Record<string, unknown>;

/** Resposta JSON que nunca fica em cache: o painel de um minuto atrás é mentira. */
export function respostaTv(
  status: number,
  corpo: unknown,
  extras?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extras,
    },
  });
}

export function bancoIndisponivel(): Response {
  return respostaTv(503, { erro: "banco_indisponivel" });
}

export type ResultadoDoBanco = { ok: true; valor: Corpo } | { ok: false };

type RespostaDaRpc = { data: unknown; error: { code?: string } | null };

/**
 * Executa uma chamada de função `tv_*` e só devolve `ok` quando veio um objeto
 * de verdade. Erro do banco, resposta nula e exceção (cliente sem variável de
 * ambiente, rede fora) caem todos no mesmo `{ ok: false }`.
 *
 * A chamada vem embrulhada numa função para o `supabaseAdmin.rpc("nome", {…})`
 * ficar escrito por extenso em quem chama — é essa forma que os testes de
 * assinatura sabem ler.
 *
 * O registro do erro leva só o nome da função e o código do Postgres. A
 * mensagem do banco fica de fora de propósito: o que entra nestas funções são
 * hashes de credencial, e log não é lugar para nada que saia de uma.
 */
export async function lerDoBanco(
  nome: string,
  chamada: () => PromiseLike<RespostaDaRpc>,
): Promise<ResultadoDoBanco> {
  try {
    const { data, error } = await chamada();
    if (error) {
      console.error(`[tv] ${nome} falhou no banco`, error.code ?? "sem código");
      return { ok: false };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      console.error(`[tv] ${nome} não devolveu um objeto`);
      return { ok: false };
    }
    return { ok: true, valor: data as Corpo };
  } catch {
    console.error(`[tv] ${nome} não chegou ao banco`);
    return { ok: false };
  }
}
