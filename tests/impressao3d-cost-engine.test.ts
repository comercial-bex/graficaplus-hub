import { test, expect } from "bun:test";
import { failureReserve, operationalCost, price, totalGrams, materialCostPerGram, materialCost, energyCost } from "../src/domain/impressao3d/cost-engine";

test("caso financeiro oficial", () => {
  const custo = operationalCost({ material: "30.5000", maquina: "35.7000", energia: "1.1220", maoDeObra: "40.0000", embalagem: "5.0000", indiretosRateados: "10.0000" });
  expect(custo.toString(4)).toBe("122.3220");
  const result = price({ custoOperacional: custo, tributosVenda: "0.06", taxaPagamento: "0.03", margemLiquidaAlvo: "0.25", margemMinima: "0.10", quantidade: 1 });
  expect(result.taxaVariavelTotal.toString(2)).toBe("0.09");
  expect(result.denominador.toString(2)).toBe("0.66");
  expect(result.precoBase.toString(6)).toBe("185.336363");
  expect(result.precoComercial.toString(2)).toBe("185.34");
});

test("reserva de falha oficial", () => {
  expect(failureReserve("0.10", 60).toString(6)).toBe("6.666660");
});

test("material, suporte, purga, torre e preparação", () => {
  const cpg = materialCostPerGram({ compra: 100, pesoLiquidoG: 1000, fatorAproveitamento: "0.95" });
  const grams = totalGrams({ modelo: 100, suporte: 10, purga: 5, torre: 3, preparacao: 2, extras: 0 });
  expect(grams.toString(4)).toBe("120.0000");
  expect(materialCost(grams, cpg).round(2).toString(2)).toBe("12.63");
});

test("denominador inválido é bloqueado", () => {
  expect(() => price({ custoOperacional: 100, tributosVenda: "0.50", taxaPagamento: "0.10", margemLiquidaAlvo: "0.50", margemMinima: "0.10", quantidade: 1 })).toThrow();
});

test("energia estimada e medida usam mesma fórmula base", () => {
  expect(energyCost({ potenciaMediaW: 200, horasImpressao: 2, potenciaAquecimentoW: 500, horasAquecimento: "0.1", potenciaSecadorW: 300, horasSecagem: 1, tarifaKwhSnapshot: "1.20" }).toString(4)).toBe("0.9000");
});
