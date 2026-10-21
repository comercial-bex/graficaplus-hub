import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { camposDaUnidade } from "../src/domain/orcamentos/tipos-de-produto";
import { UNIDADES_DO_ITEM, opcoesDaUnidade, unidadeDaLista } from "../src/domain/orcamentos/unidades-do-item";
import { DetalhesOpcionais } from "../src/components/orcamento/detalhes-opcionais";
import { UnidadeDoItem } from "../src/components/orcamento/unidade-do-item";

/**
 * O formulário do item do orçamento mais leve (20/10/2026). O dono: "melhorar UX
 * e UI para otimizar e não deixar as telas e modais pesadas e poluídas".
 *
 * Medido antes: o formulário mostrava de uma vez onze campos, um seletor de
 * produto com dezenas de cartões, três caixas condicionais, o envio de artes e um
 * resumo — para todo produto. O tipo de produto vem do produto escolhido; a
 * maioria dos itens não tem especificação nem arte na hora de orçar. E a unidade
 * era texto livre: nos dados reais só existem "un" (24 itens) e "m2" (12), mas um
 * erro de digitação ("metro quadrado") fazia a tela deixar de pedir a medida.
 */

const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");

describe("a unidade do item é uma lista, e o que estava gravado continua valendo", () => {
  it("as duas unidades que existem nos dados reais estão na lista, com o mesmo valor de sempre", () => {
    const valores = UNIDADES_DO_ITEM.map((u) => u.valor);
    expect(valores).toContain("un");
    expect(valores).toContain("m2");
    expect(unidadeDaLista("un")).toBe("un");
    expect(unidadeDaLista("m2")).toBe("m2");
  });

  it("toda unidade da lista é uma que a tela entende (camposDaUnidade) — nenhuma cai em 'un' em silêncio", () => {
    for (const u of UNIDADES_DO_ITEM) {
      const campos = camposDaUnidade(u.valor);
      expect(campos.unidadeLegivel, u.valor).toBeTruthy();
      // "peca" é a única que cai no padrão por desenho (rótulo "pç").
      if (u.valor !== "un" && u.valor !== "peca") expect(campos.rotuloQuantidade, u.valor).not.toBe("Quantidade");
    }
    expect(camposDaUnidade("m2").medidas).toBe(true);
    expect(camposDaUnidade("un").medidas).toBe(false);
  });

  it('"m²", "M2", "metro2" e " hora " são lidos como a unidade da lista', () => {
    expect(unidadeDaLista("m²")).toBe("m2");
    expect(unidadeDaLista(" M2 ")).toBe("m2");
    expect(unidadeDaLista("metro2")).toBe("m2");
    expect(unidadeDaLista("metro quadrado".replace(" ", ""))).toBe("m2");
    expect(unidadeDaLista(" Hora ")).toBe("h");
    expect(unidadeDaLista("Milheiro")).toBe("mil");
    expect(unidadeDaLista("")).toBe("un");
    expect(unidadeDaLista(null)).toBe("un");
  });

  it("unidade antiga fora da lista continua aparecendo no item que a tem — editar não troca sem a pessoa pedir", () => {
    expect(unidadeDaLista("pacote")).toBeNull();
    const opcoes = opcoesDaUnidade("pacote");
    expect(opcoes.map((o) => o.valor)).toContain("pacote");
    expect(opcoes.find((o) => o.valor === "pacote")?.rotulo).toBe("pacote (como estava)");
    // Unidade da lista não ganha opção extra.
    expect(opcoesDaUnidade("m2")).toHaveLength(UNIDADES_DO_ITEM.length);
  });

  it("o seletor é um campo com nome (o texto escolhido o Radix só desenha no navegador: conferido lá)", () => {
    // A dica da unidade escolhida fica no rótulo (era o title de cada opção): pede o TooltipProvider.
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(UnidadeDoItem, { valor: "m²", onMudar: () => undefined })),
    );
    expect(html).toContain('id="item-unidade"');
    expect(html).toContain("Vendido por");
    expect(html).toContain('aria-label="Ajuda: Vendido por"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("h-11 sm:h-9");
  });

  it("a tela usa a lista e não tem mais o campo de texto livre da unidade", () => {
    expect(TELA).toContain("<UnidadeDoItem");
    expect(TELA).not.toContain('id="item-unidade"');
  });
});

