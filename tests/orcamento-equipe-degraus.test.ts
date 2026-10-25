import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { degrausDeFaixasDeBalcao } from "../src/domain/parceiros/degraus";
import { TabelaDeDegraus } from "../src/components/parceiro/tabela-de-degraus";
import type { FaixaPreco } from "../src/domain/orcamentos/faixas";

/**
 * Os degraus de quantidade na tela do item da EQUIPE (25/10/2026), como no
 * orçamento do parceiro: a tabela com o preço por unidade de cada faixa, a que
 * vale marcada e o clique que só muda a quantidade.
 */

const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const MEDIDAS = readFileSync("src/components/orcamento/medidas-da-peca.tsx", "utf8");

const faixa = (
  id: string,
  qtd: number,
  preco: number,
  o: Partial<FaixaPreco> = {},
): FaixaPreco => ({
  id,
  quantidade_minima: qtd,
  preco_unitario: preco,
  ...o,
});

const FAIXAS = [faixa("a", 100, 1), faixa("b", 500, 0.7), faixa("c", 1000, 0.5)];

describe("degraus das faixas de balcão", () => {
  it("lista cada faixa com o preço por unidade e a economia sobre a primeira", () => {
    const d = degrausDeFaixasDeBalcao(FAIXAS, 100);
    expect(d.map((x) => x.quantidadeMinima)).toEqual([100, 500, 1000]);
    expect(d.map((x) => x.precoParceiro)).toEqual([1, 0.7, 0.5]);
    expect(d.map((x) => x.economiaPct)).toEqual([null, 30, 50]);
  });

  it("marca a faixa que a tela do item já aplicava (a maior cujo mínimo foi atingido)", () => {
    const marcada = (q: number) =>
      degrausDeFaixasDeBalcao(FAIXAS, q).find((x) => x.atual)?.quantidadeMinima;
    expect(marcada(100)).toBe(100);
    expect(marcada(499)).toBe(100);
    expect(marcada(500)).toBe(500);
    expect(marcada(5000)).toBe(1000);
    expect(marcada(50)).toBeUndefined();
  });

  it("faixa fora de vigência não entra na tabela", () => {
    const f = [
      faixa("a", 100, 1),
      faixa("b", 500, 0.7, { vigencia_fim: "2020-01-01" }),
      faixa("c", 1000, 0.5),
    ];
    expect(degrausDeFaixasDeBalcao(f, 100).map((x) => x.quantidadeMinima)).toEqual([100, 1000]);
  });

  it("sem pelo menos duas faixas vigentes não há tabela", () => {
    expect(degrausDeFaixasDeBalcao([], 10)).toEqual([]);
    expect(degrausDeFaixasDeBalcao([faixa("a", 100, 1)], 100)).toEqual([]);
    expect(
      degrausDeFaixasDeBalcao(
        [faixa("a", 100, 1), faixa("b", 500, 0.7, { vigencia_inicio: "2999-01-01" })],
        100,
      ),
    ).toEqual([]);
  });

  it("preço que vem do banco como texto também funciona", () => {
    const d = degrausDeFaixasDeBalcao(
      [faixa("a", 10, "2.00" as unknown as number), faixa("b", 20, "1.50" as unknown as number)],
      20,
    );
    expect(d.map((x) => x.precoParceiro)).toEqual([2, 1.5]);
    expect(d[1].economiaPct).toBe(25);
    expect(d[1].atual).toBe(true);
  });
});

describe("a tabela, agora com título próprio", () => {
  const degraus = degrausDeFaixasDeBalcao(FAIXAS, 600);

  it("usa o título da equipe quando ele vem", () => {
    const html = renderToStaticMarkup(
      createElement(TabelaDeDegraus, {
        degraus,
        unidade: "un",
        titulo: "Quanto mais, menor o preço por unidade",
        desabilitado: false,
        onEscolher: () => {},
      }),
    );
    expect(html).toContain("Quanto mais, menor o preço por unidade");
    expect(html).not.toContain("para você");
    expect(html).toContain("−50%");
  });

  it("sem título, continua dizendo o que dizia ao parceiro", () => {
    const html = renderToStaticMarkup(
      createElement(TabelaDeDegraus, {
        degraus,
        unidade: "un",
        desabilitado: false,
        onEscolher: () => {},
      }),
    );
    expect(html).toContain("Quanto mais, mais barato para você (un)");
  });
});

describe("a tela do item da equipe", () => {
  it("mostra a tabela só para quem vê preço, e clicar numa linha só muda a quantidade", () => {
    const i = TELA.indexOf("<TabelaDeDegraus");
    expect(i).toBeGreaterThan(0);
    const antes = TELA.slice(Math.max(0, i - 200), i);
    expect(antes).toContain("canSeePrices");
    const bloco = TELA.slice(i, TELA.indexOf("/>", i) + 2);
    expect(bloco).toContain("degrausDeFaixasDeBalcao(faixas, quantidadeForm)");
    expect(bloco).toContain("quantidade: String(q)");
    expect(bloco).not.toContain("valor_unitario");
  });

  it("o botão 'Usar este preço' e a frase do próximo degrau continuam", () => {
    expect(TELA).toContain("Usar este preço");
    expect(TELA).toContain("vale sugerir ao cliente");
  });

  it("os tamanhos prontos têm a mesma cara do parceiro: título, botões maiores e o escolhido marcado", () => {
    expect(MEDIDAS).toContain('data-testid="tamanhos-prontos"');
    expect(MEDIDAS).toContain("Tamanhos prontos");
    // Cada tamanho é um cartão de escolha (botão aria-pressed, cantos rounded-xl) com o escolhido marcado.
    const CARTAO = readFileSync("src/components/orcamento/cartao-de-escolha.tsx", "utf8");
    expect(MEDIDAS).toContain("<CartaoDeEscolha");
    expect(MEDIDAS).toContain("ativo={ativo}");
    expect(CARTAO).toContain("rounded-xl");
    expect(CARTAO).toContain("aria-pressed={ativo}");
    expect(MEDIDAS).toContain("Tamanhos deste produto");
    expect(MEDIDAS).toContain("Medidas comuns");
  });
});
