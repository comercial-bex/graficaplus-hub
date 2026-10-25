import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CobrancaDoAcabamento } from "@/components/orcamento/cobranca-do-acabamento";
import {
  acabamentoCobravel,
  ACABAMENTOS_COBRAVEIS,
  quantidadeDoAcabamento,
} from "@/domain/orcamentos/cobranca-do-acabamento";

describe("quantidade do acabamento", () => {
  it("bainha conta o contorno de cada peça vezes a quantidade", () => {
    expect(quantidadeDoAcabamento("perimetro", { largura: 3, altura: 1, quantidade: 1 })).toBe(8);
    expect(quantidadeDoAcabamento("perimetro", { largura: 0.8, altura: 1.6, quantidade: 5 })).toBe(
      24,
    );
  });

  it("laminação conta a área da peça vezes a quantidade", () => {
    expect(quantidadeDoAcabamento("area", { largura: 2, altura: 1.25, quantidade: 2 })).toBe(5);
  });

  it("sem medida não cobra nada, e quantidade vazia vale 1", () => {
    expect(quantidadeDoAcabamento("area", { largura: 0, altura: 1, quantidade: 1 })).toBe(0);
    expect(quantidadeDoAcabamento("perimetro", { largura: 1, altura: 1, quantidade: 0 })).toBe(4);
  });

  it("só os acabamentos com serviço de preço são cobráveis", () => {
    expect(acabamentoCobravel("bainha + ilhós")?.medida).toBe("perimetro");
    expect(acabamentoCobravel("Recorte eletrônico (plotter de recorte)")).toBeNull();
    expect(new Set(ACABAMENTOS_COBRAVEIS.map((a) => a.servico)).size).toBe(
      ACABAMENTOS_COBRAVEIS.length,
    );
  });
});

describe("cartão de cobrança", () => {
  const servicos = [
    { id: "s1", nome: "Acabamento de lona (bainha + ilhós)", unidade: "m", preco_base: 9 },
    { id: "s2", nome: "Laminação de adesivo", unidade: "m2", preco_base: 28 },
  ];
  const render = (props: Partial<Parameters<typeof CobrancaDoAcabamento>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(CobrancaDoAcabamento, {
        acabamentos: [{ nome: "Bainha + ilhós", padrao: true }],
        servicos,
        peca: { largura: 3, altura: 1, quantidade: 1 },
        jaNoOrcamento: new Set<string>(),
        onAdicionar: () => {},
        ...props,
      }),
    );

  it("mostra a conta e o botão que acrescenta a linha", () => {
    const html = render();
    expect(html).toContain("Bainha + ilhós: 8 m");
    expect(html).toContain("R$");
    expect(html).toContain("72,00");
    expect(html).toContain("Adicionar ao orçamento");
  });

  it("some quando o serviço já é linha do orçamento", () => {
    expect(render({ jaNoOrcamento: new Set(["s1"]) })).toBe("");
  });

  it("some sem medida e quando o acabamento não tem serviço com preço", () => {
    expect(render({ peca: { largura: 0, altura: 0, quantidade: 1 } })).toBe("");
    expect(render({ acabamentos: [{ nome: "Corte a laser (CNC Laser)", padrao: false }] })).toBe(
      "",
    );
  });
});

describe("a tela da equipe", () => {
  const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  it("só mostra a cobrança a quem vê preço e nada é cobrado sozinho", () => {
    expect(tela).toContain("canSeePrices && vendidoPorArea");
    expect(tela).toContain("onAdicionar={adicionarCobrancaDeAcabamento}");
    // a linha só nasce pelo clique: o salvar do item não chama a cobrança
    const salvar = tela.slice(
      tela.indexOf("async function salvarItem"),
      tela.indexOf("async function removerItem"),
    );
    expect(salvar).not.toContain("inserirLinhaDeAcabamento");
  });
});
