import type { BloqueioOs } from "@/components/kanban/cartao-os";

/**
 * Duas travas do `os_bloqueios_para` trazem número de dinheiro no título:
 * "Margem de 12% abaixo do mínimo de 20%" e "Desconto de 15% acima do limite
 * de 10%". Margem é custo (financeiro) e desconto é preço (comercial). Quem não
 * pode ver o número lê só que a OS espera aprovação do gestor — o texto do
 * "como resolver" continua o mesmo.
 *
 * Vale para todo lugar que mostra travas: cartão e ficha do Kanban, painel do
 * impressor. A RPC devolve o título completo para todo staff; o corte é aqui.
 */
export function semDinheiro(
  b: BloqueioOs,
  canSeeFinancials: boolean,
  canSeePrices: boolean,
): BloqueioOs {
  if (b.codigo === "margem_baixa" && !canSeeFinancials)
    return { ...b, titulo: "Margem abaixo do mínimo — precisa de aprovação do gestor" };
  if (b.codigo === "desconto_alto" && !canSeePrices)
    return { ...b, titulo: "Desconto acima do limite — precisa de aprovação do gestor" };
  return b;
}

export function bloqueiosSemDinheiro(
  lista: BloqueioOs[] | null | undefined,
  canSeeFinancials: boolean,
  canSeePrices: boolean,
): BloqueioOs[] {
  return (lista ?? []).map((b) => semDinheiro(b, canSeeFinancials, canSeePrices));
}
