import { areaCobrada, areaTotal, areaUnitaria, temDimensoes } from "./area";
import { camposDaUnidade } from "./tipos-de-produto";

/**
 * A linha que o vendedor lê antes de apertar "Adicionar":
 *
 *   3 × Lona 440g reforçada · 3,00 × 2,00 m = 6,00 m² a peça · 18,00 m² · R$ 1.260,00
 *
 * É a mesma conta da tabela de itens e do PDF, dita em uma frase. Preço só
 * entra quando quem olha vê preço; sem ele a frase termina na metragem.
 */
export type EntradaDoResumo = {
  descricao: string;
  quantidade: number;
  unidade: string;
  largura?: number | null;
  altura?: number | null;
  areaMinima?: number | null;
  /** Total do item (valor unitário × quantidade). Omitido = não mostra preço. */
  valorTotal?: number | null;
};

const metros = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (v: number) => `${metros(v)} m²`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function fraseDoResumo(e: EntradaDoResumo): string {
  const qtd = e.quantidade > 0 ? e.quantidade : 1;
  const campos = camposDaUnidade(e.unidade);
  const nome = e.descricao.trim() || "item sem descrição";
  const partes: string[] = [];

  const dims = { largura: e.largura, altura: e.altura, quantidade: qtd };
  if (temDimensoes(dims)) {
    const peca = areaUnitaria(dims);
    const total = areaTotal(dims);
    const cobrada = areaCobrada(dims, e.areaMinima);
    partes.push(`${qtd} × ${nome}`);
    partes.push(`${metros(dims.largura!)} × ${metros(dims.altura!)} m = ${m2(peca)} a peça`);
    if (qtd > 1) partes.push(`${m2(total)} no total`);
    if (cobrada > total + 0.0001) partes.push(`cobrado ${m2(cobrada)} (mínimo)`);
  } else {
    const nomeQtd =
      qtd === 1 ? campos.nomeDaQuantidade.singular : campos.nomeDaQuantidade.plural;
    partes.push(`${qtd.toLocaleString("pt-BR")} ${nomeQtd} de ${nome}`);
  }

  if (e.valorTotal != null && Number.isFinite(e.valorTotal)) partes.push(brl(e.valorTotal));
  return partes.join(" · ");
}
