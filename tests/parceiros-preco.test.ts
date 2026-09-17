import { describe, expect, it } from "vitest";
import {
  areaDaPeca,
  custoDoItem,
  normalizarCatalogo,
  precoDaGrafica,
  precoSugerido,
  resumoDoOrcamento,
  unidadeLegivel,
  vendaDoItem,
  type ItemDoCatalogo,
  type ItemDoOrcamento,
} from "../src/domain/parceiros/preco";

// Lona: o caso conferido no banco em 16/09/2026 — tabela 70/m², Bronze paga 63/m²,
// peça 2 × 1 m em 3 vias virou item de R$ 126,00 a peça e R$ 378,00 no pedido.
const lona: ItemDoCatalogo = {
  produto_id: "lona",
  nome: "Lona 440g reforçada impressa",
  categoria: "Lona",
  unidade: "m2",
  por_area: true,
  area_minima: 0.25,
  preco_referencia: 70,
  preco_parceiro: 63,
  origem: "nivel",
  oferta_id: null,
  oferta_titulo: null,
  faixas: null,
  tamanhos: [],
};

const perfurado: ItemDoCatalogo = {
  produto_id: "perfurado",
  nome: "Adesivo Perfurado 90 × 33 cm",
  categoria: "Campanha",
  unidade: "un",
  por_area: false,
  area_minima: null,
  preco_referencia: null,
  preco_parceiro: null,
  origem: "faixa",
  oferta_id: null,
  oferta_titulo: null,
  faixas: [
    { quantidade_minima: 50, preco_referencia: 30, preco_parceiro: 29.1 },
    { quantidade_minima: 100, preco_referencia: 25, preco_parceiro: 24.25 },
    { quantidade_minima: 250, preco_referencia: 20, preco_parceiro: 19.4 },
  ],
  tamanhos: [],
};

const catalogo = new Map([
  [lona.produto_id, lona],
  [perfurado.produto_id, perfurado],
]);

const item = (parcial: Partial<ItemDoOrcamento>): ItemDoOrcamento => ({
  produto_id: null,
  descricao: "Item",
  unidade: "un",
  largura: null,
  altura: null,
  quantidade: 1,
  preco_venda_unidade: 0,
  ...parcial,
});

describe("custo do parceiro espelha o pedido gravado pelo banco", () => {
  it("m²: peça = área × preço do m², total = peça × vias", () => {
    const c = custoDoItem(item({ produto_id: "lona", largura: 2, altura: 1, quantidade: 3 }), lona);
    expect(c).toMatchObject({ tipo: "ok", precoUnidade: 63, unitario: 126, total: 378 });
  });

  it("peça menor que a área mínima paga a área mínima", () => {
    const c = custoDoItem(item({ produto_id: "lona", largura: 0.2, altura: 0.3 }), lona);
    expect(areaDaPeca({ largura: 0.2, altura: 0.3 }, 0.25)).toBe(0.25);
    expect(c).toMatchObject({ tipo: "ok", unitario: 15.75, total: 15.75 });
  });

  it("preço do m² com 4 casas vira 2, como a coluna preco_m2 guarda", () => {
    const comOferta = { ...lona, preco_parceiro: 55.1234, origem: "oferta" as const };
    const c = custoDoItem(item({ produto_id: "lona", largura: 1, altura: 1 }), comOferta);
    expect(c).toMatchObject({ precoUnidade: 55.12, unitario: 55.12 });
  });

  it("faixa: vale a maior mínima já atingida, com a quantidade arredondada para cima", () => {
    expect(custoDoItem(item({ produto_id: "perfurado", quantidade: 120 }), perfurado)).toMatchObject({
      tipo: "ok",
      unitario: 24.25,
      total: 2910,
      faixa: { quantidade_minima: 100 },
      proxima: { quantidade_minima: 250 },
    });
    // 99,5 conta como 100 no banco (ceil), então já pega a faixa de 100
    expect(precoDaGrafica(perfurado, 99.5)).toMatchObject({ tipo: "ok", preco: 24.25 });
  });

  it("abaixo da primeira faixa não há preço — o pedido seria recusado", () => {
    expect(custoDoItem(item({ produto_id: "perfurado", quantidade: 30 }), perfurado)).toEqual({
      tipo: "pendente",
      motivo: "Pedido mínimo de 50 un",
    });
  });

  it("m² sem medida fica pendente em vez de custar zero", () => {
    expect(custoDoItem(item({ produto_id: "lona", quantidade: 2 }), lona)).toEqual({
      tipo: "pendente",
      motivo: "Informe largura e altura",
    });
  });

  it("produto que saiu da tabela fica pendente", () => {
    expect(custoDoItem(item({ produto_id: "sumiu" }), undefined)).toMatchObject({ tipo: "pendente" });
  });

  it("item sem produto é serviço do parceiro: não tem custo na gráfica", () => {
    expect(custoDoItem(item({ descricao: "Instalação" }), undefined)).toEqual({ tipo: "livre" });
  });

  it("quantidade abaixo de 1 conta como 1, como no gatilho do banco", () => {
    const c = custoDoItem(item({ produto_id: "lona", largura: 1, altura: 1, quantidade: 0.5 }), lona);
    expect(c).toMatchObject({ unitario: 63, total: 63 });
  });
});

