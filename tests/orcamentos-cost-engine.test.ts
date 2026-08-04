import { test, expect } from "vitest";
import {
  calcularOrcamento,
  custoMaterial,
  custoProcesso,
  custoMaoDeObra,
  precoParaMargem,
  percentualDesperdicio,
} from "../src/domain/orcamentos/cost-engine";

test("custo de material considera perda/refile", () => {
  // 10 m2 com 20% de perda = 12,5 m2 reais x R$ 20 = R$ 250
  expect(custoMaterial({ descricao: "Lona", quantidade: 10, custoUnitario: 20, perdaPct: 0.2 })).toBeCloseTo(250, 2);
});

test("custo de processo soma setup e energia", () => {
  // 2h + 30min setup = 2,5h x 40 = 100 ; energia 2,5h x 1,5kW x 0,9 = 3,375
  const c = custoProcesso({ descricao: "Impressão", horas: 2, custoHora: 40, setupMin: 30, potenciaKw: 1.5, tarifaKwh: 0.9 });
  expect(c).toBeCloseTo(103.375, 3);
});

test("mão de obra aplica encargos", () => {
  expect(custoMaoDeObra({ descricao: "Designer", horas: 3, custoHora: 40, encargosPct: 0.8 })).toBeCloseTo(216, 2);
});

test("fechamento custo + markup = preço", () => {
  const r = calcularOrcamento({
    quantidade: 10,
    markupPadraoPct: 0.5,
    materiais: [{ descricao: "Lona", quantidade: 10, custoUnitario: 20 }],
    processos: [{ descricao: "Impressão", horas: 1, custoHora: 40 }],
    maoDeObra: [{ descricao: "Acabamento", horas: 1, custoHora: 30 }],
  });
  expect(r.custoTotal).toBeCloseTo(270, 2);
  expect(r.precoFinal).toBeCloseTo(405, 2);
  expect(r.lucro).toBeCloseTo(135, 2);
  expect(r.precoUnitario).toBeCloseTo(40.5, 2);
});

test("desconto e taxas de venda reduzem o lucro", () => {
  const r = calcularOrcamento({
    markupPadraoPct: 1,
    descontoPct: 0.1,
    taxasVendaPct: 0.1,
    materiais: [{ descricao: "Papel", quantidade: 1, custoUnitario: 100 }],
    processos: [],
    maoDeObra: [],
  });
  expect(r.precoBruto).toBeCloseTo(200, 2);
  expect(r.precoFinal).toBeCloseTo(180, 2);
  expect(r.taxasVenda).toBeCloseTo(18, 2);
  expect(r.lucro).toBeCloseTo(62, 2);
});

test("preço para margem alvo", () => {
  expect(precoParaMargem(100, 0.3, 0.1)).toBeCloseTo(166.67, 2);
});

test("percentual de desperdício", () => {
  expect(percentualDesperdicio(100, 8)).toBeCloseTo(0.08, 4);
  expect(percentualDesperdicio(0, 5)).toBe(0);
});
