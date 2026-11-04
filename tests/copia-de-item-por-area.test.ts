import { describe, expect, it } from "vitest";
import { areaDaPeca } from "@/domain/orcamentos/area";
import {
  AVISO_FORMULAS_FALTANDO,
  copiaDaCobranca,
  copiaDoItem,
  formulasParaCopiar,
  precoM2DaCopia,
  type LinhaParaCopiar,
} from "@/domain/orcamentos/copia-de-item";
import { custoDasFormulas, formulasParaGravar, materiaisPorFormula, medidasDoItem } from "@/domain/orcamentos/material-por-formula";
import { custoDosTerceirizados } from "@/domain/orcamentos/terceirizados";
import { textoDoPrecoAplicado } from "@/domain/orcamentos/preco-aplicado";

/**
 * Segunda rodada da revisão adversarial do PR 425 (04/11/2026), a parte de tela e de cópia.
 * Aqui só comportamento: a revisão mostrou que 10 dos 13 testes da primeira rodada conferiam texto
 * e que quatro mutantes passavam todos verdes.
 */

/** O que o gatilho `tg_item_precificar_por_area` faz com o preço por m²: o total da linha, arredondado uma vez. */
function totalDoBanco(l: { largura: number; altura: number; quantidade: number; area_minima: number | null }, precoM2: number): number {
  const peca = Math.max(Math.round(l.largura * l.altura * 1e6) / 1e6, l.area_minima ?? 0);
  return Math.round(peca * Math.max(l.quantidade, 1) * precoM2 * 100) / 100;
}

const lona: LinhaParaCopiar = {
  id: "i1",
  descricao: "Lona 440g",
  quantidade: 3,
  unidade: "m2",
  largura: 2,
  altura: 1,
  valor_unitario: 90,
  valor_total: 270,
  area_minima: null,
  produto_id: "p-lona",
  arquivo_id: "a1",
};

describe("preço por m² da cópia", () => {
  it("a lona de 2 × 1 m, três peças, R$ 270, volta a R$ 45 o m²", () => {
    expect(precoM2DaCopia(lona, true)).toBe(45);
  });

  it("quem não vê preço copia sem preço por m²: a cópia nasce com valor zero e o preço entra depois", () => {
    expect(precoM2DaCopia(lona, false)).toBeNull();
  });

  it("item vendido por peça, mesmo com medida, não vira item por área", () => {
    expect(precoM2DaCopia({ ...lona, unidade: "un" }, true)).toBeNull();
    expect(precoM2DaCopia({ ...lona, largura: null, altura: null }, true)).toBeNull();
    expect(precoM2DaCopia({ ...lona, largura: 2, altura: 0 }, true)).toBeNull();
  });

  it("linha sem valor não inventa preço", () => {
    expect(precoM2DaCopia({ ...lona, valor_total: 0, valor_unitario: 0 }, true)).toBeNull();
    expect(precoM2DaCopia({ ...lona, valor_total: null }, true)).toBeNull();
  });

  it("reconhece m² escrito com expoente e valores que chegam como texto do banco", () => {
    expect(precoM2DaCopia({ ...lona, unidade: "m²", quantidade: "3", largura: "2", altura: "1", valor_total: "270.00" }, true)).toBe(45);
  });

  it("o mínimo cobrado entra na área: 0,045 m² com mínimo de 0,25 a R$ 250 o m² são R$ 62,50 e voltam a R$ 250", () => {
    const l: LinhaParaCopiar = { ...lona, quantidade: 1, largura: 0.3, altura: 0.15, area_minima: 0.25, valor_unitario: 62.5, valor_total: 62.5 };
    expect(precoM2DaCopia(l, true)).toBe(250);
  });

  it("quantidade abaixo de 1 conta como 1, como o banco (GREATEST(quantidade, 1))", () => {
    const l: LinhaParaCopiar = { ...lona, quantidade: 0.5, valor_total: 90, valor_unitario: 90 };
    expect(precoM2DaCopia(l, true)).toBe(45);
  });

  it("peça miúda não perde o preço: 120 adesivos de 5 × 5 cm a R$ 30 o m² saem R$ 9,00 e voltam a R$ 30", () => {
    const l: LinhaParaCopiar = { ...lona, quantidade: 120, largura: 0.05, altura: 0.05, valor_total: 9, valor_unitario: 0.08 };
    // Pelo unitário (R$ 0,08, já arredondado) o preço sairia R$ 32/m²: o total é que manda.
    expect(precoM2DaCopia(l, true)).toBe(30);
  });

  it("para qualquer preço, medida e quantidade, o preço refeito devolve o MESMO total ao passar pelo gatilho", () => {
    const larguras = [0.05, 0.1, 0.3, 0.55, 1, 1.2, 2.45, 3, 5];
    const alturas = [0.05, 0.15, 0.4, 1, 2.2, 6];
    const quantidades = [1, 2, 3, 7, 10, 25, 120, 1000];
    const precos = [7.5, 12.35, 30, 45, 83.33, 120, 250, 1388.89];
    const minimos = [null, 0.25, 1];
    let conferidos = 0;
    for (const largura of larguras)
      for (const altura of alturas)
        for (const quantidade of quantidades)
          for (const preco of precos)
            for (const area_minima of minimos) {
              const total = totalDoBanco({ largura, altura, quantidade, area_minima }, preco);
              const linha: LinhaParaCopiar = { unidade: "m2", largura, altura, quantidade, area_minima, valor_total: total, valor_unitario: total / quantidade };
              const refeito = precoM2DaCopia(linha, true);
              expect(refeito, `${largura}x${altura} q${quantidade} min${area_minima} @${preco}`).not.toBeNull();
              expect(totalDoBanco({ largura, altura, quantidade, area_minima }, refeito as number), `${largura}x${altura} q${quantidade} min${area_minima} @${preco}`).toBe(total);
              conferidos += 1;
            }
    expect(conferidos).toBe(larguras.length * alturas.length * quantidades.length * precos.length * minimos.length);
    expect(areaDaPeca({ largura: 0.05, altura: 0.05 }, null)).toBeCloseTo(0.0025, 10);
  });
});

