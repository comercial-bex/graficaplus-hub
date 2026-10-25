import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CartaoDeEscolha,
  GradeDeCartoes,
  PreviaDaPeca,
} from "@/components/orcamento/cartao-de-escolha";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AcabamentoDoItem } from "@/components/orcamento/acabamento-do-item";
import { descricaoDoTamanho } from "@/domain/orcamentos/descricao-do-tamanho";

describe("cartão de escolha", () => {
  const html = renderToStaticMarkup(
    createElement(
      GradeDeCartoes,
      { rotulo: "Tamanhos" },
      createElement(CartaoDeEscolha, {
        ativo: true,
        titulo: "800 x 1600 mm",
        detalhe: "0,8 × 1,6 m",
        onEscolher: () => {},
      }),
      createElement(CartaoDeEscolha, {
        ativo: false,
        titulo: "800 x 2000 mm",
        onEscolher: () => {},
      }),
    ),
  );

  it("marca o escolhido e só ele", () => {
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(1);
  });

  it("a grade é um grupo com nome para leitor de tela", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Tamanhos"');
  });

  it("a prévia respeita a proporção da peça e não desenha sem medida", () => {
    const alto = renderToStaticMarkup(createElement(PreviaDaPeca, { largura: 0.8, altura: 1.6 }));
    expect(alto).toContain("width:20px");
    expect(alto).toContain("height:40px");
    expect(renderToStaticMarkup(createElement(PreviaDaPeca, { largura: null, altura: 2 }))).toBe(
      "",
    );
  });
});

describe("descrição do tamanho", () => {
  it("mostra a medida em metros e a área", () => {
    expect(descricaoDoTamanho(0.8, 1.6)).toBe("0,8 × 1,6 m · 1,28 m²");
  });
  it("sem medida não descreve", () => {
    expect(descricaoDoTamanho(null, 1)).toBeUndefined();
  });
});

describe("acabamento em cartões", () => {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(AcabamentoDoItem, {
        valor: "bainha",
        opcoes: ["bainha", "ilhós"],
        onMudar: () => {},
      }),
    ),
  );
  it("cada opção é um cartão e a marcada aparece marcada", () => {
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("ilhós");
  });
  it("o campo livre continua embaixo", () => {
    expect(html).toContain('id="item-acabamento"');
  });
});
