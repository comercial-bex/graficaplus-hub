import { describe, expect, it } from "vitest";
import {
  coberturaDoCusto,
  custoParcial,
  dinheiro,
  divergencia,
  frasesDoParcial,
  lucroComparavel,
  mediaDoQueExiste,
  origemDoPrevisto,
  osEmAndamento,
  porcentagem,
  realizados,
  somaDoQueExiste,
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

describe("soma e média só do que existe", () => {
  it("o vazio fica de fora — não entra como zero", () => {
    // O caso da tela de relatórios: uma OS com 40% e outra sem custo.
    // `Number(x ?? 0)` fazia (40 + 0) / 2 = 20%. A média real é 40%.
    expect(mediaDoQueExiste([40, null])).toBe(40);
    expect(somaDoQueExiste([100, null, undefined])).toBe(100);
  });

  it("nada existe → null, não zero", () => {
    // "Não há o que somar" e "a soma deu zero" são coisas diferentes.
    expect(somaDoQueExiste([null, null])).toBeNull();
    expect(mediaDoQueExiste([])).toBeNull();
  });

  it("zero medido é valor e entra na conta", () => {
    expect(somaDoQueExiste([0, null])).toBe(0);
    expect(mediaDoQueExiste([0, 50])).toBe(25);
  });

  it("aceita string, que é como o numeric chega do PostgREST", () => {
    expect(somaDoQueExiste(["10.50", "4.50"])).toBeCloseTo(15, 5);
  });
});

describe("de quantas OS vem o número", () => {
  it("o caso de hoje: nenhuma com custo", () => {
    expect(coberturaDoCusto(0, 2)).toBe("nenhuma das 2 OS tem custo lançado");
  });

  it("diz a base quando é parcial", () => {
    expect(coberturaDoCusto(1, 3)).toBe("calculado sobre 1 de 3 OS — as outras não têm custo lançado");
  });

  it("diz quando é o todo", () => {
    expect(coberturaDoCusto(4, 4)).toBe("todas as 4 OS com custo lançado");
  });

  it("período vazio", () => {
    expect(coberturaDoCusto(0, 0)).toBe("nenhuma OS no período");
    expect(coberturaDoCusto(null, null)).toBe("nenhuma OS no período");
  });
});

describe("previsto × real sobre as mesmas OS", () => {
  it("o caso real de setembro: nenhuma OS com custo → o gráfico fica vazio", () => {
    // O painel dizia lucro real R$ 121,15 contra previsto R$ 60,57 — o dobro
    // do planejado — porque custo_real vale 0 em toda OS aberta.
    const r = lucroComparavel([
      { custo_lancado: false, lucro_previsto: "60.57", lucro_realizado: null },
      { custo_lancado: false, lucro_previsto: "0", lucro_realizado: null },
    ]);
    expect(r).toEqual({ previsto: null, real: null, osComparadas: 0 });
  });

  it("compara só as OS com custo, dos dois lados", () => {
    // Uma com custo (previsto 60, real 45) e uma sem. Somar o previsto das
    // duas e o real de uma só inventaria uma queda de lucro que não houve.
    const r = lucroComparavel([
      { custo_lancado: true, lucro_previsto: 60, lucro_realizado: 45 },
      { custo_lancado: false, lucro_previsto: 100, lucro_realizado: null },
    ]);
    expect(r).toEqual({ previsto: 60, real: 45, osComparadas: 1 });
  });

  it("mês sem OS nenhuma também fica vazio", () => {
    expect(lucroComparavel([])).toEqual({ previsto: null, real: null, osComparadas: 0 });
  });
});

/**
 * O caso do meio (15/10/2026, ensaio do reembolso, OS #167): previsto R$ 534,95,
 * lançado R$ 75,00 de reembolso, venda R$ 745. A view soma só o lançado e
 * anunciava margem realizada de 89,93% contra 28,19% prevista, e divergência de
 * −R$ 459,95 — com cara de economia, e é custo que ainda não entrou.
 */
const OS167 = {
  receita_liquida: "745.00",
  custo_previsto: "534.95",
  custo_realizado: "75.00",
  lucro_previsto: "210.05",
  lucro_realizado: "670.00",
  margem_prevista: "28.19",
  margem_realizada: "89.93",
  divergencia_custo: "-459.95",
  custo_lancado: true,
  custo_previsto_origem: "orcamento",
};

describe("custo parcial: OS em andamento com só parte do custo lançado", () => {
  it("avisa que a margem realizada ainda vai cair — e diz quanto já entrou", () => {
    const p = custoParcial(OS167, true);
    expect(p).toEqual({ lancado: 75, previsto: 534.95, falta: 459.95, percentual: 14 });
    const f = frasesDoParcial(p!);
    expect(sp(f.aviso)).toContain("R$ 75,00 dos R$ 534,95");
    expect(f.aviso).toContain("(14%)");
    expect(f.aviso).toContain("use a margem prevista");
    expect(f.realizado).toBe("parcial: 14% do custo previsto lançado");
    expect(sp(f.divergencia)).toBe("não é economia: ainda faltam R$ 459,95 a lançar");
  });

  it("realizados() devolve o parcial só quando a OS está em andamento — e não muda o resto", () => {
    expect(realizados(OS167, { osEmAndamento: true }).parcial?.percentual).toBe(14);
    // Sem dizer o status, a tela fica como era (quem já chamava não muda).
    expect(realizados(OS167).parcial).toBeNull();
    expect(realizados(OS167, { osEmAndamento: false }).parcial).toBeNull();
    // Os números continuam sendo os da view: o aviso acompanha, não esconde.
    expect(realizados(OS167, { osEmAndamento: true }).margem.texto).toBe("89,93%");
  });

  it("OS concluída com custo menor que o previsto pode ser economia de verdade: sem aviso", () => {
    expect(custoParcial(OS167, osEmAndamento("concluido"))).toBeNull();
    expect(custoParcial(OS167, osEmAndamento("faturado"))).toBeNull();
    expect(custoParcial(OS167, osEmAndamento("producao"))).not.toBeNull();
  });

  it("custo completo, estourado, ausente ou sem previsto não é parcial", () => {
    const base = { custo_lancado: true, custo_previsto: 100 };
    expect(custoParcial({ ...base, custo_realizado: 100 }, true)).toBeNull();
    expect(custoParcial({ ...base, custo_realizado: 130 }, true)).toBeNull();
    expect(custoParcial({ ...base, custo_realizado: 0 }, true)).toBeNull();
    expect(custoParcial({ custo_lancado: true, custo_previsto: 0, custo_realizado: 40 }, true)).toBeNull();
    expect(custoParcial({ custo_lancado: false, custo_previsto: 100, custo_realizado: 40 }, true)).toBeNull();
    expect(custoParcial(null, true)).toBeNull();
  });

  it("parcial nunca se lê como 100%: arredonda para baixo", () => {
    expect(custoParcial({ custo_lancado: true, custo_previsto: 1000, custo_realizado: 999.6 }, true)?.percentual).toBe(99);
  });

  it("status desconhecido não conta como em andamento", () => {
    expect(osEmAndamento(null)).toBe(false);
    expect(osEmAndamento(undefined)).toBe(false);
    expect(osEmAndamento("entrada")).toBe(true);
  });
});

describe("o gráfico previsto × real deixa a OS parcial de fora", () => {
  it("o lucro 'real' da OS parcial não entra: ele ainda não pagou o custo que falta", () => {
    const r = lucroComparavel([
      { ...OS167, os_em_andamento: true, lucro_previsto: 210.05, lucro_realizado: 670 },
      { custo_lancado: true, custo_previsto: 60, custo_realizado: 60, os_em_andamento: false, lucro_previsto: 60, lucro_realizado: 45 },
    ]);
    expect(r).toEqual({ previsto: 60, real: 45, osComparadas: 1 });
  });

  it("sem dizer que a OS está em andamento, a conta é a de antes", () => {
    const r = lucroComparavel([{ ...OS167, lucro_previsto: 210.05, lucro_realizado: 670 }]);
    expect(r.osComparadas).toBe(1);
  });
});
