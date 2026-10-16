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

/**
 * OS ainda em produção: o custo real está sendo lançado ao longo do trabalho.
 * Concluída, faturada e cancelada já não recebem custo — o que está lançado é
 * o que foi. Status desconhecido não conta como em andamento: sem saber, a
 * tela fica como era.
 */
export function osEmAndamento(status: string | null | undefined): boolean {
  return !!status && !["concluido", "faturado", "cancelado"].includes(status);
}

/** Quanto do custo previsto já foi lançado, numa OS que ainda não acabou. */
export type CustoParcial = {
  lancado: number;
  previsto: number;
  /** Quanto falta lançar para chegar ao previsto. */
  falta: number;
  /** Inteiro, arredondado para BAIXO: parcial nunca se lê como 100%. */
  percentual: number;
};

/**
 * Custo lançado MENOR que o previsto, com a OS ainda em andamento.
 *
 * É o caso do meio entre "nenhum custo lançado" (que a tela já diz) e "custo
 * completo": a view soma só o que foi lançado, então uma OS que previu R$ 534,95
 * e lançou R$ 75,00 anuncia margem realizada de 89,9% contra 28,2% prevista, e a
 * divergência sai como −R$ 459,95 — com cara de economia, e é custo que ainda
 * não entrou. Visto em 15/10/2026, no ensaio do reembolso, na OS #167.
 *
 * Não vale para OS concluída: ali o menor-que-o-previsto pode ser economia de
 * verdade, e quem fechou a OS já decidiu que o custo está completo.
 */
export function custoParcial(
  r: Pick<ResultadoOs, "custo_lancado" | "custo_previsto" | "custo_realizado"> | null | undefined,
  emAndamento: boolean,
): CustoParcial | null {
  if (!emAndamento || !r || r.custo_lancado !== true) return null;
  const lancado = num(r.custo_realizado);
  const previsto = num(r.custo_previsto);
  if (lancado == null || previsto == null || lancado <= 0 || previsto <= 0 || lancado >= previsto) {
    return null;
  }
  return {
    lancado,
    previsto,
    // Em centavos: 534,95 − 75 dá 459,9499… em ponto flutuante.
    falta: Math.round((previsto - lancado) * 100) / 100,
    percentual: Math.floor((lancado / previsto) * 100),
  };
}

/** As frases que a tela mostra quando o custo é parcial. */
export function frasesDoParcial(p: CustoParcial): { aviso: string; realizado: string; divergencia: string } {
  return {
    aviso:
      `Só ${brl(p.lancado)} dos ${brl(p.previsto)} de custo previsto estão lançados (${p.percentual}%). ` +
      "A OS está em andamento: lucro e margem realizados ainda vão cair. Para julgar o trabalho agora, use a margem prevista.",
    realizado: `parcial: ${p.percentual}% do custo previsto lançado`,
    divergencia: `não é economia: ainda faltam ${brl(p.falta)} a lançar`,
  };
}

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
export function realizados(
  r: ResultadoOs | null | undefined,
  opcoes: { osEmAndamento?: boolean } = {},
): {
  custo: Campo;
  lucro: Campo;
  margem: Campo;
  custoLancado: boolean;
  /** Preenchido quando a OS está em andamento e só parte do custo previsto foi lançada. */
  parcial: CustoParcial | null;
} {
  const lancado = r?.custo_lancado === true;
  if (!r || !lancado) {
    const ausente: Campo = { tipo: "ausente", texto: "não lançado", motivo: SEM_CUSTO };
    return { custo: ausente, lucro: ausente, margem: ausente, custoLancado: false, parcial: null };
  }
  return {
    custo: dinheiro(r.custo_realizado),
    lucro: dinheiro(r.lucro_realizado),
    margem: porcentagem(r.margem_realizada),
    custoLancado: true,
    parcial: custoParcial(r, opcoes.osEmAndamento === true),
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
 * Soma e média SÓ do que existe.
 *
 * A view passou a devolver NULL onde não há custo lançado — e a tela de
 * relatórios desfazia isso: `Number(valor ?? 0)` somava os vazios como zero, e
 * a margem média dividia pelo TOTAL de OS, contando as sem custo como 0%. Uma
 * OS com 40% ao lado de uma sem custo aparecia como "margem média de 20%" —
 * a média real diluída por zeros que ninguém mediu.
 *
 * Aqui o vazio fica de fora da conta. Se nada existe, o resultado é null, não
 * zero: "não há o que somar" e "a soma deu zero" são coisas diferentes.
 */
export function somaDoQueExiste(valores: Array<number | string | null | undefined>): number | null {
  const existentes = valores.map(num).filter((v): v is number => v != null);
  return existentes.length === 0 ? null : existentes.reduce((s, v) => s + v, 0);
}

export function mediaDoQueExiste(valores: Array<number | string | null | undefined>): number | null {
  const existentes = valores.map(num).filter((v): v is number => v != null);
  return existentes.length === 0 ? null : existentes.reduce((s, v) => s + v, 0) / existentes.length;
}

/**
 * De quantas OS vem o número. Uma margem média que não diz a base apresenta a
 * média de um subconjunto como se fosse o todo.
 */
export function coberturaDoCusto(comCusto: number | null | undefined, total: number | null | undefined): string {
  const c = Number(comCusto ?? 0);
  const t = Number(total ?? 0);
  if (t === 0) return "nenhuma OS no período";
  if (c === 0) return `nenhuma das ${t} OS tem custo lançado`;
  if (c === t) return `todas as ${t} OS com custo lançado`;
  return `calculado sobre ${c} de ${t} OS — as outras não têm custo lançado`;
}

/**
 * Previsto × real, comparados sobre as MESMAS OS.
 *
 * O gráfico "Lucro · previsto vs real" do painel calculava o real como
 * `receita − custo_real`. Mas `ordens_servico.custo_real` é NOT NULL DEFAULT 0
 * e só é preenchido quando a OS fecha — em toda OS aberta ele vale zero. Em
 * 11/09/2026 o mês de setembro saía com lucro real de R$ 121,15 (margem de
 * 100%) contra previsto de R$ 60,57: o gráfico dizia que a gráfica lucrou o
 * DOBRO do planejado, e diria isso para toda OS até ela ser fechada.
 *
 * E comparar o real de algumas OS com o previsto de todas é comparar coisas
 * diferentes. Então os dois lados usam o mesmo conjunto: as OS com custo
 * lançado. Mês sem nenhuma devolve null nos dois — o gráfico mostra o vazio em
 * vez de uma barra inventada.
 */
export function lucroComparavel(
  doMes: Array<{
    custo_lancado?: boolean | null;
    custo_previsto?: number | string | null;
    custo_realizado?: number | string | null;
    /** A OS ainda está em produção (osEmAndamento do status). */
    os_em_andamento?: boolean | null;
    lucro_previsto?: number | string | null;
    lucro_realizado?: number | string | null;
  }>,
): { previsto: number | null; real: number | null; osComparadas: number } {
  // Custo parcial (OS em andamento com só parte do custo lançado) fica de fora:
  // o "lucro real" dela é lucro que ainda não pagou o custo que falta.
  const comCusto = doMes.filter(
    (r) => r.custo_lancado === true && !custoParcial(r, r.os_em_andamento === true),
  );
  if (comCusto.length === 0) return { previsto: null, real: null, osComparadas: 0 };
  return {
    previsto: somaDoQueExiste(comCusto.map((r) => r.lucro_previsto)),
    real: somaDoQueExiste(comCusto.map((r) => r.lucro_realizado)),
    osComparadas: comCusto.length,
  };
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
