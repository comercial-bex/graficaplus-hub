/**
 * Contas da tabela de preços (custo, venda final, venda parceiro, lucro,
 * concorrentes). Tudo por UNIDADE de venda do produto (m², un, m…), como o
 * cadastro guarda `custo_medio` e `preco_base`.
 *
 * Margem é sobre a VENDA (lucro ÷ preço), a mesma do semáforo do orçamento;
 * markup é sobre o custo. Misturar os dois já fez "30%" querer dizer duas coisas.
 */

export const MAX_CONCORRENTES = 3;

export type PrecoDeParceiro = { valor: number; origem: "cadastro" | "nivel" };

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Preço do parceiro: o do cadastro do produto, senão o do nível mais baixo do programa. */
export function precoDoParceiro(args: {
  precoParceiro: number | null;
  precoBase: number | null;
  descontoDoNivelPct: number | null;
}): PrecoDeParceiro | null {
  if (args.precoParceiro != null && args.precoParceiro > 0) return { valor: centavos(args.precoParceiro), origem: "cadastro" };
  if (args.precoBase != null && args.precoBase > 0 && args.descontoDoNivelPct != null) {
    return { valor: centavos(args.precoBase * (1 - args.descontoDoNivelPct / 100)), origem: "nivel" };
  }
  return null;
}

export function lucroPorUnidade(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null) return null;
  return centavos(preco - custo);
}

/** Margem sobre a venda, em %. Sem preço (ou preço zero) não há margem para mostrar. */
export function margemSobreVenda(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null || preco <= 0) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

export type PosicaoNoMercado = {
  menor: number;
  media: number;
  /** quanto o nosso preço está acima (+) ou abaixo (−) do mais barato, em % */
  contraOMenorPct: number;
  /** idem contra a média dos concorrentes */
  contraAMediaPct: number;
};

export function posicaoNoMercado(preco: number | null, concorrentes: number[]): PosicaoNoMercado | null {
  const validos = concorrentes.filter((p) => Number.isFinite(p) && p > 0);
  if (preco == null || preco <= 0 || validos.length === 0) return null;
  const menor = Math.min(...validos);
  const media = validos.reduce((s, p) => s + p, 0) / validos.length;
  const pct = (ref: number) => Math.round(((preco - ref) / ref) * 1000) / 10;
  return { menor, media: centavos(media), contraOMenorPct: pct(menor), contraAMediaPct: pct(media) };
}
