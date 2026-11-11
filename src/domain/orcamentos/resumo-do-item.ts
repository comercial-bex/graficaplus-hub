import { areaLegivel, areaUnitaria, temDimensoes } from "./area";
import { camposDaUnidade } from "./tipos-de-produto";
import {
  areaExataCobradaDoLote,
  areaExataDoLote,
  medidaNaUnidadeCerta,
} from "@/domain/encaixe/linha-do-lote";

/**
 * A linha que o vendedor lê antes de apertar "Adicionar":
 *
 *   3 × Lona 440g reforçada · 3,00 × 2,00 m = 6,00 m² a peça · 18,00 m² · R$ 1.260,00
 *
 * É a mesma conta da tabela de itens e do PDF, dita em uma frase. Preço só
 * entra quando quem olha vê preço; sem ele a frase termina na metragem.
 *
 * As áreas saem pela mesma regra de casas do resto da tela (`areaLegivel`: cm²
 * abaixo de 0,01 m², senão de duas a três casas) e a medida sem perder precisão
 * (`medidaNaUnidadeCerta`: um adesivo de 4,5 cm é "4,5 × 4,5 cm", não "0,05 × 0,05 m").
 * A área do lote vem exata, não arredondada em 3 casas (ver `linha-do-lote.ts`).
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

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function fraseDoResumo(e: EntradaDoResumo): string {
  const qtd = e.quantidade > 0 ? e.quantidade : 1;
  const campos = camposDaUnidade(e.unidade);
  const nome = e.descricao.trim() || "item sem descrição";
  const partes: string[] = [];

  const dims = { largura: e.largura, altura: e.altura, quantidade: qtd };
  if (temDimensoes(dims)) {
    const peca = areaUnitaria(dims);
    const total = areaExataDoLote(dims);
    const cobrada = areaExataCobradaDoLote(dims, e.areaMinima);
    partes.push(`${qtd} × ${nome}`);
    // A peça miúda sai em cm² ("25 cm² a peça"); o lote só sai em cm² quando é miúdo de verdade.
    const medida = medidaNaUnidadeCerta(dims.largura!, dims.altura!);
    partes.push(`${medida} = ${areaLegivel(peca)} a peça`);
    if (qtd > 1) partes.push(`${areaLegivel(total)} no total`);
    if (cobrada > total + 0.0001) partes.push(`cobrado ${areaLegivel(cobrada)} (mínimo)`);
  } else {
    const nomeQtd =
      qtd === 1 ? campos.nomeDaQuantidade.singular : campos.nomeDaQuantidade.plural;
    partes.push(`${qtd.toLocaleString("pt-BR")} ${nomeQtd} de ${nome}`);
  }

  if (e.valorTotal != null && Number.isFinite(e.valorTotal)) partes.push(brl(e.valorTotal));
  return partes.join(" · ");
}
