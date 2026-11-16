import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapaDeMargem } from "../../src/components/precos/mapa-de-margem";
import { lerCustoReal } from "../../src/domain/precos/custo-real";

const l = (custo_real: number, preco: number) => ({
  margem_minima: 40,
  preco,
  real: { ...lerCustoReal({}), custo_real },
});
const html = (celula: { margem: 0 | 1 | 2; vezes: 0 | 1 | 2 } | null = null) =>
  renderToStaticMarkup(
    createElement(MapaDeMargem, {
      linhas: [l(20, 70), l(20, 70), l(40, 50), { margem_minima: 40, preco: 50, real: null }],
      celula,
      aoEscolher: () => {},
    }),
  );

describe("o mapa de margem na tela", () => {
  it("tem nove botões de grade, cada um com 44 px ou mais e nome acessível com a contagem", () => {
    const h = html();
    expect((h.match(/data-testid="celula-\d-\d"/g) ?? []).length).toBe(9);
    expect(h).toContain("min-h-16");
    expect(h).toContain('aria-label="Margem boa, 3 vezes o custo ou mais: 2 produtos, a meta"');
    expect(h).toContain("Abaixo do mínimo, Menos de 2 vezes o custo: 1 produto");
  });
  it("a célula tocada fica marcada e a frase de resumo está escrita", () => {
    const h = html({ margem: 2, vezes: 2 });
    expect(h).toMatch(/aria-pressed="true"[^>]*data-testid="celula-2-2"/);
    expect(h).toContain('data-testid="resumo-do-mapa"');
    expect(h).toContain("1 produto fica de fora");
    expect(h).toContain("1 produto não entra na grade");
  });
  it("letra de 16 px, sem parênteses, travessão ou seta", () => {
    const h = html();
    expect(h).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
    expect(h.replace(/<[^>]*>/g, " ")).not.toMatch(/[()—–→←]/);
  });
});
