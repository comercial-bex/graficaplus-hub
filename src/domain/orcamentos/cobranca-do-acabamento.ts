/**
 * Cobrar o acabamento como uma linha do orçamento.
 *
 * Os acabamentos que têm preço (tabela `acabamentos`) já existem como produtos de serviço, que é
 * como a gráfica os cobra. Esta lista liga o acabamento ao produto de serviço e diz em que medida
 * ele é cobrado:
 *   - "perimetro": metros do contorno de cada peça × quantidade (bainha e ilhós correm ao redor);
 *   - "area": m² da peça × quantidade (laminação cobre a peça inteira).
 *
 * A quantidade calculada só ESCREVE a linha: depois de adicionada, é uma linha comum, e a equipe
 * muda a quantidade quando a peça leva bainha só em dois lados, por exemplo.
 */

export type MedidaCobrada = "perimetro" | "area";

export type AcabamentoCobravel = {
  /** nome em `acabamentos.nome` */
  acabamento: string;
  /** nome em `produtos.nome` do serviço que cobra */
  servico: string;
  medida: MedidaCobrada;
};

export const ACABAMENTOS_COBRAVEIS: readonly AcabamentoCobravel[] = [
  {
    acabamento: "Bainha + ilhós",
    servico: "Acabamento de lona (bainha + ilhós)",
    medida: "perimetro",
  },
  { acabamento: "Laminação de adesivo", servico: "Laminação de adesivo", medida: "area" },
];

const chave = (n: string) => n.trim().toLowerCase();

export function acabamentoCobravel(nome: string): AcabamentoCobravel | null {
  return ACABAMENTOS_COBRAVEIS.find((a) => chave(a.acabamento) === chave(nome)) ?? null;
}

const arred = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Quanto cobrar (m ou m²) para a peça e a quantidade; 0 sem medida. */
export function quantidadeDoAcabamento(
  medida: MedidaCobrada,
  peca: { largura: number; altura: number; quantidade: number },
): number {
  const l = Number(peca.largura);
  const a = Number(peca.altura);
  if (!(l > 0) || !(a > 0)) return 0;
  const qtd = Number(peca.quantidade) > 0 ? Number(peca.quantidade) : 1;
  return medida === "perimetro" ? arred(2 * (l + a) * qtd, 2) : arred(l * a * qtd, 3);
}