describe("o item copiado", () => {
  const base = { orcamentoId: "o2", ordem: 4, podeVerPrecos: true, materiaisPorFormula: [{ material_id: "m1", quantidade: 8 }] };

  it("leva o preço por m² e o mínimo cobrado do original junto com a medida e as fórmulas", () => {
    const c = copiaDoItem({ ...lona, area_minima: 0.25 }, { ...base, arquivoId: "a1" });
    expect(c).toMatchObject({
      orcamento_id: "o2",
      descricao: "Lona 440g",
      unidade: "m2",
      largura: 2,
      altura: 1,
      quantidade: 3,
      valor_unitario: 90,
      preco_m2: 45,
      area_minima: 0.25,
      ordem: 4,
      produto_id: "p-lona",
      arquivo_id: "a1",
      materiais_por_formula: [{ material_id: "m1", quantidade: 8 }],
    });
  });

  it("para quem não vê preço, o valor zera e o preço por m² não vai", () => {
    const c = copiaDoItem(lona, { ...base, podeVerPrecos: false });
    expect(c.valor_unitario).toBe(0);
    expect("preco_m2" in c).toBe(false);
  });

  it("o custo só vai quando a view dele existe, e a arte só quando é Duplicar", () => {
    expect("custo_unitario" in copiaDoItem(lona, base)).toBe(false);
    expect(copiaDoItem({ ...lona, custo_unitario: 40 }, base).custo_unitario).toBe(40);
    expect("arquivo_id" in copiaDoItem(lona, base)).toBe(false);
    expect(copiaDoItem(lona, { ...base, arquivoId: null }).arquivo_id).toBeNull();
  });

  it("item por peça não ganha preço por m² nem mínimo", () => {
    const c = copiaDoItem({ ...lona, unidade: "un", largura: null, altura: null }, base);
    expect("preco_m2" in c).toBe(false);
    expect("area_minima" in c).toBe(false);
  });
});

