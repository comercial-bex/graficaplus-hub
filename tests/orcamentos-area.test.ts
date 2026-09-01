import { test, expect } from "vitest";
import {
  areaCobrada,
  baseDeConsumo,
  areaUnitaria,
  areaTotal,
  ehUnidadeDeArea,
  valorUnitarioComMinimo,
  valorUnitarioPorM2,
  precoM2Implicito,
  somaAreaTotal,
  descreverMetragem,
  temDimensoes,
} from "../src/domain/orcamentos/area";

// Os dois itens abaixo são o orçamento 1059 real da operação, usado como
// referência do formato. Se estes números mudarem, o documento que vai ao
// cliente deixa de bater com o que a gráfica cobra hoje.
const item1 = { largura: 3.0, altura: 2.45, quantidade: 3 }; // adesivo starpac RP400
const item2 = { largura: 1.1, altura: 0.4, quantidade: 1 };

test("área unitária é a peça, não o lote", () => {
  expect(areaUnitaria(item1)).toBeCloseTo(7.35, 3);
  expect(areaUnitaria(item2)).toBeCloseTo(0.44, 3);
});

test("área total multiplica pela quantidade", () => {
  expect(areaTotal(item1)).toBeCloseTo(22.05, 3);
  expect(areaTotal(item2)).toBeCloseTo(0.44, 3);
});

test("soma das áreas reproduz o total do orçamento 1059", () => {
  expect(somaAreaTotal([item1, item2])).toBeCloseTo(22.49, 3);
});

test("valor unitário sai do preço por m² e reproduz os valores do 1059", () => {
  // R$ 35,00/m² x 7,35m² = R$ 257,25 (valor unitário) ; x3 = R$ 771,75
  expect(valorUnitarioPorM2(item1, 35)).toBeCloseTo(257.25, 2);
  expect(valorUnitarioPorM2(item1, 35) * item1.quantidade).toBeCloseTo(771.75, 2);
  // R$ 47,00/m² x 0,44m² = R$ 20,68
  expect(valorUnitarioPorM2(item2, 47)).toBeCloseTo(20.68, 2);
});

test("total do orçamento 1059 fecha em R$ 792,43", () => {
  const total =
    valorUnitarioPorM2(item1, 35) * item1.quantidade +
    valorUnitarioPorM2(item2, 47) * item2.quantidade;
  expect(total).toBeCloseTo(792.43, 2);
});

test("preço por m² implícito permite conferir um valor digitado à mão", () => {
  expect(precoM2Implicito(item1, 257.25)).toBeCloseTo(35, 2);
  expect(precoM2Implicito(item2, 20.68)).toBeCloseTo(47, 2);
});

test("item sem dimensão não é tratado como venda por área", () => {
  const avulso = { quantidade: 10 };
  expect(temDimensoes(avulso)).toBe(false);
  expect(areaUnitaria(avulso)).toBe(0);
  expect(areaTotal(avulso)).toBe(0);
  expect(valorUnitarioPorM2(avulso, 35)).toBe(0);
  expect(precoM2Implicito(avulso, 100)).toBeNull();
  expect(descreverMetragem(avulso)).toBeNull();
});

test("dimensão zerada ou negativa não vira área", () => {
  expect(areaTotal({ largura: 0, altura: 2, quantidade: 1 })).toBe(0);
  expect(areaTotal({ largura: -3, altura: 2, quantidade: 1 })).toBe(0);
  expect(areaTotal({ largura: 3, altura: null, quantidade: 1 })).toBe(0);
});

test("quantidade ausente conta como uma peça", () => {
  expect(areaTotal({ largura: 2, altura: 1.5 })).toBeCloseTo(3, 3);
  expect(areaTotal({ largura: 2, altura: 1.5, quantidade: 0 })).toBeCloseTo(3, 3);
});

// O mínimo mexe em preço de venda; estes casos travam a regra.
const adesivoPequeno = { largura: 0.2, altura: 0.3, quantidade: 2 }; // 0,06m² a peça

test("sem mínimo definido, nada muda", () => {
  expect(areaCobrada(adesivoPequeno)).toBeCloseTo(0.12, 3);
  expect(areaCobrada(adesivoPequeno, null)).toBeCloseTo(0.12, 3);
  expect(areaCobrada(adesivoPequeno, 0)).toBeCloseTo(0.12, 3);
});

