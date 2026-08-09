import { test, expect } from "vitest";
import {
  areaUnitaria,
  areaTotal,
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
