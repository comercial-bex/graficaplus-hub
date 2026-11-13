import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { D } from "../src/domain/impressao3d/decimal";
import { calcularPeca3D, type EntradasDaPeca3D } from "../src/domain/impressao3d/calcular-peca";
import {
  fecharPreco,
  horasDeMaoDeObraPorPeca,
  POS_PROCESSAMENTO_PADRAO_MIN,
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
  // Decisão do dono de 30/10/2026, restabelecida em 13/11/2026 (a troca de 05/11 para "só as informadas"
  // zerava a mão de obra de quem cota sem ver custo, desde que a conta passou para o servidor em 11/11).
  const PADRAO = POS_PROCESSAMENTO_PADRAO_MIN / 60;

  it("o padrão é de 2 minutos por peça", () => {
    expect(POS_PROCESSAMENTO_PADRAO_MIN).toBe(2);
  });
  it("em branco ou zero valem os 2 minutos", () => {
    expect(horasDeMaoDeObraPorPeca(0)).toBe(PADRAO);
  });
  it("horas inválidas também caem no padrão, nunca em zero", () => {
    expect(horasDeMaoDeObraPorPeca(NaN)).toBe(PADRAO);
    expect(horasDeMaoDeObraPorPeca(Infinity)).toBe(PADRAO);
    expect(horasDeMaoDeObraPorPeca(-1)).toBe(PADRAO);
  });
  it("horas informadas valem como informadas", () => {
    expect(horasDeMaoDeObraPorPeca(0.5)).toBe(0.5);
  });
});

describe("a conta da peça 3D leva a mão de obra padrão", () => {
  const base: EntradasDaPeca3D = {
    gramasModelo: 50,
    pesoSuporteG: 0,
    pesoPurgaG: 0,
    tempoMinutos: 120,
    quantidade: 10,
    pecasPorPlaca: 10,
    moHoras: 0,
    embalagemIncluida: false,
    custoPorGrama: 0.1,
    custoHoraMaquina: 1.349,
    potenciaW: 150,
    tarifaKwh: 1.1339,
    moCustoHora: 12.17,
    embalagemValor: 0,
    pctAcabamento: 5,
    pctFalha: 5,
    markup: 2,
    markupAtacado: 1.5,
  };

  it("quem não informa horas (o vendedor) paga 2 minutos por peça vezes a quantidade", () => {
    const r = calcularPeca3D(base);
    // 10 peças × 2 min × R$ 12,17/h
    expect(r.maoDeObra.toNumber()).toBeCloseTo((10 * 2 * 12.17) / 60, 3);
    expect(r.horasMaoDeObra).toBe(2 / 60);
  });

  it("os 2 minutos são o mesmo que digitar 2 minutos: a gerência e o vendedor cotam o mesmo preço", () => {
    const vendedor = calcularPeca3D({ ...base, moHoras: 0 });
    const gerencia = calcularPeca3D({ ...base, moHoras: 2 / 60 });
    expect(vendedor.preco.toNumber()).toBe(gerencia.preco.toNumber());
  });

  it("horas informadas mandam: 10 minutos custam mais que o padrão", () => {
    const padrao = calcularPeca3D(base);
    const dez = calcularPeca3D({ ...base, moHoras: 10 / 60 });
    expect(dez.maoDeObra.toNumber()).toBeGreaterThan(padrao.maoDeObra.toNumber());
    expect(dez.horasMaoDeObra).toBe(10 / 60);
  });
});

describe("a calculadora 3D", () => {
  const tela = readFileSync("src/components/impressao3d/calculadora-3d.tsx", "utf8");
  // Desde 11/11/2026 (onda C) a conta mora num módulo só, o mesmo que o servidor roda para quem não vê custo.
  const modulo = readFileSync("src/domain/impressao3d/calcular-peca.ts", "utf8");
  it("usa as horas informadas e o piso por peça, e avisa quando o piso vale", () => {
    expect(tela).toContain("moHoras: num(f.mo_horas)");
    expect(tela).toContain("calcularPeca3D(entradasDaConta)");
    expect(modulo).toContain("horasDeMaoDeObraPorPeca(e.moHoras)");
    expect(modulo).toContain("PRECO_MINIMO_POR_PECA,");
    expect(tela).toContain('data-testid="preco-minimo-3d"');
  });
  it("grava no orçamento as horas que de fato entraram na conta", () => {
    expect(tela).toContain("inputsDoItem3d(entradasDaConta, calc,");
    expect(modulo).toContain("horas: r.horasMaoDeObra");
  });
});
