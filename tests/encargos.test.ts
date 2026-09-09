import { describe, expect, it } from "vitest";
import {
  PARCELAS,
  custoDaHora,
  parcelasDoRegime,
  quantoFalta,
  somarEncargos,
} from "../src/domain/financeiro/encargos";

/**
 * As 5 funções da casa estão a R$ 40/h com 0% de encargos. Estes testes fixam a
 * conta que mostra o tamanho do buraco — e, principalmente, que o módulo NÃO
 * escolhe alíquota sozinho.
 */

describe("as parcelas do encargo", () => {
  it("no Simples, o INSS patronal e o Sistema S ficam de fora", () => {
    const simples = parcelasDoRegime("simples");
    expect(simples).not.toContain("inss");
    expect(simples).not.toContain("terceiros");
    expect(simples).toContain("fgts");
    expect(simples).toContain("ferias");
  });

  it("fora do Simples entram todas", () => {
    expect(parcelasDoRegime("fora_do_simples")).toHaveLength(PARCELAS.length);
  });

  it("Simples soma perto de 32%, fora do Simples perto de 60%", () => {
    expect(somarEncargos(parcelasDoRegime("simples"))).toBeCloseTo(0.3219, 3);
    expect(somarEncargos(parcelasDoRegime("fora_do_simples"))).toBeCloseTo(0.5999, 3);
  });

  it("nenhuma parcela é obrigatória: quem escolhe é a casa", () => {
    expect(somarEncargos([])).toBe(0);
    expect(somarEncargos(["fgts"])).toBeCloseTo(0.08, 4);
  });

  it("chave inventada é ignorada, não somada como zero surpresa", () => {
    expect(somarEncargos(["fgts", "nao_existe"])).toBeCloseTo(0.08, 4);
  });
});

describe("o custo real da hora", () => {
  it("R$ 2.500 em 220 h com 32% de encargo dá R$ 15,00 a hora", () => {
    const r = custoDaHora({ salarioMensal: 2500, encargosPct: 0.3219 });
    expect(r.salarioHora).toBeCloseTo(11.36, 2);
    expect(r.custoHora).toBeCloseTo(15.02, 2);
    expect(r.acrescimo).toBeCloseTo(3.66, 2);
  });

  it("as horas são as CONTRATADAS, não as produtivas", () => {
    // 220 h é a jornada de 44h/semana. O salário é pago por elas tenha a
    // máquina rodado ou não — a ociosidade já entra no custo/hora da máquina.
    expect(custoDaHora({ salarioMensal: 2200, encargosPct: 0 }).salarioHora).toBe(10);
    expect(custoDaHora({ salarioMensal: 2200, horasMensais: 160, encargosPct: 0 }).salarioHora).toBeCloseTo(13.75, 2);
  });

  it("sem salário não inventa custo", () => {
    expect(custoDaHora({ salarioMensal: 0, encargosPct: 0.6 }).custoHora).toBe(0);
  });

  it("horas zero não vira divisão por zero", () => {
    expect(custoDaHora({ salarioMensal: 3000, horasMensais: 0, encargosPct: 0.3 }).custoHora).toBe(0);
  });

  it("encargo negativo não vira desconto no custo da pessoa", () => {
    const r = custoDaHora({ salarioMensal: 2200, encargosPct: -0.5 });
    expect(r.custoHora).toBe(10);
  });
});

describe("o tamanho do buraco", () => {
  it("60% de encargo ignorado é 37% a MENOS no bloco, não 60%", () => {
    // 1 − 1/1,6 = 0,375. Dizer "60% a menos" assustaria com o número errado.
    expect(quantoFalta(0.5999)).toBeCloseTo(0.375, 3);
  });

  it("32% ignorado é 24% a menos", () => {
    expect(quantoFalta(0.3219)).toBeCloseTo(0.2435, 3);
  });

  it("sem encargo nenhum, não falta nada", () => {
    expect(quantoFalta(0)).toBe(0);
  });
});
