/**
 * Soma do valor das OS de uma coluna do quadro de produção (31/10/2026, Onda 7a do
 * plano `docs/plano-interface-holdprint-31-10-2026.md`): o Holdprint mostra o dinheiro
 * parado em cada etapa. Valor ausente, texto ou inválido vale zero, nunca NaN.
 * Quem não vê preço não chama esta função: somar sem ver seria chute.
 */
export function totalDaEtapa(itens: ReadonlyArray<{ valor_total?: unknown }>): number {
  return itens.reduce((soma, o) => {
    const v = Number(o.valor_total ?? 0);
    return soma + (Number.isFinite(v) ? v : 0);
  }, 0);
}
