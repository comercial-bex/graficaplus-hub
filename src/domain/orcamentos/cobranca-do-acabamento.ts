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

/** Quais lados da peça levam bainha e ilhós. */
export type LadosDaBainha = "contorno" | "maiores" | "menores";

export const OPCOES_DE_LADOS: readonly { chave: LadosDaBainha; titulo: string; detalhe: string }[] =
  [
    { chave: "contorno", titulo: "Contorno todo", detalhe: "os 4 lados" },
    { chave: "maiores", titulo: "Só os 2 lados maiores", detalhe: "os lados compridos" },
    { chave: "menores", titulo: "Só os 2 lados menores", detalhe: "em cima e embaixo, na largura" },
  ];

/**
 * O lado que sugerimos: banner leva bainha (e o bastão) em cima e embaixo, nos lados menores;
 * lona de fachada e o resto levam o contorno todo, que é o que segura o ilhós e a ventania.
 * É só o ponto de partida: a escolha é da equipe.
 */
export function ladosSugeridos(nomeDoProduto: string | null | undefined): LadosDaBainha {
  return /banner/i.test(nomeDoProduto ?? "") ? "menores" : "contorno";
}

/** Quanto cobrar (m ou m²) para a peça e a quantidade; 0 sem medida. */
export function quantidadeDoAcabamento(
  medida: MedidaCobrada,
  peca: { largura: number; altura: number; quantidade: number },
  lados: LadosDaBainha = "contorno",
): number {
  const l = Number(peca.largura);
  const a = Number(peca.altura);
  if (!(l > 0) || !(a > 0)) return 0;
  const qtd = Number(peca.quantidade) > 0 ? Number(peca.quantidade) : 1;
  if (medida === "area") return arred(l * a * qtd, 3);
  const metros =
    lados === "maiores"
      ? 2 * Math.max(l, a)
      : lados === "menores"
        ? 2 * Math.min(l, a)
        : 2 * (l + a);
  return arred(metros * qtd, 2);
}
