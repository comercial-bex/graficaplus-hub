import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  custoDoMaterial,
  materiaisDaVariante,
  maquinasSugeridas,
  passosDoTipo,
  pendenciaDoPasso,
  precoQueCumpreAMargem,
  produtoDasRespostas,
  RESPOSTAS_VAZIAS,
  skuSugerido,
  TIPOS_DE_BASE,
  type MaterialDoEstoque,
} from "@/domain/catalogo/novo-produto-em-passos";
import { CATEGORIAS, FAMILIAS } from "@/lib/produtos-catalogo";

const tipo = (c: string) => TIPOS_DE_BASE.find((t) => t.chave === c)!;
const MATERIAIS: MaterialDoEstoque[] = [
  { id: "1", nome: "Lona 280g brilho", unidade: "m²", custo_medio: 9.5 },
  { id: "2", nome: "Lona 440g reforçada", unidade: "m²", custo_medio: 16.23 },
  { id: "3", nome: "Vinil adesivo branco brilho", unidade: "m²", custo_medio: 9.5 },
  { id: "4", nome: "Vinil adesivo perfurado", unidade: "m²", custo_medio: 22 },
  { id: "5", nome: "ACRILICO CRISTAL VIRGEM 3MM", unidade: "m²", custo_medio: 400 },
  { id: "6", nome: "Chapa ACM 3mm", unidade: "m²", custo_medio: 95 },
];

describe("tipos e variações", () => {
  it("toda categoria e família usada existe no catálogo", () => {
    const categorias = new Set<string>(CATEGORIAS.map((c) => c.value));
    const familias = new Set<string>(FAMILIAS);
    for (const t of TIPOS_DE_BASE) {
      expect(categorias.has(t.categoria), t.chave).toBe(true);
      for (const v of t.variantes)
        expect(familias.has(v.familia), `${t.chave}/${v.chave}`).toBe(true);
    }
  });

  it("os nomes sugeridos são os do catálogo da tabela de terceirizados", () => {
    const nomes = TIPOS_DE_BASE.flatMap((t) => t.variantes.map((v) => v.nome));
    for (const n of [
      "Lona 280g impressa",
      "Lona 440g reforçada impressa",
      "Adesivo vinil branco impresso",
      "Banner com bastão e corda",
    ]) {
      expect(nomes).toContain(n);
    }
  });

  it("cada tipo tem variações com código e nenhum código se repete dentro do tipo", () => {
    for (const t of TIPOS_DE_BASE) {
      const codigos = t.variantes.map((v) => v.codigo);
      expect(new Set(codigos).size, t.chave).toBe(codigos.length);
      expect(t.variantes.length).toBeGreaterThan(0);
    }
  });
});