describe("o que é opcional fica recolhido, sem esconder o que foi preenchido", () => {
  const render = (aberto: boolean, preenchido: string[]) =>
    renderToStaticMarkup(
      createElement(
        DetalhesOpcionais,
        { aberto, onMudar: () => undefined, preenchido },
        createElement("p", null, "CONTEUDO-DA-SECAO"),
      ),
    );

  it("fechado: só o título, com o que existe dentro dito em palavras", () => {
    const html = render(false, []);
    expect(html).toContain("Detalhes opcionais");
    expect(html).toContain("tipo de produto, especificações e artes");
    expect(html).not.toContain("CONTEUDO-DA-SECAO");
    expect(html).toContain('aria-expanded="false"');
  });

  it("fechado com conteúdo: o resumo aparece ao lado do título — nada some sem aviso", () => {
    const html = render(false, ["especificação", "2 artes"]);
    expect(html).toContain("especificação");
    expect(html).toContain("2 artes");
    expect(html).not.toContain("tipo de produto, especificações e artes");
    expect(html).not.toContain("CONTEUDO-DA-SECAO");
  });

  it("aberto: o conteúdo aparece", () => {
    const html = render(true, ["especificação"]);
    expect(html).toContain("CONTEUDO-DA-SECAO");
    expect(html).toContain('aria-expanded="true"');
  });

  it("o botão tem alvo de toque de 44 px no celular", () => {
    expect(render(false, [])).toContain("min-h-11");
  });
});

describe("o formulário da tela", () => {
  it("tipo de produto, especificações e artes moram dentro dos detalhes opcionais", () => {
    const secao = TELA.slice(TELA.indexOf("<DetalhesOpcionais"), TELA.indexOf("</DetalhesOpcionais>"));
    for (const trecho of ['id="item-tipo"', 'id="item-especificacao"', "Layouts (artes a imprimir)", "<LayoutsDoRascunho", "<LayoutsDoItem"]) {
      expect(secao, trecho).toContain(trecho);
    }
    // E não ficaram duplicados fora dela.
    const fora = TELA.replace(secao, "");
    for (const trecho of ['id="item-tipo"', 'id="item-especificacao"', "<LayoutsDoRascunho"]) {
      expect(fora, trecho).not.toContain(trecho);
    }
  });

  it("a descrição fica sozinha, em largura total — é o único texto obrigatório do começo", () => {
    expect(TELA).toContain('<Label htmlFor="item-descricao">Descrição</Label>');
    expect(TELA).not.toContain('col-span-12 md:col-span-8">\n                      <Label htmlFor="item-descricao"');
  });

  it("abre sozinha quando há conteúdo ou o item está em edição, e depois não fecha sozinha", () => {
    expect(TELA).toContain("const detalhesPedemAbrir = !!editando || resumoDosDetalhes.length > 0;");
    expect(TELA).toContain("const detalhesAbertos = detalhesManual ?? detalhesPedemAbrir;");
    expect(TELA).toContain("setDetalhesManual((atual) => atual ?? true)");
    // Item novo começa fechado de novo.
    const limpar = TELA.slice(TELA.indexOf("function limparFormulario"), TELA.indexOf("Carrega um item gravado"));
    expect(limpar).toContain("setDetalhesManual(null);");
  });

  it("o resumo conta o que a pessoa preencheu: especificação e artes", () => {
    expect(TELA).toContain('form.especificacao.trim() ? "especificação" : null');
    expect(TELA).toContain('layoutsRascunho.length === 1 ? "1 arte" : `${layoutsRascunho.length} artes`');
  });

  it("o preço por m² desabilitado explica por quê no próprio campo — o 'title' não existe no celular", () => {
    expect(TELA).toContain('placeholder={vendidoPorArea ? undefined : "informe a medida"}');
    expect(TELA).not.toContain('title={vendidoPorArea ? undefined : "Informe largura e altura para vender por m²"}');
  });

  it("o que o orçamento grava não mudou: as mesmas colunas, na mesma chave", () => {
    for (const coluna of ["tipo_produto", "especificacao", "unidade", "acabamento", "produto_id"]) {
      expect(TELA).toContain(`${coluna}:`);
    }
  });
});
