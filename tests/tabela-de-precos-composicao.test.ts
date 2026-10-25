import { describe, expect, it } from "vitest";
import {
  agruparPorCategoria,
  composicaoMaisRecente,
  custoCheio,
  escalaDePrecos,
  fatiasDoCusto,
  fichaDoProduto,
} from "@/domain/precos/tabela-de-precos";

const lona = { material: 11.06, maquina: 4.81, maoDeObra: 13.33, indireto: 4 };

describe("custo cheio = matéria-prima + máquina + mão de obra + indireto", () => {
  it("soma as quatro partes (Lona 280g: R$ 33,20 e não os R$ 18,00 do cadastro)", () => {
    expect(custoCheio(lona)).toBe(33.2);
  });
  it("sem composição ou tudo zerado não há custo cheio", () => {
    expect(custoCheio(null)).toBeNull();
    expect(custoCheio({ material: 0, maquina: 0, maoDeObra: 0, indireto: 0 })).toBeNull();
  });
  it("as fatias somam ~100% e escondem a parte zerada", () => {
    const f = fatiasDoCusto({ material: 10, maquina: 0, maoDeObra: 10, indireto: 0 });
    expect(f.map((x) => x.chave)).toEqual(["material", "maoDeObra"]);
    expect(f.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 0);
  });
});

describe("ficha técnica do produto", () => {
  it("lona impressa com receita, tempo, máquina e mão de obra está completa", () => {
    expect(fichaDoProduto({ tipo: "produto", categoria: "impressao_grande_formato", temReceita: true, minutos: 20, temMaquina: true, composicao: lona }))
      .toEqual({ nivel: "completa", faltas: [] });
  });
  it("chaveiro de acrílico sem receita nem tempo é 'sem ficha' e diz o que falta", () => {
    const f = fichaDoProduto({ tipo: "produto", categoria: "brindes", temReceita: false, minutos: null, temMaquina: false, composicao: null });
    expect(f.nivel).toBe("sem_ficha");
    expect(f.faltas).toContain("sem tempo de produção");
    expect(f.faltas[0]).toMatch(/custo digitado/);
  });
  it("produto de comunicação visual sem matéria-prima é parcial quando tem tempo", () => {
    const f = fichaDoProduto({ tipo: "produto", categoria: "comunicacao_visual", temReceita: false, minutos: 60, temMaquina: true, composicao: null });
    expect(f.nivel).toBe("parcial");
    expect(f.faltas).toEqual(["sem matéria-prima na receita"]);
  });
  it("serviço não exige receita nem máquina", () => {
    const f = fichaDoProduto({ tipo: "servico", categoria: "servico", temReceita: false, minutos: 60, temMaquina: false, composicao: { material: 0, maquina: 0, maoDeObra: 40, indireto: 12 } });
    expect(f.nivel).toBe("completa");
  });
});

describe("régua de comparação", () => {
  it("posiciona do menor ao maior com folga e mantém a ordem dos valores", () => {
    const e = escalaDePrecos([
      { chave: "c", rotulo: "Custo", valor: 20, tipo: "custo" },
      { chave: "n", rotulo: "Nós", valor: 45, tipo: "nos" },
      { chave: "x", rotulo: "Conc.", valor: 70, tipo: "concorrente" },
    ])!;
    const pos = Object.fromEntries(e.marcadores.map((m) => [m.chave, m.posPct]));
    expect(pos.c).toBeGreaterThan(0);
    expect(pos.x).toBeLessThan(100);
    expect(pos.c).toBeLessThan(pos.n);
    expect(pos.n).toBeLessThan(pos.x);
  });
  it("sem dois valores distintos não há régua", () => {
    expect(escalaDePrecos([{ chave: "a", rotulo: "A", valor: 10, tipo: "nos" }])).toBeNull();
    expect(escalaDePrecos([{ chave: "a", rotulo: "A", valor: 10, tipo: "nos" }, { chave: "b", rotulo: "B", valor: 10, tipo: "custo" }])).toBeNull();
  });
});

describe("agrupamento e duplicatas", () => {
  it("agrupa na ordem do cadastro e manda categoria desconhecida para o fim", () => {
    const g = agruparPorCategoria(
      [{ categoria: "zzz" }, { categoria: "brindes" }, { categoria: "adesivos" }, { categoria: null }],
      ["adesivos", "brindes", "outros"],
    );
    expect(g.map((x) => x.categoria)).toEqual(["adesivos", "brindes", "outros", "zzz"]);
  });
  it("de duas composições do mesmo produto vale a mais recente", () => {
    const m = composicaoMaisRecente([
      { produto_id: "p", updated_at: "2026-10-01", v: 1 },
      { produto_id: "p", updated_at: "2026-10-24", v: 2 },
    ]);
    expect(m.get("p")?.v).toBe(2);
  });
});

import { cheioConfiavel, custoProvisorio } from "@/domain/precos/tabela-de-precos";

describe("custo cheio só quando a matéria-prima está dentro", () => {
  it("produto físico sem receita não usa o 'cheio' de R$ 3,91 (sem material)", () => {
    expect(cheioConfiavel({ tipo: "produto", temReceita: false, cheio: 3.91 })).toBeNull();
  });
  it("com receita ou sendo serviço, vale", () => {
    expect(cheioConfiavel({ tipo: "produto", temReceita: true, cheio: 14.97 })).toBe(14.97);
    expect(cheioConfiavel({ tipo: "servico", temReceita: false, cheio: 52 })).toBe(52);
    expect(cheioConfiavel({ tipo: "produto", temReceita: true, cheio: null })).toBeNull();
  });
  it("reconhece o custo provisório pela observação gravada na ativação dos sete produtos", () => {
    expect(custoProvisorio("CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (25/10/2026): copiados de ...")).toBe(true);
    expect(custoProvisorio("Obs qualquer")).toBe(false);
    expect(custoProvisorio(null)).toBe(false);
  });
});