describe("a cobrança por área que a peça gerou", () => {
  const laminacao: LinhaParaCopiar = {
    id: "g1",
    descricao: "Laminação (Lona 440g)",
    unidade: "m2",
    quantidade: 3,
    largura: 2,
    altura: 1,
    produto_id: "p-lam",
    valor_unitario: 76,
    valor_total: 228,
  };
  const o = { orcamentoId: "o2", ordem: 5, paiId: "novo", podeVerPrecos: true, materiaisPorFormula: [] };

  it("o preço especial do cliente (R$ 38 o m²) sobrevive à cópia: não volta ao preço de tabela do catálogo", () => {
    const c = copiaDaCobranca(laminacao, o);
    expect(c.preco_m2).toBe(38);
    expect(c.gerado_por_item_id).toBe("novo");
    expect(c.valor_unitario).toBe(76);
  });

  it("cobrança por unidade não ganha preço por m²", () => {
    const c = copiaDaCobranca({ ...laminacao, unidade: "un", largura: null, altura: null, valor_total: 30 }, o);
    expect("preco_m2" in c).toBe(false);
  });
});

describe("a leitura do material por fórmula antes de copiar", () => {
  it("devolve a lista de cada item quando todos voltaram", () => {
    const r = formulasParaCopiar([{ id: "a", materiais_por_formula: [{ material_id: "m", quantidade: 2 }] }, { id: "b" }], ["a", "b"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.porItem.get("a")).toEqual([{ material_id: "m", quantidade: 2 }]);
      expect(r.porItem.get("b")).toEqual([]);
    }
  });

  it("item que a leitura não devolveu (apagado por outra pessoa) para a cópia em vez de virar lista vazia", () => {
    const r = formulasParaCopiar([{ id: "a", materiais_por_formula: [] }], ["a", "b"]);
    expect(r).toEqual({ ok: false, faltam: ["b"] });
    expect(AVISO_FORMULAS_FALTANDO).toMatch(/Recarregue/);
  });

  it("leitura nula ou vazia com itens a copiar não passa", () => {
    expect(formulasParaCopiar(null, ["a"]).ok).toBe(false);
    expect(formulasParaCopiar([], ["a"]).ok).toBe(false);
    expect(formulasParaCopiar(null, []).ok).toBe(true);
  });
});

describe("o custo das fórmulas na tela é o do banco", () => {
  it("0,015 m de fita a R$ 0,30 são R$ 0,0045 por peça, não zero", () => {
    const r = custoDasFormulas([{ material_id: "fita", quantidade: 0.015 }], new Map([["fita", 0.3]]));
    expect(r.total).toBeCloseTo(0.0045, 8);
    expect(r.total * 30000).toBeCloseTo(135, 6);
  });

  it("o ruído do ponto flutuante não aparece: 12 × 0,35 é 4,2", () => {
    expect(custoDasFormulas([{ material_id: "i", quantidade: 12 }], new Map([["i", 0.35]])).total).toBe(4.2);
  });

  it("material sem custo é apontado e não entra", () => {
    const r = custoDasFormulas([{ material_id: "a", quantidade: 1 }, { material_id: "b", quantidade: 1 }], new Map([["a", 2]]));
    expect(r).toEqual({ total: 2, semCusto: ["b"] });
  });
});

describe("a quantidade de material por peça não some por arredondamento", () => {
  const verniz = { id: "f1", material_id: "verniz", script: "area * 0,01", material: { nome: "Verniz", unidade: "L" } };

  it("10 mL por m² escrito em litros numa etiqueta de 5 × 5 cm é 0,000025 L, não zero", () => {
    const r = materiaisPorFormula([verniz], medidasDoItem({ largura: 0.05, altura: 0.05, quantidade: 1 }));
    expect(r.linhas[0].erro).toBeNull();
    expect(r.validas).toEqual([{ material_id: "verniz", quantidade: 0.000025 }]);
    // R$ 200 o litro, 10.000 etiquetas: R$ 50,00 no item (com 4 casas a conta dava R$ 0,00).
    const custo = custoDasFormulas(r.validas, new Map([["verniz", 200]]));
    expect(custo.total * 10000).toBeCloseTo(50, 6);
  });

  it("duas fórmulas de 0,00004 do mesmo material somam 0,00008", () => {
    const f = (id: string) => ({ id, material_id: "cola", script: "0,00004", material: { nome: "Cola", unidade: "L" } });
    const r = materiaisPorFormula([f("a"), f("b")], medidasDoItem({ largura: 1, altura: 1, quantidade: 1 }));
    expect(r.validas).toEqual([{ material_id: "cola", quantidade: 0.00008 }]);
  });

  it("quantidade que ainda assim dá zero depois de arredondar aparece como erro e não é gravada", () => {
    const minuscula = { id: "f2", material_id: "cola", script: "0,000000001", material: { nome: "Cola", unidade: "L" } };
    const r = materiaisPorFormula([minuscula], medidasDoItem({ largura: 1, altura: 1, quantidade: 1 }));
    expect(r.linhas[0].erro).toMatch(/zero/);
    expect(r.validas).toEqual([]);
  });
});

