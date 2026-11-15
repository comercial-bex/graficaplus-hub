import { describe, expect, it } from "vitest";
import {
  barrasDaProposta,
  explicacaoDaBarra,
  faixaDaMargem,
  mediaPrecoM2,
  propostaResolve,
  REFERENCIA_M2,
  type PropostaDePreco,
} from "../../src/domain/precos/propostas";

const base: PropostaDePreco = {
  id: "00000000-0000-4000-8000-000000000001",
  produto_id: "00000000-0000-4000-8000-000000000002",
  produto_nome: "Necessaire",
  unidade: "un",
  preco_atual: 40,
  preco_proposto: 49.9,
  custo: 30,
  piso: 42.86,
  margem_minima: 30,
  margem_atual: 25,
  margem_proposta: 39.88,
  motivo: "Preço abaixo do piso.",
  origem: "abaixo_do_piso",
  created_at: "2026-11-15T12:00:00Z",
};

describe("faixa da margem", () => {
  it("vermelho abaixo do piso, amarelo perto, verde acima", () => {
    expect(faixaDaMargem(25, 30)).toBe("abaixo");
    expect(faixaDaMargem(30, 30)).toBe("perto");
    expect(faixaDaMargem(34.9, 30)).toBe("perto");
    expect(faixaDaMargem(35, 30)).toBe("acima");
    expect(faixaDaMargem(null, 30)).toBe("sem_dado");
  });
});

describe("barras na mesma escala", () => {
  it("as três barras vêm em ordem, cabem em 100 e a maior margem é a mais larga", () => {
    const b = barrasDaProposta(base);
    expect(b.map((x) => x.tipo)).toEqual(["piso", "atual", "proposta"]);
    for (const x of b) expect(x.largura).toBeGreaterThanOrEqual(0);
    for (const x of b) expect(x.largura).toBeLessThanOrEqual(100);
    expect(b[2].largura).toBeGreaterThan(b[1].largura);
    expect(b[1].faixa).toBe("abaixo");
    expect(b[2].faixa).toBe("acima");
  });
  it("margem negativa vira barra de largura zero, nunca negativa", () => {
    const b = barrasDaProposta({ margem_minima: 30, margem_atual: -40, margem_proposta: 31 });
    expect(b[1].largura).toBe(0);
    expect(b[1].valor).toBe(-40);
  });
  it("sem custo, as barras sem dado ficam vazias", () => {
    const b = barrasDaProposta({ margem_minima: 30, margem_atual: null, margem_proposta: null });
    expect(b[1].faixa).toBe("sem_dado");
    expect(b[2].largura).toBe(0);
  });
});

describe("a proposta resolve quando chega ao piso", () => {
  it("pelo piso em reais", () => {
    expect(propostaResolve(base)).toBe(true);
    expect(propostaResolve({ ...base, preco_proposto: 42 })).toBe(false);
  });
  it("sem piso, pela margem", () => {
    expect(propostaResolve({ ...base, piso: null, margem_proposta: 29 })).toBe(false);
    expect(propostaResolve({ ...base, piso: null, margem_proposta: 31 })).toBe(true);
  });
});

describe("média do metro quadrado", () => {
  it("ignora nulos e zero e arredonda a centavos", () => {
    expect(mediaPrecoM2([45, 45, 70, null, 0])).toEqual({ media: 53.33, quantidade: 3 });
    expect(mediaPrecoM2([])).toBeNull();
  });
  it("a referência do dono é 70", () => {
    expect(REFERENCIA_M2).toBe(70);
  });
});

describe("textos de tela", () => {
  it("sem parênteses, travessão ou seta, e dizem que o certo é consertar o preço", () => {
    for (const t of ["piso", "atual", "proposta"] as const) {
      const x = explicacaoDaBarra(t, base);
      expect(x).not.toMatch(/[()—–→]/);
    }
    expect(explicacaoDaBarra("piso", base)).toContain("nunca baixar a margem mínima");
    expect(explicacaoDaBarra("proposta", { ...base, preco_proposto: 42, piso: 42.86 })).toContain("Não aprove");
  });
});