describe("material e máquina sugeridos", () => {
  it("lona 440 g acha só a lona 440 g", () => {
    const lona = tipo("lona");
    const v = lona.variantes.find((x) => x.chave === "440")!;
    expect(materiaisDaVariante(MATERIAIS, lona, v).map((m) => m.nome)).toEqual([
      "Lona 440g reforçada",
    ]);
  });

  it("adesivo perfurado e vinil branco não se misturam", () => {
    const ad = tipo("adesivo");
    const perf = ad.variantes.find((x) => x.chave === "perfurado")!;
    const branco = ad.variantes.find((x) => x.chave === "branco")!;
    expect(materiaisDaVariante(MATERIAIS, ad, perf).map((m) => m.id)).toEqual(["4"]);
    expect(materiaisDaVariante(MATERIAIS, ad, branco).map((m) => m.id)).toEqual(["3"]);
  });

  it("acrílico ignora acento e caixa; placa ACM acha a chapa", () => {
    const acr = tipo("acrilico");
    expect(materiaisDaVariante(MATERIAIS, acr, acr.variantes[0]).map((m) => m.id)).toEqual(["5"]);
    const placa = tipo("placa");
    expect(materiaisDaVariante(MATERIAIS, placa, placa.variantes[0]).map((m) => m.id)).toEqual([
      "6",
    ]);
  });

  it("brinde e serviço não procuram material", () => {
    expect(materiaisDaVariante(MATERIAIS, tipo("brinde"), tipo("brinde").variantes[0])).toEqual([]);
    expect(passosDoTipo(tipo("brinde"))).toEqual([1, 2, 4, 5, 6]);
    expect(passosDoTipo(tipo("lona"))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("a variação com recorte pede a plotter de recorte; o resto, a de impressão", () => {
    const maquinas = [
      { nome: "Plotter de Impressão i1600 180 — Eco" },
      { nome: "Plotter de Recorte 120" },
      { nome: "CNC Laser" },
    ];
    const ad = tipo("adesivo");
    expect(
      maquinasSugeridas(maquinas, ad, ad.variantes.find((v) => v.chave === "recortado")!).map(
        (m) => m.nome,
      ),
    ).toEqual(["Plotter de Recorte 120"]);
    expect(maquinasSugeridas(maquinas, ad, ad.variantes[0]).map((m) => m.nome)).toContain(
      "Plotter de Impressão i1600 180 — Eco",
    );
    expect(maquinasSugeridas(maquinas, tipo("acrilico"), null).map((m) => m.nome)).toEqual([
      "CNC Laser",
    ]);
  });
});

describe("custo, preço e código", () => {
  it("o custo é o do material e o preço cumpre a margem mínima", () => {
    expect(custoDoMaterial(MATERIAIS[1])).toBe(16.23);
    expect(custoDoMaterial(null)).toBe(0);
    expect(precoQueCumpreAMargem(16.23, 40)).toBe(27.05);
    expect(precoQueCumpreAMargem(0, 40)).toBe(0);
    expect(precoQueCumpreAMargem(10, 100)).toBe(0);
  });

  it("o SKU segue o padrão e não repete um que já existe", () => {
    const lona = tipo("lona");
    const v = lona.variantes.find((x) => x.chave === "440")!;
    expect(skuSugerido(lona, v, [])).toBe("LON-440");
    expect(skuSugerido(lona, v, ["lon-440"])).toBe("LON-4402");
    expect(skuSugerido(lona, v, ["LON-440", "LON-4402"])).toBe("LON-4403");
  });
});

describe("passos e produto final", () => {
  it("não deixa avançar sem tipo, sem variação, sem nome nem SKU", () => {
    expect(pendenciaDoPasso(1, RESPOSTAS_VAZIAS)).toBeTruthy();
    expect(pendenciaDoPasso(2, RESPOSTAS_VAZIAS)).toBeTruthy();
    expect(pendenciaDoPasso(6, RESPOSTAS_VAZIAS)).toBeTruthy();
    expect(pendenciaDoPasso(3, RESPOSTAS_VAZIAS)).toBeNull();
    expect(pendenciaDoPasso(5, { ...RESPOSTAS_VAZIAS, margemMinima: "120" })).toBeTruthy();
  });

  it("monta o produto na forma da tabela, com vírgula decimal e área mínima só quando há", () => {
    const lona = tipo("banner");
    const p = produtoDasRespostas({
      ...RESPOSTAS_VAZIAS,
      tipo: lona,
      variante: lona.variantes[0],
      material: MATERIAIS[0],
      unidade: "m2",
      areaMinima: "1",
      custo: "9,5",
      preco: "37,90",
      margemMinima: "40",
      nome: " Banner X ",
      sku: "ban-x",
      familia: "Banners",
      marca: "Avery",
    });
    expect(p).toMatchObject({
      nome: "Banner X",
      sku: "BAN-X",
      categoria: "comunicacao_visual",
      custo_medio: 9.5,
      preco_base: 37.9,
      area_minima_cobrada: 1,
      material_principal_id: "1",
      observacoes_internas: "Marca: Avery",
      ativo: true,
    });
    expect(
      produtoDasRespostas({ ...RESPOSTAS_VAZIAS, tipo: lona, areaMinima: "" }).area_minima_cobrada,
    ).toBeNull();
  });
});

describe("a tela", () => {
  const tela = readFileSync("src/components/produtos/novo-produto-em-passos.tsx", "utf8");
  const pagina = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");

  it("o 'Novo item' abre o assistente para quem vê custo, e o cadastro completo continua", () => {
    expect(pagina).toContain("<NovoProdutoEmPassos");
    expect(pagina).toContain("canSeeFinancials ? setPassosAberto(true) : abrirNovo()");
    expect(pagina).toContain("Cadastro completo");
    expect(pagina).toContain("onAbrirCadastroCompleto={abrirNovo}");
  });

  it("cria o produto e liga a ficha do material principal; falha na ficha não esconde o produto", () => {
    expect(tela).toContain('.from("produtos")');
    expect(tela).toContain('.from("produto_materiais")');
    expect(tela).toContain("O produto foi criado, mas a ficha do material não entrou");
  });

  it("o primeiro passo mostra um cartão por tipo mais Insumo e Outro", () => {
    expect(tela).toContain('titulo="Insumo"');
    expect(tela).toContain('titulo="Outro"');
    expect(tela).toContain("TIPOS_DE_BASE.map");
  });
});
