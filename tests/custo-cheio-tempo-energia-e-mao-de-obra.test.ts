import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { custoDaHora, parcelasDoRegime, somarEncargos } from "@/domain/financeiro/encargos";

/**
 * 25/10/2026, auditoria de custos: a Lona 280g aparecia com R$ 33,20 de custo cheio (R$ 15,45 de
 * verdade). Mão de obra era o padrão semeado de R$ 40/h com 0% de encargos; o tempo de máquina vinha
 * de 20 min/m² quando a plotter faz 14 m²/h; a energia não entrava.
 */
const SQL = readFileSync("supabase/migrations/20261025300000_custo_cheio_tempo_energia_e_mao_de_obra.sql", "utf8");

describe("mão de obra pela regra da casa", () => {
  const encargos = somarEncargos(parcelasDoRegime("simples"));
  const hora = custoDaHora({ salarioMensal: 2342, horasMensais: 220, encargosPct: encargos });

  it("R$ 2.342 ÷ 220 h = R$ 10,65/h e os encargos do Simples somam 32,19%", () => {
    expect(hora.salarioHora).toBe(10.65);
    expect(encargos).toBe(0.3219);
    expect(SQL).toContain("custo_hora = 10.65, encargos_pct = 0.3219");
  });
  it("o custo da hora com encargos (R$ 14,07) é 2,8× menor que o padrão semeado de R$ 40", () => {
    expect(hora.custoHora).toBeCloseTo(14.07, 2);
    expect(40 / hora.custoHora).toBeGreaterThan(2.8);
  });
  it("R$ 40/h era 5,4× o salário mínimo-hora de 2026 (R$ 1.621 ÷ 220 = R$ 7,37)", () => {
    expect(1621 / 220).toBeCloseTo(7.37, 2);
    expect(40 / (1621 / 220)).toBeCloseTo(5.43, 1);
  });
});

describe("custo de um m² impresso (Lona 280g)", () => {
  it("máquina pela capacidade da plotter e mão de obra com o fator de acompanhamento", () => {
    const velocidade = 14; // m²/h da i1600
    const horasMaquina = 1 / velocidade;
    const maquina = horasMaquina * 14.4313 + horasMaquina * 1.0 * 1.1339; // locação + energia
    const maoDeObra = horasMaquina * 1.5 * 14.07;
    const indireto = horasMaquina * 1.5 * 12;
    const material = 11.055;
    expect(maquina).toBeCloseTo(1.11, 2);
    expect(maoDeObra).toBeCloseTo(1.51, 2);
    expect(indireto).toBeCloseTo(1.29, 2);
    expect(material + maquina + maoDeObra + indireto).toBeCloseTo(14.97, 1);
  });
});

describe("a migração", () => {
  it("usa a velocidade da máquina (a mesma da agenda) e soma a energia", () => {
    expect(SQL).toContain("v_h_maq := 1.0 / v_velocidade");
    expect(SQL).toContain("v_h_maq * v_kw * v_tarifa");
    expect(SQL).toContain("mo_fator_sobre_maquina");
  });
  it("só troca o padrão semeado: salário real digitado depois não é sobrescrito", () => {
    expect(SQL).toContain("WHERE ativo AND custo_hora = 40 AND COALESCE(encargos_pct, 0) = 0");
    expect(SQL).toContain("WHERE codigo = 'mo_custo_hora' AND valor = 40");
  });
  it("mantém o contrato de retorno da função (as chaves que as telas leem)", () => {
    for (const k of ["custo_material", "custo_maquina", "custo_mao_obra", "custo_indireto", "custo_total", "completo", "faltas"]) {
      expect(SQL).toContain(`'${k}'`);
    }
  });
});
