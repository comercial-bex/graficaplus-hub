import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  produtoDaEscolhaDoParceiro,
  produtosDaEscolhaDoParceiro,
  unidadeDoParceiroParaOTipo,
} from "../src/domain/parceiros/escolha";
import { agruparPorTipo, tipoDoProduto, tipoPelaChave } from "../src/domain/orcamentos/tipos-de-produto";
import type { ItemDoCatalogo } from "../src/domain/parceiros/preco";
import { LinhaDoProduto } from "../src/components/parceiro/escolha-de-produto-do-parceiro";

/**
 * O parceiro escolhe o produto como a equipe (02/11/2026, decisão do dono): num
 * diálogo, o tipo em cartões e depois o produto com foto e o preço dele. A
 * tabela do parceiro é traduzida para o formato que a escolha da equipe lê.
 */

const item = (parcial: Partial<ItemDoCatalogo> = {}): ItemDoCatalogo => ({
  produto_id: "p1",
  nome: "Lona 440g",
  categoria: "impressao_grande_formato",
  unidade: "m²",
  por_area: true,
  area_minima: 1,
  preco_referencia: 90,
  preco_parceiro: 63,
  origem: "nivel",
  oferta_id: null,
  oferta_titulo: null,
  faixas: null,
  tamanhos: [],
  ...parcial,
});

describe("a tabela do parceiro vira cartões da equipe", () => {
  it("leva nome, categoria, unidade m2 (que pede medidas) e foto", () => {
    const p = produtoDaEscolhaDoParceiro(item(), {
      produto_id: "p1",
      imagem_url: "https://x/lona.jpg",
      tipo: "produto",
      descricao: "Lona fosca para fachada",
    });
    expect(p).toMatchObject({
      id: "p1",
      nome: "Lona 440g",
      categoria: "impressao_grande_formato",
      unidade: "m2",
      imagem_url: "https://x/lona.jpg",
      descricao: "Lona fosca para fachada",
    });
    expect(tipoDoProduto(p).chave).toBe("lona");
  });

  it("o preço do cartão é o do parceiro, não o de balcão; com faixas, a mais barata", () => {
    expect(produtoDaEscolhaDoParceiro(item()).preco_base).toBe(63);
    const comFaixas = item({
      preco_referencia: null,
      preco_parceiro: null,
      faixas: [
        { quantidade_minima: 100, preco_referencia: 1, preco_parceiro: 0.8 },
        { quantidade_minima: 500, preco_referencia: 0.7, preco_parceiro: 0.5 },
      ],
    });
    expect(produtoDaEscolhaDoParceiro(comFaixas).preco_base).toBe(0.5);
  });

  it("sem categoria cai em outros e sem extra fica sem foto", () => {
    const p = produtoDaEscolhaDoParceiro(item({ categoria: null, unidade: "un", por_area: false }));
    expect(p.categoria).toBe("outros");
    expect(p.unidade).toBe("un");
    expect(p.imagem_url).toBeNull();
    expect(p.tipo).toBe("produto");
  });

  it("a lista inteira agrupa por tipo na ordem da equipe", () => {
    const lista = produtosDaEscolhaDoParceiro(
      [item(), item({ produto_id: "p2", nome: "Adesivo vinil", categoria: "adesivos" }), item({ produto_id: "p3", nome: "Cartão de visita", categoria: "brindes", unidade: "mil", por_area: false })],
      [{ produto_id: "p2", imagem_url: "https://x/adesivo.jpg", tipo: "produto", descricao: null }],
    );
    const grupos = agruparPorTipo(lista).map((g) => [g.tipo.chave, g.produtos.map((p) => p.id)]);
    expect(grupos).toEqual([
      ["lona", ["p1"]],
      ["adesivo", ["p2"]],
      ["papel", ["p3"]],
    ]);
    expect(lista[1].imagem_url).toBe("https://x/adesivo.jpg");
  });
});

