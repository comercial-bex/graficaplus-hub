import { describe, expect, it } from "vitest";
import {
  dinheiro,
  divergencia,
  origemDoPrevisto,
  porcentagem,
  realizados,
} from "../src/domain/os/resultado";

/**
 * `toLocaleString` com moeda usa espaço NÃO-QUEBRÁVEL entre "R$" e o número.
 * É o certo na tela — o valor nunca parte em duas linhas — e é invisível no
 * diff quando o teste falha: "R$ 19,42" e "R$ 19,42" parecem idênticos.
 * Normalizar aqui mantém a expectativa legível sem mexer na formatação real.
 */
const sp = (t: string) => t.replace(/ /g, " ");

/**
 * O caso real. OS #44, conferida no banco em 10/09/2026:
 * receita 121,15 · custo previsto 60,58 · nenhuma linha de custo lançada.
 * Antes desta correção a tela dizia margem realizada de 100% (exibida como
 * "1.00%", porque a view mandava fração e a tela escrevia porcento).
 */
const OS44 = {
  receita_liquida: "121.15",
  custo_previsto: "60.58",
  custo_realizado: "0",
  lucro_previsto: "60.57",
  lucro_realizado: null,
  margem_prevista: "50.00",
  margem_realizada: null,
  divergencia_custo: "-60.58",
  custo_lancado: false,
  custo_previsto_origem: "orcamento",
};

describe("custo não lançado não vira lucro", () => {
  it("os três campos realizados dizem que falta lançar", () => {
    const r = realizados(OS44);
    expect(r.custoLancado).toBe(false);
    expect(r.custo.texto).toBe("não lançado");
    expect(r.lucro.texto).toBe("não lançado");
    expect(r.margem.texto).toBe("não lançado");
  });

  it("a frase diz o que fazer, não só que está vazio", () => {
    const r = realizados(OS44);
    expect(r.margem.tipo).toBe("ausente");
    expect(r.margem.motivo).toContain("baixa de material");
    expect(r.margem.motivo).toContain("apontamento");
  });

  it("nunca devolve 100% quando não há custo", () => {
    const r = realizados(OS44);
    expect(r.margem.texto).not.toContain("100");
    expect(r.lucro.texto).not.toContain("121");
  });

  it("OS sem resultado nenhum se comporta igual", () => {
    expect(realizados(null).custo.texto).toBe("não lançado");
    expect(realizados(undefined).custoLancado).toBe(false);
  });
});

describe("custo lançado volta a mostrar número", () => {
  const comCusto = { ...OS44, custo_lancado: true, custo_realizado: "80.00", lucro_realizado: "41.15", margem_realizada: "33.97" };

  it("mostra os valores quando existem", () => {
    const r = realizados(comCusto);
    expect(r.custoLancado).toBe(true);
    expect(sp(r.custo.texto)).toBe("R$ 80,00");
    expect(sp(r.lucro.texto)).toBe("R$ 41,15");
    expect(r.margem.texto).toBe("33,97%");
  });

  it("custo medido que deu zero é um número, não uma ausência", () => {
    // Esta é a diferença que o COALESCE apagava: zero medido é um fato.
    const r = realizados({ ...comCusto, custo_realizado: "0", lucro_realizado: "121.15", margem_realizada: "100.00" });
    expect(r.custo.tipo).toBe("valor");
    expect(sp(r.custo.texto)).toBe("R$ 0,00");
    expect(r.margem.texto).toBe("100,00%");
  });
});

describe("a margem já vem em porcentagem", () => {
  it("50 significa cinquenta por cento, não meio por cento", () => {
    // A view devolvia 0,4999 e a tela escrevia "0.50%" — parecia
    // arredondamento, era metade da receita.
    expect(porcentagem("50.00").texto).toBe("50,00%");
    expect(porcentagem(33.97).texto).toBe("33,97%");
  });

  it("nulo não vira zero por cento", () => {
    expect(porcentagem(null).tipo).toBe("ausente");
    expect(porcentagem(null).texto).toBe("—");
  });
});

describe("dinheiro", () => {
  it("formata em reais do Brasil", () => {
    expect(sp(dinheiro("121.15").texto)).toBe("R$ 121,15");
    expect(sp(dinheiro(0).texto)).toBe("R$ 0,00");
  });
  it("ausente não é zero", () => {
    expect(dinheiro(null).tipo).toBe("ausente");
  });
});

describe("divergência", () => {
  it("sem custo lançado, não compara", () => {
    // −60,58 pareceria economia de sessenta reais; é falta de dado.
    const d = divergencia(OS44);
    expect(d.tipo).toBe("ausente");
    expect(d.motivo).toContain("depois que o custo for lançado");
  });

  it("com custo lançado, compara", () => {
    expect(sp(divergencia({ ...OS44, custo_lancado: true, divergencia_custo: "19.42" }).texto)).toBe(
      "R$ 19,42",
    );
  });
});

describe("origem do custo previsto", () => {
  it("diz de onde veio", () => {
    expect(origemDoPrevisto("orcamento")).toBe("veio do orçamento");
    expect(origemDoPrevisto("previsao_de_material")).toBe("somado da previsão de material");
    expect(origemDoPrevisto("sem_custo")).toBe("não há custo previsto");
    expect(origemDoPrevisto(null)).toBe("não há custo previsto");
  });
});
