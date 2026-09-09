import { describe, expect, it } from "vitest";
import {
  espacoDeNegociacao,
  fatiasDoPreco,
  pisoDePreco,
  precoDeMargem,
} from "../src/domain/orcamentos/composicao-do-preco";

/**
 * A barra de composição existe para responder, na frente do cliente, até onde
 * dá para baixar. Um piso errado para os dois lados: alto demais recusa negócio
 * que ainda pagava, baixo demais vende no prejuízo.
 */

// Banner de 6 m²: material 57, máquina 6,18, mão de obra 20, sem outros.
const BANNER = {
  custoMateriais: 57,
  custoProcessos: 6.18,
  custoMaoDeObra: 20,
  outrosCustos: 0,
  custoTotal: 83.18,
  taxasVenda: 10.8,
  precoFinal: 180,
};

describe("as fatias do preço", () => {
  it("cada real do preço aparece em alguma fatia", () => {
    const f = fatiasDoPreco(BANNER);
    const soma = f.reduce((s, x) => s + x.valor, 0);
    expect(soma).toBeCloseTo(180, 2);
    expect(f.reduce((s, x) => s + x.fracao, 0)).toBeCloseTo(1, 3);
  });

  it("o lucro é o que sobra depois do custo E das taxas", () => {
    const lucro = fatiasDoPreco(BANNER).find((f) => f.chave === "lucro");
    // 180 − 83,18 − 10,80 = 86,02
    expect(lucro?.valor).toBeCloseTo(86.02, 2);
  });

  it("fatia zerada não vira faixa invisível na barra", () => {
    const f = fatiasDoPreco(BANNER);
    expect(f.find((x) => x.chave === "outros")).toBeUndefined();
    expect(f.every((x) => x.valor > 0)).toBe(true);
  });

  it("prejuízo é fatia PRÓPRIA, não lucro negativo desenhado pequeno", () => {
    // Preço abaixo do custo: a barra tem que gritar, não encolher.
    const ruim = fatiasDoPreco({ ...BANNER, precoFinal: 60, taxasVenda: 3.6 });
    const p = ruim.find((x) => x.chave === "prejuizo");
    expect(p).toBeDefined();
    // 60 − 83,18 − 3,60 = −26,78
    expect(p?.valor).toBeCloseTo(26.78, 2);
    expect(ruim.find((x) => x.chave === "lucro")).toBeUndefined();
    // E a soma das fatias passa do preço, que é o que se quer mostrar.
    expect(ruim.reduce((s, x) => s + x.valor, 0)).toBeGreaterThan(60);
  });
});

describe("o piso", () => {
  it("as taxas encolhem junto com o desconto: piso é custo ÷ (1 − taxa)", () => {
    // Com 6% de taxa e custo 83,18: 83,18 ÷ 0,94 = 88,49.
    expect(pisoDePreco(83.18, 0.06)).toBeCloseTo(88.49, 2);
    // custo + taxa daria 88,17 — parece perto, e recusaria negócio a 88,30
    // que ainda empatava.
    expect(pisoDePreco(83.18, 0.06)).toBeGreaterThan(83.18 * 1.06);
  });

  it("no piso o lucro dá exatamente zero", () => {
    const piso = pisoDePreco(83.18, 0.06);
    expect(piso - 83.18 - piso * 0.06).toBeCloseTo(0, 2);
  });

  it("sem taxa, o piso é o próprio custo", () => {
    expect(pisoDePreco(100, 0)).toBe(100);
  });

  it("taxa absurda não vira piso negativo", () => {
    expect(pisoDePreco(100, 5)).toBeGreaterThan(0);
  });
});

describe("o preço da margem aceita", () => {
  it("30% de margem com 6% de taxa: custo ÷ 0,64", () => {
    expect(precoDeMargem(83.18, 0.3, 0.06)).toBeCloseTo(129.97, 2);
  });

  it("margem somada à taxa passando de 100% não tem preço, e diz isso", () => {
    expect(precoDeMargem(100, 0.95, 0.1)).toBeNull();
  });
});

describe("espaço de negociação", () => {
  const base = { precoFinal: 180, custoTotal: 83.18, taxasVendaPct: 0.06, margemMinima: 0.3 };

  it("diz quanto dá para baixar até cada limite", () => {
    const e = espacoDeNegociacao(base);
    expect(e.piso).toBeCloseTo(88.49, 2);
    expect(e.minimo).toBeCloseTo(129.97, 2);
    expect(e.descontoAteMinimo).toBeCloseTo(50.03, 2);
    expect(e.descontoAtePiso).toBeCloseTo(91.51, 2);
    expect(e.descontoAtePisoPct).toBeCloseTo(0.508, 2);
  });

  it("abaixo da margem mínima mas ainda pagando: é decisão, não erro", () => {
    const e = espacoDeNegociacao({ ...base, precoFinal: 100 });
    expect(e.abaixoDoMinimo).toBe(true);
    expect(e.abaixoDoPiso).toBe(false);
  });

  it("abaixo do piso é pagar para trabalhar, e os dois estados não se confundem", () => {
    const e = espacoDeNegociacao({ ...base, precoFinal: 80 });
    expect(e.abaixoDoPiso).toBe(true);
    expect(e.abaixoDoMinimo).toBe(false);
    expect(e.descontoAtePiso).toBe(0);
  });

  it("no piso exato ainda não está abaixo dele", () => {
    const e = espacoDeNegociacao({ ...base, precoFinal: pisoDePreco(83.18, 0.06) });
    expect(e.abaixoDoPiso).toBe(false);
    expect(e.descontoAtePiso).toBe(0);
  });

  it("orçamento vazio não inventa espaço de desconto", () => {
    const e = espacoDeNegociacao({ precoFinal: 0, custoTotal: 0, taxasVendaPct: 0, margemMinima: 0.3 });
    expect(e.descontoAtePiso).toBe(0);
    expect(e.descontoAtePisoPct).toBe(0);
    expect(e.abaixoDoPiso).toBe(false);
  });
});
