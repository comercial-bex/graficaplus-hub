import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CobrancaDoAcabamento } from "@/components/orcamento/cobranca-do-acabamento";
import {
  acabamentoCobravel,
  ACABAMENTOS_COBRAVEIS,
  ladosSugeridos,
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

describe("lados da bainha", () => {
  const peca = { largura: 0.8, altura: 1.6, quantidade: 5 };
  it("contorno todo, só os maiores ou só os menores", () => {
    expect(quantidadeDoAcabamento("perimetro", peca, "contorno")).toBe(24);
    expect(quantidadeDoAcabamento("perimetro", peca, "maiores")).toBe(16);
    expect(quantidadeDoAcabamento("perimetro", peca, "menores")).toBe(8);
  });
  it("o padrão é o contorno todo", () => {
    expect(quantidadeDoAcabamento("perimetro", peca)).toBe(24);
  });
  it("não depende de a largura ser a menor medida", () => {
    const deitada = { largura: 1.6, altura: 0.8, quantidade: 5 };
    expect(quantidadeDoAcabamento("perimetro", deitada, "maiores")).toBe(16);
    expect(quantidadeDoAcabamento("perimetro", deitada, "menores")).toBe(8);
  });
  it("laminação ignora os lados", () => {
    expect(quantidadeDoAcabamento("area", peca, "menores")).toBe(6.4);
  });
  it("banner sugere os lados menores; o resto, o contorno", () => {
    expect(ladosSugeridos("Banner com bastão e corda")).toBe("menores");
    expect(ladosSugeridos("Lona 440g reforçada impressa")).toBe("contorno");
    expect(ladosSugeridos(null)).toBe("contorno");
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
    expect(html).toContain("8 m");
    expect(html).toContain("72,00");
    expect(html).toContain("Adicionar ao orçamento");
  });

  it("a bainha mostra as três opções de lados, cada uma com a metragem e o valor", () => {
    const html = render();
    expect(html).toContain("Contorno todo");
    expect(html).toContain("Só os 2 lados maiores");
    expect(html).toContain("Só os 2 lados menores");
    expect(html).toMatch(/6 m · R\$\s54,00/); // 2 lados maiores de 3 m
    expect(html).toMatch(/2 m · R\$\s18,00/); // 2 lados menores de 1 m
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  it("no banner a sugestão já vem nos lados menores", () => {
    const html = render({ nomeDoProduto: "Banner com bastão e corda" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Só os 2 lados menores/);
  });

  it("a laminação não pergunta os lados", () => {
    const html = render({ acabamentos: [{ nome: "Laminação de adesivo", padrao: false }] });
    expect(html).not.toContain("Contorno todo");
    expect(html).toContain("84,00"); // 3 m² × R$ 28
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
