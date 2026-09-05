import { test, expect } from "vitest";
import {
  faixaAplicada,
  faixasVigentes,
  proximaFaixa,
  descreverFaixa,
  type FaixaPreco,
} from "../src/domain/orcamentos/faixas";

const faixas: FaixaPreco[] = [
  { id: "c", quantidade_minima: 100, preco_unitario: 10.5 },
  { id: "a", quantidade_minima: 1, preco_unitario: 15 },
  { id: "b", quantidade_minima: 50, preco_unitario: 12 },
];

test("ordena as faixas da menor para a maior quantidade", () => {
  expect(faixasVigentes(faixas).map((f) => f.id)).toEqual(["a", "b", "c"]);
});

test("aplica a maior faixa já atingida", () => {
  expect(faixaAplicada(faixas, 1)?.id).toBe("a");
  expect(faixaAplicada(faixas, 49)?.id).toBe("a");
  expect(faixaAplicada(faixas, 50)?.id).toBe("b");
  expect(faixaAplicada(faixas, 250)?.id).toBe("c");
});

test("sem faixa quando a quantidade é menor que todos os mínimos", () => {
  expect(faixaAplicada([{ id: "x", quantidade_minima: 10, preco_unitario: 5 }], 3)).toBeNull();
});

test("próxima faixa é o degrau seguinte mais barato", () => {
  expect(proximaFaixa(faixas, 10)?.id).toBe("b");
  expect(proximaFaixa(faixas, 60)?.id).toBe("c");
  expect(proximaFaixa(faixas, 500)).toBeNull();
});

test("respeita vigência", () => {
  const hoje = new Date("2026-09-05T12:00:00Z");
  const comVigencia: FaixaPreco[] = [
    { id: "velha", quantidade_minima: 1, preco_unitario: 20, vigencia_fim: "2026-01-01" },
    { id: "atual", quantidade_minima: 1, preco_unitario: 15, vigencia_inicio: "2026-02-01" },
    { id: "futura", quantidade_minima: 1, preco_unitario: 9, vigencia_inicio: "2027-01-01" },
  ];
  expect(faixasVigentes(comVigencia, hoje).map((f) => f.id)).toEqual(["atual"]);
  expect(faixaAplicada(comVigencia, 5, hoje)?.id).toBe("atual");
});

test("texto da faixa", () => {
  expect(descreverFaixa(faixas[0], "un")).toContain("A partir de 100 un");
});