describe("o Salvar do item e o material por fórmula", () => {
  const validas = [{ material_id: "m", quantidade: 8 }];

  it("com a consulta das fórmulas pendente, não salva: gravaria lista vazia por cima do custo", () => {
    const r = formulasParaGravar({ produtoId: "p", leitura: "pendente", validas: [] });
    expect(r.gravar).toBe(false);
    if (!r.gravar) expect(r.pendencia).toMatch(/Calculando/);
  });

  it("com a consulta falha, não salva e diz o que apagaria", () => {
    const r = formulasParaGravar({ produtoId: "p", leitura: "erro", validas: [] });
    expect(r.gravar).toBe(false);
    if (!r.gravar) expect(r.pendencia).toMatch(/apagaria o custo/);
  });

  it("com a consulta pronta grava as fórmulas calculadas, e produto sem fórmula grava lista vazia de verdade", () => {
    expect(formulasParaGravar({ produtoId: "p", leitura: "ok", validas })).toEqual({ gravar: true, valor: validas });
    expect(formulasParaGravar({ produtoId: "p", leitura: "ok", validas: [] })).toEqual({ gravar: true, valor: [] });
  });

  it("item sem produto não tem fórmula: grava lista vazia sem esperar consulta nenhuma", () => {
    expect(formulasParaGravar({ produtoId: null, leitura: "pendente", validas })).toEqual({ gravar: true, valor: [] });
  });
});

describe("terceirizado por m² sem medida", () => {
  const t = (base: string) => [{ id: "t", descricao: "Corte a laser", valor: 20, base }];

  it("entra com zero e avisa que falta largura e altura", () => {
    const r = custoDosTerceirizados(t("m2"), { largura: null, altura: null, quantidade: 10 });
    expect(r.linhas[0].porPeca).toBe(0);
    expect(r.linhas[0].semMedida).toBe(true);
    const so = custoDosTerceirizados(t("m2"), { largura: 2, altura: null, quantidade: 10 });
    expect(so.linhas[0].semMedida).toBe(true);
  });

  it("com as duas medidas não avisa, e as outras bases nunca avisam", () => {
    expect(custoDosTerceirizados(t("m2"), { largura: 2, altura: 1, quantidade: 1 }).linhas[0].semMedida).toBe(false);
    expect(custoDosTerceirizados(t("peca"), { largura: null, altura: null, quantidade: 1 }).linhas[0].semMedida).toBe(false);
    expect(custoDosTerceirizados(t("pedido"), { largura: null, altura: null, quantidade: 5 }).linhas[0].semMedida).toBe(false);
  });
});

describe("o aviso depois de aplicar o preço", () => {
  it("cliente final fala em preço especial e tabela, não em 'voltou ao preço de tabela'", () => {
    const t = textoDoPrecoAplicado("cliente_final", { itens_repreciados: 2, itens_sem_preco: 0 });
    expect(t).toBe("Preço de cliente final aplicado em 2 itens: o preço especial do cliente onde ele existe, a tabela nos demais.");
    expect(t).not.toMatch(/Voltou ao preço de tabela/);
  });

  it("parceiro continua dizendo que confirmou", () => {
    expect(textoDoPrecoAplicado("parceiro", { itens_repreciados: 1, itens_sem_preco: 0 })).toBe("Preço de parceiro confirmado em 1 item.");
  });

  it("o aviso dos itens que ficaram como estavam não cita preço de parceiro no cliente final", () => {
    expect(textoDoPrecoAplicado("cliente_final", { itens_repreciados: 3, itens_sem_preco: 1 })).toContain("1 item ficou como estava (sem produto ou sem preço no catálogo).");
    expect(textoDoPrecoAplicado("parceiro", { itens_repreciados: 3, itens_sem_preco: 2 })).toContain("2 itens ficaram como estavam (sem produto ou sem preço de parceiro).");
  });
});
