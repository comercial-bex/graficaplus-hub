import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { degrausDoProduto } from "../src/domain/parceiros/degraus";
import { precoDaGrafica, type ItemDoCatalogo } from "../src/domain/parceiros/preco";
import { TabelaDeDegraus } from "../src/components/parceiro/tabela-de-degraus";

/**
 * O orçamento do parceiro com cara de loja (24/10/2026): degraus de quantidade
 * em tabela, tamanhos prontos em botões e resumo sempre à vista no celular. É
 * o que Printi e 360imprimir fazem, sem mexer em nenhuma conta de preço.
 */

const EDITOR = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");

const produto = (faixas: ItemDoCatalogo["faixas"]): ItemDoCatalogo => ({
  produto_id: "p1",
  nome: "Adesivo",
  categoria: "adesivos",
  unidade: "un",
  por_area: false,
  area_minima: null,
  preco_referencia: null,
  preco_parceiro: null,
  origem: "faixa",
  oferta_id: null,
  oferta_titulo: null,
  faixas,
  tamanhos: [],
});

const FAIXAS = [
  { quantidade_minima: 100, preco_referencia: 1, preco_parceiro: 0.8 },
  { quantidade_minima: 500, preco_referencia: 0.7, preco_parceiro: 0.5 },
  { quantidade_minima: 1000, preco_referencia: 0.5, preco_parceiro: 0.4 },
];

describe("degraus de quantidade", () => {
  it("lista cada faixa com o preço do parceiro e a economia sobre o primeiro degrau", () => {
    const d = degrausDoProduto(produto(FAIXAS), 100);
    expect(d.map((x) => x.quantidadeMinima)).toEqual([100, 500, 1000]);
    expect(d.map((x) => x.precoParceiro)).toEqual([0.8, 0.5, 0.4]);
    expect(d.map((x) => x.economiaPct)).toEqual([null, 38, 50]);
    expect(d[1].precoBalcao).toBe(0.7);
  });

  it("destaca o degrau que vale para a quantidade — o mesmo que o custo do item usa", () => {
    for (const q of [100, 499, 500, 999, 1000, 5000]) {
      const atual = degrausDoProduto(produto(FAIXAS), q).find((x) => x.atual);
      const preco = precoDaGrafica(produto(FAIXAS), q);
      expect(preco.tipo).toBe("ok");
      if (preco.tipo !== "ok") return;
      expect(atual?.precoParceiro, `quantidade ${q}`).toBe(preco.preco);
    }
  });

  it("quantidade fracionada arredonda para cima, como o banco", () => {
    expect(degrausDoProduto(produto(FAIXAS), 499.2).find((x) => x.atual)?.quantidadeMinima).toBe(
      500,
    );
  });

  it("abaixo do primeiro degrau, nenhum fica destacado", () => {
    expect(degrausDoProduto(produto(FAIXAS), 50).some((x) => x.atual)).toBe(false);
  });

  it("sem faixas, com uma faixa só ou sem produto, não há tabela", () => {
    expect(degrausDoProduto(produto(null), 100)).toEqual([]);
    expect(degrausDoProduto(produto([FAIXAS[0]]), 100)).toEqual([]);
    expect(degrausDoProduto(undefined, 100)).toEqual([]);
  });

  it("preço igual ao do primeiro degrau não inventa economia", () => {
    const d = degrausDoProduto(
      produto([
        { quantidade_minima: 10, preco_referencia: 1, preco_parceiro: 0.8 },
        { quantidade_minima: 20, preco_referencia: 1, preco_parceiro: 0.8 },
      ]),
      10,
    );
    expect(d[1].economiaPct).toBeNull();
  });
});

describe("a tabela de degraus na tela", () => {
  const degraus = degrausDoProduto(produto(FAIXAS), 600);
  const html = renderToStaticMarkup(
    createElement(TabelaDeDegraus, {
      degraus,
      unidade: "un",
      desabilitado: false,
      onEscolher: () => {},
    }),
  );

  it("tem uma linha por degrau, e só a atual vem marcada", () => {
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });

  it("mostra a economia e o preço de cada degrau", () => {
    expect(html).toContain("−38%");
    expect(html).toContain("−50%");
    expect(html).toContain("a partir de 500");
    expect(html).toContain("R$");
  });

  it("não aparece sem degraus, e some o clique quando o orçamento é só leitura", () => {
    expect(
      renderToStaticMarkup(
        createElement(TabelaDeDegraus, {
          degraus: [],
          unidade: "un",
          desabilitado: false,
          onEscolher: () => {},
        }),
      ),
    ).toBe("");
    const lido = renderToStaticMarkup(
      createElement(TabelaDeDegraus, {
        degraus,
        unidade: "un",
        desabilitado: true,
        onEscolher: () => {},
      }),
    );
    expect(lido).toContain("disabled");
  });
});

describe("o editor do parceiro, com cara de loja", () => {
  it("mostra a tabela de degraus e escolher um degrau só muda a quantidade", () => {
    expect(EDITOR).toContain("<TabelaDeDegraus");
    expect(EDITOR).toContain("onEscolher={(q) => onMudar({ quantidade: q })}");
  });

  it("tamanhos prontos viram botões ANTES dos campos de medida, com o escolhido marcado", () => {
    const iBotoes = EDITOR.indexOf('data-testid="tamanhos-prontos"');
    const iCampos = EDITOR.indexOf("<CampoDeMedida", iBotoes);
    expect(iBotoes).toBeGreaterThan(0);
    expect(iCampos).toBeGreaterThan(iBotoes);
    expect(EDITOR).toContain("aria-pressed={escolhido}");
    expect(EDITOR).toContain("Ou digite a medida abaixo.");
  });

  it("as pílulas pequenas de tamanho saíram de baixo dos campos", () => {
    expect(EDITOR).not.toContain(
      "rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5",
    );
  });

  it("a barra fixa do resumo existe só abaixo do computador e leva a ação do momento", () => {
    const i = EDITOR.indexOf('data-testid="barra-fixa-do-resumo"');
    expect(i).toBeGreaterThan(0);
    const barra = EDITOR.slice(EDITOR.lastIndexOf("<div", i), EDITOR.indexOf("<PedidoDialog", i));
    expect(barra).toContain("lg:hidden");
    expect(barra).toContain("Cliente paga");
    for (const acao of ["salvar()", "irParaPasso(passoSeguinte(passo))", "abrirPedido"])
      expect(barra).toContain(acao);
  });

  it("a barra antiga de 'Alterações não salvas' só aparece no computador, para não brigar com a nova", () => {
    const i = EDITOR.indexOf("Alterações não salvas");
    const trecho = EDITOR.slice(EDITOR.lastIndexOf('<div className="fixed', i), i);
    expect(trecho).toContain("lg:flex");
    expect(trecho).toContain("hidden");
  });

  it("a conta de preço continua vindo do domínio", () => {
    expect(EDITOR).toContain("resumoDoOrcamento(itens, porProduto)");
    expect(EDITOR).not.toMatch(/preco_parceiro\s*\*/);
  });
});
