/**
 * O fechamento do clube para o contador.
 *
 * Crédito de parceiro é obrigação: a gráfica deve desconto futuro a alguém. O
 * mês fecha como conta-corrente — saldo que veio, o que entrou, o que saiu, o
 * que sobra — e três detalhes decidem se o número está certo:
 *
 *   - `uso` é gravado NEGATIVO no extrato; no relatório ele aparece como valor
 *     positivo na linha "usado", senão a soma some com o próprio sinal;
 *   - `ajuste` pode ser para os dois lados. Ajuste negativo é correção, não
 *     concessão: somá-lo em "concedido" faria o mês parecer mais generoso do
 *     que foi;
 *   - `estorno_uso` devolve crédito de pedido recusado e não é concessão nova.
 */

export type TipoDeMovimento = "cashback" | "recompensa" | "uso" | "estorno_uso" | "ajuste";

export type TotalPorTipo = { tipo: string; quantidade: number; valor: number | string };

export type ResumoDoFechamento = {
  cashback: number;
  recompensa: number;
  /** soma dos ajustes, com sinal */
  ajuste: number;
  /** crédito que virou desconto em pedidos, sempre positivo */
  usado: number;
  devolvido: number;
  /** cashback + metas + ajustes que aumentaram o saldo */
  concedido: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function resumoDoFechamento(porTipo: TotalPorTipo[] | null | undefined): ResumoDoFechamento {
  const soma = new Map<string, number>();
  for (const t of porTipo ?? []) soma.set(t.tipo, num(soma.get(t.tipo)) + num(t.valor));
  const pega = (t: TipoDeMovimento) => arred(soma.get(t) ?? 0);

  const cashback = pega("cashback");
  const recompensa = pega("recompensa");
  const ajuste = pega("ajuste");
  return {
    cashback,
    recompensa,
    ajuste,
    usado: Math.abs(pega("uso")),
    devolvido: pega("estorno_uso"),
    concedido: arred(cashback + recompensa + Math.max(ajuste, 0)),
  };
}

/**
 * Confere se o saldo final bate com o movimento do período.
 *
 * saldo final = saldo anterior + concedido − usado + devolvido + ajuste negativo.
 * Quando não bater, a tela avisa em vez de imprimir um número que o contador
 * vai ter que refazer à mão.
 */
export function fechamentoConfere(params: {
  saldo_anterior: number | string;
  saldo_final: number | string;
  resumo: ResumoDoFechamento;
}): { confere: boolean; diferenca: number } {
  const esperado = arred(
    num(params.saldo_anterior) +
      params.resumo.concedido -
      params.resumo.usado +
      params.resumo.devolvido +
      Math.min(params.resumo.ajuste, 0),
  );
  const diferenca = arred(num(params.saldo_final) - esperado);
  return { confere: Math.abs(diferenca) < 0.005, diferenca };
}
