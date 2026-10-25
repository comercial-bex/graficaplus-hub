import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EscolhaDeMaterial } from "@/components/orcamento/escolha-de-material";
import { FAMILIAS_DE_MATERIAL, variantesDoMaterial } from "@/domain/orcamentos/material-do-produto";

const lona280 = { nome: "Lona 280g impressa" };
const lona440 = { nome: "Lona 440g reforçada impressa" };
const banner = { nome: "Banner com bastão e corda" };

describe("variações de material", () => {
  it("lona 280 g e 440 g aparecem juntas, com a atual marcada", () => {
    const v = variantesDoMaterial("Lona 280g impressa", [banner, lona440, lona280]);
    expect(v?.opcoes.map((o) => o.rotulo)).toEqual(["Brilho 280 g", "Reforçada 440 g"]);
    expect(v?.opcoes.filter((o) => o.atual).map((o) => o.rotulo)).toEqual(["Brilho 280 g"]);
  });

  it("a ordem é a da família, não a do catálogo", () => {
    const v = variantesDoMaterial("Lona 440g reforçada impressa", [lona440, lona280]);
    expect(v?.opcoes[0].produto).toBe(lona280);
  });

  it("produto sem variação ativa não mostra escolha", () => {
    expect(variantesDoMaterial("Lona 280g impressa", [lona280, banner])).toBeNull();
    expect(variantesDoMaterial("Banner com bastão e corda", [banner, lona280])).toBeNull();
    expect(variantesDoMaterial(null, [lona280, lona440])).toBeNull();
  });

  it("o nome não diferencia maiúscula nem espaço nas pontas", () => {
    expect(variantesDoMaterial("  lona 280G impressa ", [lona280, lona440])?.opcoes).toHaveLength(
      2,
    );
  });

  it("nenhum nome se repete entre as famílias", () => {
    const nomes = FAMILIAS_DE_MATERIAL.flatMap((f) => f.variantes.map((v) => v.nome.toLowerCase()));
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("cartões de material", () => {
  const html = renderToStaticMarkup(
    createElement(EscolhaDeMaterial, {
      nomeAtual: "Lona 280g impressa",
      catalogo: [lona280, lona440],
      preco: (p: { nome: string }) => (p === lona280 ? "R$ 26,90/m²" : "R$ 34,90/m²"),
      onEscolher: () => {},
    }),
  );
  it("mostra um cartão por material, com o preço, e o atual marcado", () => {
    expect(html).toContain("Brilho 280 g");
    expect(html).toContain("Reforçada 440 g");
    expect(html).toContain("R$ 34,90/m²");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });
  it("não renderiza nada quando não há escolha", () => {
    expect(
      renderToStaticMarkup(
        createElement(EscolhaDeMaterial, { nomeAtual: "X", catalogo: [], onEscolher: () => {} }),
      ),
    ).toBe("");
  });
  it("as duas telas usam o componente e escolher troca o produto", () => {
    const editor = readFileSync("src/components/parceiro/editor-de-orcamento.tsx", "utf8");
    const equipe = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
    expect(editor).toContain("<EscolhaDeMaterial");
    expect(editor).toContain("onEscolher={onEscolherProduto}");
    expect(equipe).toContain("<EscolhaDeMaterial");
    expect(equipe).toContain("onEscolher={aplicarProduto}");
  });
});
