import { describe, expect, it } from "vitest";
import { laborCost, operationalCost } from "../src/domain/impressao3d/cost-engine";
import { custoDeEmbalagemDoItem } from "../src/domain/impressao3d/custo-administrativo";
import { horasDeMaoDeObraPorPeca } from "../src/domain/impressao3d/preco";

describe("custos opcionais iniciais no orçamento 3D", () => {
  it("sem horas e com embalagem desligada, o custo vazio é só os 2 minutos de mão de obra padrão", () => {
    const maoDeObra = laborCost([
      { minutos: horasDeMaoDeObraPorPeca(0) * 60, custoHoraSnapshot: 40 },
    ]);
    const embalagem = custoDeEmbalagemDoItem({ incluir: false, valor: 12 });
    const custo = operationalCost({
      material: 0,
      maquina: 0,
      energia: 0,
      maoDeObra: maoDeObra.toString(),
      indiretosRateados: embalagem.toString(),
    });
    // 2 min a R$ 40/h (decisão de 30/10, restabelecida em 13/11/2026)
    expect(maoDeObra.toNumber()).toBeCloseTo((2 * 40) / 60, 3);
    expect(embalagem.toNumber()).toBe(0);
    expect(custo.toNumber()).toBeCloseTo(maoDeObra.toNumber(), 3);
  });

  it("meia hora informada custa R$ 20 por peça com taxa de R$ 40/h", () => {
    const custo = laborCost([
      { minutos: horasDeMaoDeObraPorPeca(0.5) * 60, custoHoraSnapshot: 40 },
    ]).mul(100);
    expect(custo.toNumber()).toBe(2000);
  });
});
