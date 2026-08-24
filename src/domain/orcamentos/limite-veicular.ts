/**
 * Limite da Justiça Eleitoral para adesivos na carroceria de um veículo.
 *
 * A regra é POR VEÍCULO: a soma de todos os adesivos na carroceria de um carro
 * não passa de 0,5 m². Não é por pedido — 200 bolas para 200 carros estão
 * corretas, e somar o orçamento inteiro daria alarme falso justamente na venda
 * grande, que é a que interessa.
 *
 * O adesivo perfurado NÃO entra nesta conta: ele é do vidro traseiro, que tem
 * regra própria e pode ocupar o vidro inteiro.
 */
export const LIMITE_CARROCERIA_M2 = 0.5;

/** Quantas peças desta medida cabem num veículo dentro do limite. */
export function pecasPorVeiculo(
  largura: number | null | undefined,
  altura: number | null | undefined,
): number | null {
  if (!largura || !altura) return null;
  const area = largura * altura;
  if (!Number.isFinite(area) || area <= 0) return null;
  return Math.floor(LIMITE_CARROCERIA_M2 / area);
}