describe("item livre nasce com a unidade do tipo, reduzida às duas do parceiro", () => {
  it("lona e adesivo em m²; serviço, brinde e papel por unidade", () => {
    expect(unidadeDoParceiroParaOTipo(tipoPelaChave("lona"))).toBe("m²");
    expect(unidadeDoParceiroParaOTipo(tipoPelaChave("adesivo"))).toBe("m²");
    expect(unidadeDoParceiroParaOTipo(tipoPelaChave("servico"))).toBe("un");
    expect(unidadeDoParceiroParaOTipo(tipoPelaChave("brinde"))).toBe("un");
    expect(unidadeDoParceiroParaOTipo(tipoPelaChave("acabamento"))).toBe("un");
  });
});

describe("a linha encolhida do produto no cartão do item", () => {
  it("mostra nome, tipo, unidade e o preço do parceiro, com Trocar produto", () => {
    const html = renderToStaticMarkup(
      createElement(LinhaDoProduto, {
        produto: item(),
        produtoId: "p1",
        extra: null,
        descricao: "",
        onTrocar: () => {},
      }),
    );
    expect(html).toContain("Lona 440g");
    expect(html).toContain("Lona");
    expect(html).toContain("por m²");
    expect(html).toMatch(/R\$\s63,00\/m²/);
    expect(html).toContain("Trocar produto");
    expect(html).toContain('data-ilustracao="lona"');
  });
  it("com foto mostra a foto no lugar do desenho", () => {
    const html = renderToStaticMarkup(
      createElement(LinhaDoProduto, {
        produto: item(),
        produtoId: "p1",
        extra: { produto_id: "p1", imagem_url: "https://x/lona.jpg", tipo: "produto", descricao: null },
        descricao: "",
        onTrocar: () => {},
      }),
    );
    expect(html).toContain('src="https://x/lona.jpg"');
    expect(html).not.toContain("data-ilustracao");
  });
  it("item livre diz que é serviço do parceiro e não vira pedido", () => {
    const html = renderToStaticMarkup(
      createElement(LinhaDoProduto, {
        produto: undefined,
        produtoId: null,
        descricao: "Instalação na fachada",
        onTrocar: () => {},
      }),
    );
    expect(html).toContain("Instalação na fachada");
    expect(html).toContain("Serviço seu");
    expect(html).toContain("não vira pedido");
  });
});

describe("o editor do parceiro usa a escolha em cartões", () => {
  const EDITOR = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");
  const DIALOGO = readFileSync("src/components/parceiro/escolha-de-produto-do-parceiro.tsx", "utf8");
  it("Adicionar item abre o diálogo em vez de criar um item vazio na hora", () => {
    expect(EDITOR).toContain('onClick={() => setEscolhendo({ alvo: "novo" })}');
    expect(EDITOR).not.toContain("[...lista, itemVazio()]");
    expect(EDITOR).toContain("<DialogoDeEscolhaDoProduto");
    expect(EDITOR).toContain("<LinhaDoProduto");
    expect(EDITOR).not.toContain("SeletorDeProduto");
  });
  it("trocar o tipo de um item livre troca a unidade junto: a lona volta com medidas", () => {
    // 03/11, achado ao vivo: copiar a regra da equipe (a unidade anterior fica) deixava
    // "Outro item deste tipo" de lona em Unidade, sem largura × altura.
    expect(EDITOR).not.toContain("unidadeAoEscolherTipo");
    expect(EDITOR).toContain("const unidade = unidadeDoParceiroParaOTipo(tipo);");
  });
  it("o diálogo é a escolha da equipe, com o item livre do parceiro no rodapé", () => {
    expect(DIALOGO).toContain("<EscolhaDeProduto");
    expect(DIALOGO).toContain("verPreco");
    expect(DIALOGO).toContain('data-testid="item-livre-do-parceiro"');
    expect(DIALOGO).toContain('className="max-h-[90vh] max-w-3xl overflow-y-auto"');
  });
});
