import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { D } from "../src/domain/impressao3d/decimal";
import {
  fecharPreco,
  horasDeMaoDeObraPorPeca,
  PRECO_MINIMO_POR_PECA,
} from "../src/domain/impressao3d/preco";

describe("preço mínimo por peça no 3D", () => {
  it("o chaveiro que saía a R$ 1,78 passa a sair a R$ 5,00", () => {
    // operacional 0,89 com markup 2 → R$ 1,78 por peça
    const r = fecharPreco(D("0.89"), 2, 1, PRECO_MINIMO_POR_PECA);
    expect(r.unitario.toNumber()).toBe(5);
    expect(r.peloMinimo).toBe(true);
    expect(r.preco.toNumber()).toBe(5);
  });

  it("o total do lote continua sendo o unitário vezes a quantidade", () => {
    const r = fecharPreco(D("4.5"), 2, 10, PRECO_MINIMO_POR_PECA); // 0,90 por peça → mínimo
    expect(r.unitario.toNumber()).toBe(5);
    expect(r.preco.toNumber()).toBe(50);
  });

  it("peça que já passa do mínimo não muda, nem o centavo do arredondamento", () => {
    const r = fecharPreco(D("22.2867"), 2, 2, PRECO_MINIMO_POR_PECA);
    expect(r.peloMinimo).toBe(false);
    expect(r.unitario.toNumber()).toBe(22.29);
    expect(r.preco.toNumber()).toBe(44.58);
  });

  it("sem mínimo informado o comportamento é o de antes", () => {
    const r = fecharPreco(D("0.89"), 2, 1);
    expect(r.unitario.toNumber()).toBe(1.78);
    expect(r.peloMinimo).toBe(false);
  });
});

describe("mão de obra por peça no 3D", () => {
  it("zero não acrescenta horas automáticas", () => {
    expect(horasDeMaoDeObraPorPeca(0)).toBe(0);
  });
  it("horas inválidas não geram mão de obra", () => {
    expect(horasDeMaoDeObraPorPeca(NaN)).toBe(0);
    expect(horasDeMaoDeObraPorPeca(Infinity)).toBe(0);
    expect(horasDeMaoDeObraPorPeca(-1)).toBe(0);
  });
  it("horas informadas valem como informadas", () => {
    expect(horasDeMaoDeObraPorPeca(0.5)).toBe(0.5);
  });
});

describe("a calculadora 3D", () => {
  const tela = readFileSync("src/components/impressao3d/calculadora-3d.tsx", "utf8");
  it("usa as horas informadas e o piso por peça, e avisa quando o piso vale", () => {
    expect(tela).toContain("horasDeMaoDeObraPorPeca(num(f.mo_horas))");
    expect(tela).toContain("PRECO_MINIMO_POR_PECA,");
    expect(tela).toContain('data-testid="preco-minimo-3d"');
  });
  it("grava no orçamento as horas que de fato entraram na conta", () => {
    expect(tela).toContain("horas: calc.horasMaoDeObra");
  });
});
