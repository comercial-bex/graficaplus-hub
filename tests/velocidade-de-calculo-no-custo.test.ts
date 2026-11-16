import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { velocidadeUsadaNoCusto } from "@/domain/maquinas/velocidade-de-calculo";
import { tempoImpressao } from "@/domain/producao/tempo-de-maquina";

/**
 * Calculadora do orçamento: usa velocidade_calculo_m2_h quando existir (Plotter i1600: 10 em vez de 14) e não
 * quebra quando a coluna não existe no banco ainda.
 */

const calc = readFileSync(join(__dirname, "..", "src/components/orcamento/calculadora-custo.tsx"), "utf8");

describe("velocidadeUsadaNoCusto", () => {
  it("sem velocidade de cálculo, vale o que sempre valeu: o modo escolhido ou a nominal", () => {
    expect(velocidadeUsadaNoCusto({ nominal: 14 })).toBe(14);
    expect(velocidadeUsadaNoCusto({ nominal: 14, modo: 28 })).toBe(28);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: null, modo: 7 })).toBe(7);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 0 })).toBe(14);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: undefined })).toBe(14);
    expect(velocidadeUsadaNoCusto({ nominal: "14", calculo: "" })).toBe(14);
  });

  it("com velocidade de cálculo e sem modo, ela vale como está", () => {
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 10 })).toBe(10);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: "10" })).toBe(10);
    expect(velocidadeUsadaNoCusto({ calculo: 10 })).toBe(10);
  });

  it("com modo escolhido, a margem de segurança da máquina vale sobre a velocidade do modo", () => {
    // i1600: Produção 14 vira 10, Rascunho 28 vira 20, Qualidade 9,3 vira 6,64, Alta qualidade 7 vira 5
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 10, modo: 14 })).toBeCloseTo(10, 10);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 10, modo: 28 })).toBeCloseTo(20, 10);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 10, modo: 9.3 })).toBeCloseTo(6.643, 3);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: 10, modo: 7 })).toBeCloseTo(5, 10);
  });

  it("modo sem nominal conhecida cai na velocidade de cálculo, e velocidade inválida nunca vira tempo zero", () => {
    expect(velocidadeUsadaNoCusto({ calculo: 10, modo: 28 })).toBe(10);
    expect(velocidadeUsadaNoCusto({ nominal: 14, calculo: -3, modo: 14 })).toBe(14);
    expect(velocidadeUsadaNoCusto({})).toBe(0);
    expect(velocidadeUsadaNoCusto({ nominal: "x", calculo: "y", modo: "z" })).toBe(0);
  });

  it("o tempo de máquina de 10 m² sobe de 43 para 60 minutos na i1600, e velocidade 0 não deriva", () => {
    const antes = tempoImpressao({ areaM2: 10, velocidadeM2H: velocidadeUsadaNoCusto({ nominal: 14 }) });
    const depois = tempoImpressao({ areaM2: 10, velocidadeM2H: velocidadeUsadaNoCusto({ nominal: 14, calculo: 10 }) });
    expect(antes.minutos).toBeCloseTo(42.857, 2);
    expect(depois.minutos).toBeCloseTo(60, 6);
    expect(tempoImpressao({ areaM2: 10, velocidadeM2H: velocidadeUsadaNoCusto({}) }).derivado).toBe(false);
  });
});

describe("a calculadora do orçamento", () => {
  it("usa a função, com a nominal, a de cálculo e a do modo", () => {
    expect(calc).toContain("velocidadeUsadaNoCusto({");
    expect(calc).toContain("nominal: maq.velocidade_m2_h");
    expect(calc).toContain("calculo: maq.velocidade_calculo_m2_h");
    expect(calc).toContain("modo: modo ? modo.velocidade_m2_h : null");
    expect(calc).not.toMatch(/const velocidade = modo \? Number\(modo\.velocidade_m2_h\) : Number\(maq\.velocidade_m2_h/);
  });

  it("não nomeia a coluna nova no select: a consulta não quebra se a coluna ainda não existe", () => {
    const sel = calc.slice(calc.indexOf('.from("maquinas_financeiro" as never)'), calc.indexOf(".eq(\"ativa\", true)"));
    expect(sel).toContain('.select("*")');
    const semComentarios = sel.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(semComentarios).not.toContain("velocidade_calculo_m2_h");
  });
});
