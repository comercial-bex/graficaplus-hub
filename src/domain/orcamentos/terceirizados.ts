/**
 * Terceirizados do produto (fase 3 do plano de 02/11/2026, como o "Insira os
 * terceirizados deste produto" do Holdprint): o que a gráfica paga a um
 * terceiro para fazer este produto (corte a laser fora, acabamento, frete do
 * fornecedor). Cada linha tem um valor e uma base: por peça, por m² da peça ou
 * por pedido (dividido entre as peças). O banco soma isso ao custo do item
 * junto com o material por fórmula (`custo_formulas`); aqui fica a mesma conta
 * para a tela mostrar antes de salvar, só para quem vê custo.
 */

export type BaseDoTerceirizado = "peca" | "m2" | "pedido";

export const BASES_DO_TERCEIRIZADO: { valor: BaseDoTerceirizado; rotulo: string }[] = [
  { valor: "peca", rotulo: "por peça" },
  { valor: "m2", rotulo: "por m² da peça" },
  { valor: "pedido", rotulo: "por pedido (dividido entre as peças)" },
];

export function rotuloDaBase(base: string | null | undefined): string {
  return BASES_DO_TERCEIRIZADO.find((b) => b.valor === base)?.rotulo ?? "por peça";
}

export type TerceirizadoDoProduto = {
  id: string;
  descricao: string;
  fornecedor_id?: string | null;
  fornecedor?: { nome: string } | null;
  valor: number | string;
  base: string;
};

export type LinhaDeTerceirizado = {
  id: string;
  descricao: string;
  fornecedor: string | null;
  base: BaseDoTerceirizado;
  valor: number;
  /** O que entra no custo de cada peça do item, nesta medida e quantidade. */
  porPeca: number;
};

/**
 * R$ por peça sem esconder fração de centavo: R$ 100 por pedido em 30.000 peças são
 * R$ 0,0033 por peça, não R$ 0,00. O banco guarda o custo por peça sem arredondar
 * (o total do item é custo × quantidade), e a tela mostra o mesmo número.
 */
export function brlPorPeca(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/**
 * Quanto cada terceirizado custa por peça, na medida e na quantidade do item, SEM arredondar
 * a centavos: é a mesma conta do gatilho do banco (revisão de 03/11/2026). Por pedido divide
 * pela quantidade como ela é; só quantidade vazia ou zero conta como 1 peça.
 */
export function custoDosTerceirizados(
  linhas: readonly TerceirizadoDoProduto[],
  peca: { largura: number | null | undefined; altura: number | null | undefined; quantidade: number | null | undefined },
): { linhas: LinhaDeTerceirizado[]; total: number } {
  const largura = Number(peca.largura) > 0 ? Number(peca.largura) : 0;
  const altura = Number(peca.altura) > 0 ? Number(peca.altura) : 0;
  const quantidade = Number(peca.quantidade) > 0 ? Number(peca.quantidade) : 1;
  const saida: LinhaDeTerceirizado[] = [];
  for (const t of linhas) {
    const valor = Number(t.valor);
    if (!(valor > 0)) continue;
    const base: BaseDoTerceirizado = t.base === "m2" || t.base === "pedido" ? t.base : "peca";
    const porPeca =
      base === "m2" ? valor * largura * altura : base === "pedido" ? valor / quantidade : valor;
    saida.push({
      id: t.id,
      descricao: t.descricao,
      fornecedor: t.fornecedor?.nome ?? null,
      base,
      valor,
      porPeca,
    });
  }
  return { linhas: saida, total: saida.reduce((s, l) => s + l.porPeca, 0) };
}

/** Pendência do cadastro de um terceirizado novo, em uma frase; nula quando pode gravar. */
export function pendenciaDoTerceirizado(t: { descricao: string; valor: string; base: string }): string | null {
  if (!t.descricao.trim()) return "Diga o que é terceirizado.";
  const v = Number(String(t.valor).replace(",", "."));
  if (!(v > 0)) return "Informe o valor que a gráfica paga.";
  if (!["peca", "m2", "pedido"].includes(t.base)) return "Escolha a base: por peça, por m² ou por pedido.";
  return null;
}