test("mínimo vale por peça e depois multiplica pela quantidade", () => {
  // dez adesivos pequenos consomem dez setups, não um
  expect(areaCobrada(adesivoPequeno, 0.25)).toBeCloseTo(0.5, 3);
  expect(areaCobrada({ ...adesivoPequeno, quantidade: 10 }, 0.25)).toBeCloseTo(2.5, 3);
});

test("peça maior que o mínimo cobra a área real", () => {
  const grande = { largura: 1, altura: 1, quantidade: 1 };
  expect(areaCobrada(grande, 0.25)).toBeCloseTo(1, 3);
});

test("peça exatamente do tamanho do mínimo não é penalizada", () => {
  const exata = { largura: 0.5, altura: 0.5, quantidade: 1 }; // 0,25m²
  expect(areaCobrada(exata, 0.25)).toBeCloseTo(0.25, 3);
});

test("preço da peça respeita o mínimo — o caso que recupera margem", () => {
  // 0,06m² a R$ 55/m² daria R$ 3,30; com mínimo de 0,25m² vai a R$ 13,75
  expect(valorUnitarioComMinimo(adesivoPequeno, 55)).toBeCloseTo(3.3, 2);
  expect(valorUnitarioComMinimo(adesivoPequeno, 55, 0.25)).toBeCloseTo(13.75, 2);
  // e o total de 2 peças: R$ 6,60 vira R$ 27,50
  expect(valorUnitarioComMinimo(adesivoPequeno, 55, 0.25) * 2).toBeCloseTo(27.5, 2);
});

test("item sem dimensão não recebe mínimo", () => {
  const avulso = { quantidade: 5 };
  expect(areaCobrada(avulso, 0.25)).toBe(0);
  expect(valorUnitarioComMinimo(avulso, 55, 0.25)).toBe(0);
});

test("unidade de área é reconhecida nas duas grafias usadas no cadastro", () => {
  // O catálogo grava "m2" (11 dos 22 produtos); "m²" é digitado à mão.
  expect(ehUnidadeDeArea("m2")).toBe(true);
  expect(ehUnidadeDeArea("m²")).toBe(true);
  expect(ehUnidadeDeArea("M2")).toBe(true);
  expect(ehUnidadeDeArea(" m² ")).toBe(true);
  // Não confundir com metro linear, que também é usado (acabamento de lona).
  expect(ehUnidadeDeArea("m")).toBe(false);
  expect(ehUnidadeDeArea("un")).toBe(false);
  expect(ehUnidadeDeArea("km")).toBe(false);
  expect(ehUnidadeDeArea("")).toBe(false);
  expect(ehUnidadeDeArea(null)).toBe(false);
  expect(ehUnidadeDeArea(undefined)).toBe(false);
});

test("metragem é descrita no formato do documento", () => {
  expect(descreverMetragem(item1)).toBe("3,000m × 2,450m = 22,050m²");
  expect(descreverMetragem(item2)).toBe("1,100m × 0,400m = 0,440m²");
});

test("área arredonda em 3 casas sem acumular erro de ponto flutuante", () => {
  // 0.1 x 0.2 = 0.020000000000000004 em float
  expect(areaUnitaria({ largura: 0.1, altura: 0.2, quantidade: 1 })).toBe(0.02);
  // 1.005 x 1 arredondado a 3 casas
  expect(areaUnitaria({ largura: 1.005, altura: 1, quantidade: 1 })).toBe(1.005);
});

// A ficha técnica do produto multiplica por esta base. Trocar metragem por peças
// erraria o custo de material por um fator igual à área da peça.
test("baseDeConsumo usa a metragem cobrada quando o item é vendido por área", () => {
  expect(baseDeConsumo({ largura: 3, altura: 2, quantidade: 2 })).toBe(12);
});

test("baseDeConsumo usa a quantidade quando o item não tem dimensão", () => {
  expect(baseDeConsumo({ quantidade: 250 })).toBe(250);
});

test("baseDeConsumo respeita a área mínima por peça", () => {
  // dez adesivos de 0,06 m² com mínimo de 0,25: dez setups, não um
  expect(baseDeConsumo({ largura: 0.2, altura: 0.3, quantidade: 10 }, 0.25)).toBe(2.5);
});

test("baseDeConsumo trata quantidade ausente como uma peça", () => {
  expect(baseDeConsumo({ largura: 1.5, altura: 1 })).toBe(1.5);
  expect(baseDeConsumo({})).toBe(1);
});
