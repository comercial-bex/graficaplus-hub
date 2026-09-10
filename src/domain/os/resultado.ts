/**
 * O resultado da OS, dito com honestidade.
 *
 * Duas coisas diferentes estavam sendo mostradas do mesmo jeito:
 *
 *   custo medido e deu zero      → margem 100%, e é verdade
 *   ninguém lançou custo nenhum  → margem 100%, e é mentira
 *
 * A view devolvia `COALESCE(sum(custo), 0)` e as duas viravam o mesmo número.
 * Conferido no banco em 10/09/2026: a OS #44 tinha receita de 121,15, nenhuma
 * linha de custo, e o sistema anunciava lucro integral. Agora a view devolve
 * NULL nesses campos e marca `custo_lancado = false`; aqui a tela traduz isso
 * em uma frase que diz o que fazer, em vez de um travessão mudo.
 *
 * E a unidade: a view devolvia FRAÇÃO (0,4999) enquanto a tela escrevia "%",
 * então uma margem de 50% aparecia como "0.50%" — parecia erro de
 * arredondamento, não meio a meio. A unidade canônica do sistema é
 * porcentagem, que é o que `ordens_servico.margem_real` guarda e o que
 * `avancar_os_status` compara com o mínimo. A view foi alinhada; este módulo
 * assume porcentagem e não multiplica nada.
 */

export type ResultadoOs = {
  receita_liquida?: number | string | null;
  custo_previsto?: number | string | null;
  custo_realizado?: number | string | null;
  lucro_previsto?: number | string | null;
  lucro_realizado?: number | string | null;
  margem_prevista?: number | string | null;
  margem_realizada?: number | string | null;
  divergencia_custo?: number | string | null;
  custo_lancado?: boolean | null;
  custo_previsto_origem?: string | null;
};

/** Um campo pronto para a tela: ou tem valor, ou tem o motivo de não ter. */
export type Campo =
  | { tipo: "valor"; texto: string }
  | { tipo: "ausente"; texto: string; motivo: string };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SEM_CUSTO =
  "Nenhum custo foi lançado nesta OS. Registre a baixa de material ou finalize um apontamento de máquina.";

export function dinheiro(v: number | string | null | undefined): Campo {
  const n = num(v);
  return n == null
    ? { tipo: "ausente", texto: "—", motivo: "Sem valor registrado." }
    : { tipo: "valor", texto: brl(n) };
}

/** Porcentagem já em porcentagem — nada de multiplicar por 100 de novo. */
export function porcentagem(v: number | string | null | undefined): Campo {
  const n = num(v);
  return n == null
    ? { tipo: "ausente", texto: "—", motivo: "Sem valor registrado." }
    : { tipo: "valor", texto: `${n.toFixed(2).replace(".", ",")}%` };
}

/**
 * Os três campos que dependem de custo lançado. Quando não há custo, eles não
 * viram zero nem travessão: viram a frase que diz o que falta fazer.
 */
export function realizados(r: ResultadoOs | null | undefined): {
  custo: Campo;
  lucro: Campo;
  margem: Campo;
  custoLancado: boolean;
} {
  const lancado = r?.custo_lancado === true;
  if (!r || !lancado) {
    const ausente: Campo = { tipo: "ausente", texto: "não lançado", motivo: SEM_CUSTO };
    return { custo: ausente, lucro: ausente, margem: ausente, custoLancado: false };
  }
  return {
    custo: dinheiro(r.custo_realizado),
    lucro: dinheiro(r.lucro_realizado),
    margem: porcentagem(r.margem_realizada),
    custoLancado: true,
  };
}

/** De onde veio o custo previsto — para a tela não fingir precisão que não tem. */
export function origemDoPrevisto(origem: string | null | undefined): string {
  switch (origem) {
    case "orcamento":
      return "veio do orçamento";
    case "previsao_de_material":
      return "somado da previsão de material";
    default:
      return "não há custo previsto";
  }
}

/**
 * A divergência só significa alguma coisa quando os dois lados existem.
 * Comparar custo real ausente com previsto produz o previsto inteiro com
 * sinal trocado — um número grande que parece economia e é falta de dado.
 */
export function divergencia(r: ResultadoOs | null | undefined): Campo {
  if (!r || r.custo_lancado !== true) {
    return {
      tipo: "ausente",
      texto: "—",
      motivo: "Só dá para comparar previsto e realizado depois que o custo for lançado.",
    };
  }
  return dinheiro(r.divergencia_custo);
}
