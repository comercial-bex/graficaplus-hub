import { describe, expect, it } from "vitest";
import { pagoDoBem, resumoPatrimonio, type MaquinaPatrimonio } from "../src/domain/financeiro/patrimonio";

/**
 * O erro que estes testes existem para impedir: tratar máquina alugada como
 * patrimônio. A i1600 custa R$ 2.309 por mês por 36 meses e no fim volta para o
 * locador — contar isso como ativo faria a casa achar que tem R$ 83 mil que não
 * tem.
 */

const m = (p: Partial<MaquinaPatrimonio>): MaquinaPatrimonio => ({
  id: "x", nome: "Máquina", forma_aquisicao: "quitada", valor_aquisicao: 0,
  patrimonio: 0, divida: 0, ativa: true, compromisso_id: null,
  pendencia_patrimonio: null, pendencia_divida: null, ...p,
});

// O parque real da casa hoje.
const CNC = m({ id: "cnc", nome: "CNC Laser 10060", forma_aquisicao: "financiada", valor_aquisicao: 66979.68, patrimonio: 66979.68, divida: 60435.9, compromisso_id: "k1" });
const I1600 = m({ id: "i", nome: "Plotter i1600", forma_aquisicao: "locada", valor_aquisicao: null, patrimonio: 0, divida: 83124, compromisso_id: "k2" });
const BAMBU = m({ id: "b", nome: "Bambu Lab A1", valor_aquisicao: 5500, patrimonio: 5500 });
const RECORTE = m({ id: "r", nome: "Plotter de Recorte", valor_aquisicao: null, patrimonio: 0, pendencia_patrimonio: "falta o valor do bem" });
const FIBER = m({ id: "f", nome: "Fiber 30W", forma_aquisicao: "financiada", valor_aquisicao: null, patrimonio: 0, pendencia_patrimonio: "falta o valor do bem", pendencia_divida: "financiada e sem compromisso cadastrado" });

describe("máquina alugada não é patrimônio", () => {
  it("a locação fica fora do bruto e fora da dívida sobre bens", () => {
    const r = resumoPatrimonio([I1600]);
    expect(r.patrimonioBruto).toBe(0);
    expect(r.dividaSobreBens).toBe(0);
    expect(r.patrimonioLiquido).toBe(0);
  });

  it("mas continua sendo compromisso a pagar, à parte", () => {
    const r = resumoPatrimonio([I1600]);
    expect(r.compromissoLocacao).toBe(83124);
    expect(r.totalAPagar).toBe(83124);
  });

  it("no parque real, o alugado não entra no líquido e entra no total a pagar", () => {
    const r = resumoPatrimonio([CNC, I1600, BAMBU, RECORTE, FIBER]);
    // 66.979,68 do CNC + 5.500 do Bambu. A i1600 não conta.
    expect(r.patrimonioBruto).toBeCloseTo(72479.68, 2);
    expect(r.dividaSobreBens).toBeCloseTo(60435.9, 2);
    expect(r.patrimonioLiquido).toBeCloseTo(12043.78, 2);
    expect(r.compromissoLocacao).toBe(83124);
    expect(r.totalAPagar).toBeCloseTo(143559.9, 2);
  });

  it("não se compra o que se aluga: locada não tem percentual pago do bem", () => {
    expect(pagoDoBem(I1600)).toBeNull();
  });
});

describe("o que falta é dito, não escondido", () => {
  it("máquina financiada sem compromisso e sem valor entra como incompleta", () => {
    const r = resumoPatrimonio([FIBER]);
    expect(r.incompletas.map((x) => x.id)).toEqual(["f"]);
  });

  it("quitada sem valor também: ela esconde patrimônio, não dívida", () => {
    const r = resumoPatrimonio([RECORTE]);
    expect(r.incompletas).toHaveLength(1);
    expect(r.patrimonioBruto).toBe(0);
  });

  it("parque completo não inventa pendência", () => {
    expect(resumoPatrimonio([CNC, BAMBU, I1600]).incompletas).toEqual([]);
  });
});

describe("contagem e proporção", () => {
  it("conta cada forma de aquisição", () => {
    const r = resumoPatrimonio([CNC, I1600, BAMBU, RECORTE, FIBER]);
    expect(r).toMatchObject({ quitadas: 2, financiadas: 2, locadas: 1 });
  });

  it("máquina inativa fica fora de tudo", () => {
    const r = resumoPatrimonio([CNC, m({ id: "z", ativa: false, patrimonio: 999999, divida: 999999 })]);
    expect(r.patrimonioBruto).toBeCloseTo(66979.68, 2);
    expect(r.dividaSobreBens).toBeCloseTo(60435.9, 2);
  });

  it("o pago do bem é sobre o VALOR, não sobre o total financiado com juros", () => {
    // 66.979,68 − 60.435,90 = 6.543,78 pagos → 9,8%
    expect(pagoDoBem(CNC)).toBeCloseTo(0.0977, 3);
  });

  it("quitada é 100%, e sem valor cadastrado não inventa percentual", () => {
    expect(pagoDoBem(BAMBU)).toBe(1);
    expect(pagoDoBem(RECORTE)).toBeNull();
  });

  it("dívida maior que o bem não vira percentual negativo", () => {
    expect(pagoDoBem(m({ patrimonio: 1000, divida: 5000 }))).toBe(0);
  });

  it("parque vazio devolve zeros, não NaN", () => {
    const r = resumoPatrimonio([]);
    expect(r.patrimonioLiquido).toBe(0);
    expect(r.totalAPagar).toBe(0);
  });
});