describe("venda do parceiro", () => {
  it("m² do catálogo usa a mesma área cobrada do custo", () => {
    expect(vendaDoItem(item({ produto_id: "lona", largura: 0.2, altura: 0.3, preco_venda_unidade: 90 }), lona)).toEqual({
      unitario: 22.5,
      total: 22.5,
    });
  });

  it("item livre em m² cobra a área real, sem mínimo de ninguém", () => {
    const livre = item({ unidade: "m²", largura: 0.2, altura: 0.3, preco_venda_unidade: 100 });
    expect(vendaDoItem(livre, undefined)).toEqual({ unitario: 6, total: 6 });
  });

  it("item livre sem medida cobra por unidade", () => {
    expect(vendaDoItem(item({ preco_venda_unidade: 150, quantidade: 2 }), undefined)).toEqual({
      unitario: 150,
      total: 300,
    });
  });
});

describe("resumo do orçamento", () => {
  it("lucro e margem só sobre o que tem custo conhecido", () => {
    const r = resumoDoOrcamento(
      [
        item({ produto_id: "lona", largura: 2, altura: 1, quantidade: 3, preco_venda_unidade: 90 }),
        item({ produto_id: "perfurado", quantidade: 120, preco_venda_unidade: 32 }),
        item({ descricao: "Instalação", preco_venda_unidade: 150 }),
      ],
      catalogo,
    );
    // venda: 540 + 3840 + 150 · custo: 378 + 2910 · lucro sobre 4380 − 3288
    expect(r).toMatchObject({
      venda: 4530,
      custo: 3288,
      lucro: 1092,
      margemPct: 24.9,
      lucroParcial: false,
      itensDaGrafica: 2,
      itensLivres: 1,
      area: 6,
    });
  });

  it("com item pendente o lucro é marcado como parcial e a pendência aparece", () => {
    const r = resumoDoOrcamento(
      [
        item({ produto_id: "lona", largura: 1, altura: 1, preco_venda_unidade: 90 }),
        item({ produto_id: "perfurado", descricao: "Perfurado", quantidade: 10, preco_venda_unidade: 40 }),
      ],
      catalogo,
    );
    expect(r.lucroParcial).toBe(true);
    expect(r.pendencias).toEqual([{ indice: 1, descricao: "Perfurado", motivo: "Pedido mínimo de 50 un" }]);
    expect(r.lucro).toBe(27);
  });

  it("sem nenhum item da gráfica com custo, lucro é nulo e não zero", () => {
    const r = resumoDoOrcamento([item({ descricao: "Arte", preco_venda_unidade: 80 })], catalogo);
    expect(r.lucro).toBeNull();
    expect(r.margemPct).toBeNull();
  });
});

describe("sugestão de preço e catálogo", () => {
  it("sugere o preço de balcão da gráfica", () => {
    expect(precoSugerido(lona, 1)).toBe(70);
    expect(precoSugerido(perfurado, 120)).toBe(25);
    // abaixo do mínimo: sugere o da primeira faixa, para o campo não nascer vazio
    expect(precoSugerido(perfurado, 10)).toBe(30);
  });

  it("normaliza números que chegam como texto e ordena as faixas", () => {
    const [p] = normalizarCatalogo([
      {
        produto_id: "x",
        nome: "X",
        unidade: "un",
        por_area: false,
        preco_referencia: null,
        preco_parceiro: null,
        origem: "faixa",
        faixas: [
          { quantidade_minima: "100", preco_referencia: "25.0000", preco_parceiro: "24.2500" },
          { quantidade_minima: "50", preco_referencia: "30.0000", preco_parceiro: "29.1000" },
        ],
        tamanhos: [{ nome: "A4", largura: "0.210", altura: "0.297", padrao: true }],
      },
    ]);
    expect(p.faixas).toEqual([
      { quantidade_minima: 50, preco_referencia: 30, preco_parceiro: 29.1 },
      { quantidade_minima: 100, preco_referencia: 25, preco_parceiro: 24.25 },
    ]);
    expect(p.tamanhos[0]).toEqual({ nome: "A4", largura: 0.21, altura: 0.297, padrao: true });
  });

  it("faixa vazia vira nula — senão o produto nunca teria preço", () => {
    const [p] = normalizarCatalogo([{ produto_id: "y", nome: "Y", faixas: [], preco_parceiro: 10 }]);
    expect(p.faixas).toBeNull();
    expect(precoDaGrafica(p, 1)).toMatchObject({ tipo: "ok", preco: 10 });
  });

  it("unidade legível", () => {
    expect(unidadeLegivel("m2")).toBe("m²");
    expect(unidadeLegivel("un")).toBe("un");
    expect(unidadeLegivel("")).toBe("un");
  });
});
