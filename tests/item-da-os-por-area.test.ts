import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarItemDaOS, resumoDoItemPorArea, vendidoPorAreaNaOS } from "@/domain/os/itens";

/**
 * A aba "Itens" da OS copiava o preço e o custo do catálogo direto na linha. Para produto vendido por m² os dois
 * são POR m²: uma peça de acrílico de 2 mm de 0,30 × 0,20 m entrava por R$ 1.000,00 em vez de R$ 100,00, e o
 * total da OS é a soma dos itens. Estes testes travam a conta nova, a mesma do orçamento.
 */
const ACRILICO_2MM = {
  descricao: "Acrílico Virgem Recortado 2mm",
  unidade: "m2",
  produtoId: "p-acrilico",
  precoM2: 1000,
  custoM2: 151.13,
  areaMinima: 0.1,
  valorUnitario: 0,
  custoUnitario: 0,
  podeVerPreco: true,
  podeVerCusto: true,
};

describe("item vendido por m² na aba Itens da OS", () => {
  it("peça pequena paga o mínimo de 0,10 m²: R$ 100,00, não o m² inteiro (R$ 1.000,00)", () => {
    const r = montarItemDaOS({ ...ACRILICO_2MM, quantidade: 1, largura: 0.3, altura: 0.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linha.valor_total).toBe(100);
    expect(r.linha.valor_unitario).toBe(100);
    expect(r.linha.valor_total).not.toBe(1000); // o erro antigo
    expect(r.linha.custo_unitario).toBe(15.11); // 151,13 × 0,10, e não os 151,13 do m²
    expect(r.porArea?.areaCobrada).toBe(0.1);
    expect(r.porArea?.pagaMinimo).toBe(true);
  });

  it("três peças de 0,50 × 0,40 m: R$ 200,00 cada, R$ 600,00 no total, e o preço por m² vai para o banco", () => {
    const r = montarItemDaOS({ ...ACRILICO_2MM, quantidade: 3, largura: 0.5, altura: 0.4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linha.valor_unitario).toBe(200);
    expect(r.linha.valor_total).toBe(600);
    expect(r.linha.custo_unitario).toBe(30.23);
    expect(r.linha).toMatchObject({ preco_m2: 1000, largura: 0.5, altura: 0.4, area_minima: 0.1, quantidade: 3 });
    expect(r.porArea?.areaCobrada).toBe(0.6);
    expect(r.porArea?.pagaMinimo).toBe(false);
  });

  it("peça miúda sai da área exata: 120 adesivos de 5 × 5 cm a R$ 30/m² dão R$ 9,00 (não R$ 10,80)", () => {
    const r = montarItemDaOS({
      descricao: "Adesivo vinil branco impresso",
      unidade: "m2",
      produtoId: "p-adesivo",
      quantidade: 120,
      largura: 0.05,
      altura: 0.05,
      precoM2: 30,
      custoM2: 9.21,
      areaMinima: null,
      valorUnitario: 0,
      custoUnitario: 0,
      podeVerPreco: true,
      podeVerCusto: true,
    });
    expect(r.ok && r.linha.valor_total).toBe(9);
  });

  it("a unidade m² (com o expoente) também é vendida por área", () => {
    expect(vendidoPorAreaNaOS("m²", "p")).toBe(true);
    expect(vendidoPorAreaNaOS("m2", "p")).toBe(true);
    expect(vendidoPorAreaNaOS("un", "p")).toBe(false);
    // sem produto do catálogo, quem digita à mão fica como sempre ficou
    expect(vendidoPorAreaNaOS("m2", null)).toBe(false);
  });

  it("sem largura e altura, produto por m² é recusado: o preço do m² não vira o preço da peça", () => {
    const r = montarItemDaOS({ ...ACRILICO_2MM, quantidade: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("largura e a altura");
    expect(montarItemDaOS({ ...ACRILICO_2MM, quantidade: 1, largura: 0.3, altura: 0 }).ok).toBe(false);
  });

  it("preço por m² zerado é recusado para quem vê preço", () => {
    const r = montarItemDaOS({ ...ACRILICO_2MM, quantidade: 1, largura: 0.3, altura: 0.2, precoM2: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("preço por m²");
  });

  it("quantidade zero ou vazia é recusada", () => {
    expect(montarItemDaOS({ ...ACRILICO_2MM, quantidade: 0, largura: 0.3, altura: 0.2 }).ok).toBe(false);
    expect(montarItemDaOS({ ...ACRILICO_2MM, quantidade: Number.NaN, largura: 0.3, altura: 0.2 }).ok).toBe(false);
  });

  it("quem não vê preço grava 0 e não manda preço por m²; quem não vê custo deixa o custo para o banco", () => {
    const r = montarItemDaOS({
      ...ACRILICO_2MM,
      quantidade: 1,
      largura: 0.3,
      altura: 0.2,
      podeVerPreco: false,
      podeVerCusto: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linha.valor_unitario).toBe(0);
    expect(r.linha.valor_total).toBe(0);
    expect(r.linha.custo_unitario).toBe(0);
    expect("preco_m2" in r.linha).toBe(false);
    expect(r.linha).toMatchObject({ largura: 0.3, altura: 0.2 });
  });

  it("item comum (por peça) continua quantidade × valor, em centavos", () => {
    const r = montarItemDaOS({
      descricao: "Chaveiro acrílico",
      unidade: "un",
      produtoId: "p-chaveiro",
      quantidade: 5,
      valorUnitario: 12.5,
      custoUnitario: 2.25,
      podeVerPreco: true,
      podeVerCusto: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linha.valor_total).toBe(62.5);
    expect(r.linha.custo_unitario).toBe(2.25);
    expect(r.porArea).toBeNull();
    expect("preco_m2" in r.linha).toBe(false);
  });

  it("a prévia da tela e a linha gravada dão o mesmo número", () => {
    const entrada = { quantidade: 2, precoM2: 600, custoM2: 151.13, largura: 0.32, altura: 0.23, areaMinima: 0.1 };
    const previa = resumoDoItemPorArea(entrada);
    const r = montarItemDaOS({ ...ACRILICO_2MM, ...entrada, valorUnitario: 0, custoUnitario: 0 });
    expect(r.ok && r.linha.valor_total).toBe(previa?.totalDaLinha);
    expect(previa?.totalDaLinha).toBe(120); // 2 peças × 0,10 m² mínimo × R$ 600
  });

  it("sem medida, a prévia não inventa conta", () => {
    expect(resumoDoItemPorArea({ quantidade: 1, precoM2: 1000, custoM2: 100, largura: 0, altura: 0.2 })).toBeNull();
  });
});

describe("a aba Itens da OS usa a conta do orçamento (contrato do código)", () => {
  const aba = readFileSync("src/components/os/itens-da-os.tsx", "utf8");

  it("não multiplica a quantidade pelo preço do catálogo por conta própria", () => {
    expect(aba).not.toContain("valor_total: qtd * vu");
    expect(aba).toContain("montarItemDaOS(");
  });

  it("produto por m² pede largura, altura, peças e preço por m²", () => {
    expect(aba).toContain("Largura (m)");
    expect(aba).toContain("Altura (m)");
    expect(aba).toContain("Peças");
    expect(aba).toContain("Preço/m²");
    expect(aba).toContain("Custo/m²");
  });

  it("ao escolher um produto por m², o preço do m² não entra como valor da peça", () => {
    expect(aba).toMatch(/valor_unitario: vendidoPorAreaNaOS\(p\.unidade, p\.id\) \? "0"/);
    expect(aba).toMatch(/custo_unitario: vendidoPorAreaNaOS\(p\.unidade, p\.id\) \? "0"/);
  });

  it("mostra a conta antes de gravar: m² cobrados, valor da peça e total", () => {
    expect(aba).toContain('data-testid="conta-do-item-por-area"');
    expect(aba).toContain("cobrados");
    expect(aba).toContain("total {dinheiro(");
  });

  it("a lista mostra a medida e os m² cobrados do item por área", () => {
    expect(aba).toContain("area_cobrada");
    expect(aba).toContain("peças");
  });
});
