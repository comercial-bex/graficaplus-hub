/**
 * Percentual em português: "68,8%", "−39,8%" com vírgula (21/10/2026).
 *
 * `x.toFixed(1)` escreve com ponto ("68.8%"), formato de planilha em inglês —
 * na mesma tela do "R$ 1.168,70". Visto ao vivo no orçamento #69, no catálogo
 * de produtos e no painel. Casas fixas: 50 vira "50,0%", como o toFixed fazia,
 * para a coluna não dançar.
 */
export function percentual(valor: number, casas = 1): string {
  const n = Number.isFinite(valor) ? valor : 0;
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}
