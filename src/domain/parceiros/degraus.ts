import { precoDaGrafica, type ItemDoCatalogo } from "./preco";

/**
 * A tabela de degraus de quantidade de um produto de parceiro: a quantidade a
 * partir da qual o preço cai, o que o parceiro paga por unidade e quanto isso
 * poupa em relação ao primeiro degrau. É como as lojas de gráfica online
 * mostram a quantidade (Printi, 360imprimir): a pessoa vê o degrau em vez de
 * descobrir o desconto por tentativa.
 *
 * Só EXIBE o que o banco já cobra. Quem escolhe o degrau que vale é
 * `precoDaGrafica` — a mesma regra do banco —, para a linha destacada nunca
 * discordar do custo do item.
 */

export type Degrau = {
  quantidadeMinima: number;
  /** o que o parceiro paga por unidade de venda neste degrau */
  precoParceiro: number;
  /** o preço de balcão da gráfica neste degrau (a sugestão de venda) */
  precoBalcao: number;
  /** quanto o preço do parceiro é menor que o do primeiro degrau; nulo no primeiro */
  economiaPct: number | null;
  /** o degrau que vale para a quantidade que está no item */
  atual: boolean;
};

export function degrausDoProduto(
  produto: ItemDoCatalogo | undefined,
  quantidade: number,
): Degrau[] {
  if (!produto?.faixas || produto.faixas.length < 2) return [];
  const preco = precoDaGrafica(produto, quantidade);
  const aplicada = preco.tipo === "ok" ? preco.faixa : null;
  const primeiro = produto.faixas[0].preco_parceiro;
  return produto.faixas.map((f, i) => {
    const pct = i > 0 && primeiro > 0 ? Math.round((1 - f.preco_parceiro / primeiro) * 100) : null;
    return {
      quantidadeMinima: f.quantidade_minima,
      precoParceiro: f.preco_parceiro,
      precoBalcao: f.preco_referencia,
      economiaPct: pct !== null && pct > 0 ? pct : null,
      atual: aplicada !== null && aplicada.quantidade_minima === f.quantidade_minima,
    };
  });
}
