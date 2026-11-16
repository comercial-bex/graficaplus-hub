import { ehUnidadeDeArea, temDimensoes, type ItemDimensionado } from "./area";

export const MENSAGEM_M2_SEM_PRECO =
  "Este item é vendido por metro quadrado e tem largura e altura, mas falta o preço por metro quadrado. Informe o preço por metro quadrado para o valor fechar com a medida.";

/**
 * Item em m² com largura e altura e sem preço por m² escapava da fórmula do banco
 * (a conta por área só roda com preço/m²) e gravava o valor digitado à mão. Auditoria
 * de 15/11/2026: 9 itens assim, entre eles os do orçamento 98 e os Bolão dos 69 e 181.
 * Devolve a mensagem de bloqueio, ou null quando pode gravar.
 *
 * Só vale para quem edita preço: quem não vê preço não tem o campo para preencher.
 */
export function bloqueioDeAreaSemPreco(a: {
  unidade: string | null | undefined;
  item: ItemDimensionado;
  precoM2: number | null | undefined;
  podeEditarPreco: boolean;
}): string | null {
  if (!a.podeEditarPreco) return null;
  if (!ehUnidadeDeArea(a.unidade)) return null;
  if (!temDimensoes(a.item)) return null;
  return Number(a.precoM2) > 0 ? null : MENSAGEM_M2_SEM_PRECO;
}
