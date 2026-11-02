import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baseDeCalculo,
  familiasDaLista,
  filtrarPorFamiliaDaLista,
  fraseDoPlano,
  planoDeRenomear,
  rotuloDaUnidade,
  SEM_FAMILIA,
} from "@/domain/catalogo/familias-da-lista";
import { payloadDoCadastro } from "@/domain/catalogo/pasta-do-produto";

/**
 * Fase 1 do plano de 02/11/2026 (docs/esqueleto-e-plano-produtos-e-menu-02-11-2026.md):
 * a lista de produtos por família e a pasta editável, como o Custeio do Holdprint.
 */

const produtos = [
  { id: "a", nome: "Lona 280 g", categoria: "impressao_grande_formato", unidade: "m2", ativo: true },
  { id: "b", nome: "Lona 440 g", categoria: "impressao_grande_formato", unidade: "m2", ativo: true },
  { id: "c", nome: "Lona backlight", categoria: "impressao_grande_formato", unidade: "m2", ativo: false },
  { id: "d", nome: "Adesivo vinil", categoria: "adesivos", unidade: "m2", ativo: true },
  { id: "e", nome: "Caneca", categoria: "brindes", unidade: "un", ativo: true },
];
const familiaDe = new Map([
  ["a", "Lonas frontlight"],
  ["b", "Lonas frontlight"],
  ["c", "Lonas backlight"],
  ["d", "Adesivos impressos"],
]);

describe("famílias da lista", () => {
  it("agrupa por família em ordem alfabética, com o desenho do tipo mais comum e Sem família no fim", () => {
    const f = familiasDaLista(produtos, familiaDe);
    expect(f.map((x) => x.nome)).toEqual(["Adesivos impressos", "Lonas frontlight", SEM_FAMILIA]);
    expect(f.map((x) => x.quantidade)).toEqual([1, 2, 1]);
    expect(f.map((x) => x.chave)).toEqual(["adesivo", "lona", "brinde"]);
    expect(f[2].familia).toBeNull();
  });

  it("inativo só entra quando a tela mostra inativos", () => {
    expect(familiasDaLista(produtos, familiaDe).some((f) => f.nome === "Lonas backlight")).toBe(false);
    const com = familiasDaLista(produtos, familiaDe, { mostrarInativos: true });
    expect(com.find((f) => f.nome === "Lonas backlight")?.quantidade).toBe(1);
  });

  it("filtra pela família escolhida; nulo é todas; Sem família é quem não tem", () => {
    expect(filtrarPorFamiliaDaLista(produtos, familiaDe, null)).toHaveLength(5);
    expect(filtrarPorFamiliaDaLista(produtos, familiaDe, "Lonas frontlight").map((p) => p.id)).toEqual(["a", "b"]);
    expect(filtrarPorFamiliaDaLista(produtos, familiaDe, SEM_FAMILIA).map((p) => p.id)).toEqual(["e"]);
  });
});

describe("editar famílias", () => {
  const familias = familiasDaLista(produtos, familiaDe, { mostrarInativos: true });

  it("renomear diz quantos produtos mudam", () => {
    const plano = planoDeRenomear("Lonas frontlight", "Lonas", familias);
    expect(plano).toMatchObject({ ok: true, quantidade: 2, junta: false });
    expect(fraseDoPlano(plano)).toBe('Renomeia "Lonas frontlight" para "Lonas" em 2 produtos.');
  });

  it("dar o nome de outra família junta as duas, e a frase diz quantos cada lado tem", () => {
    const plano = planoDeRenomear("Lonas backlight", "Lonas frontlight", familias);
    expect(plano).toMatchObject({ ok: true, quantidade: 1, junta: true, jaTem: 2 });
    expect(fraseDoPlano(plano)).toContain("Junta 1 produto");
    expect(fraseDoPlano(plano)).toContain("que já tem 2 produtos");
  });

  it("recusa sem origem, sem nome, mesmo nome e o rótulo Sem família", () => {
    expect(planoDeRenomear("", "Lonas", familias).ok).toBe(false);
    expect(planoDeRenomear("Lonas frontlight", "  ", familias).ok).toBe(false);
    expect(planoDeRenomear("Lonas frontlight", "Lonas frontlight", familias).ok).toBe(false);
    expect(planoDeRenomear("Lonas frontlight", SEM_FAMILIA, familias).ok).toBe(false);
    expect(planoDeRenomear(SEM_FAMILIA, "Lonas", familias).ok).toBe(false);
  });
});

describe("unidade na proposta e base de cálculo", () => {
  it("m2 e m² viram Metros quadrados; unidade desconhecida volta como está", () => {
    expect(rotuloDaUnidade("m2")).toBe("Metros quadrados (m²)");
    expect(rotuloDaUnidade("m²")).toBe("Metros quadrados (m²)");
    expect(rotuloDaUnidade("un")).toBe("Unidade");
    expect(rotuloDaUnidade("caixa")).toBe("caixa");
  });

  it("a base da conta explica o que o item pede", () => {
    expect(baseDeCalculo("m2")).toMatch(/^Por área/);
    expect(baseDeCalculo("m")).toMatch(/^Por metro linear/);
    expect(baseDeCalculo("hora")).toMatch(/^Por hora/);
    expect(baseDeCalculo("un")).toMatch(/^Por peça/);
    expect(baseDeCalculo(null)).toMatch(/^Por peça/);
  });
});

describe("as telas", () => {
  const lista = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
  const pasta = readFileSync("src/routes/_authenticated/produtos_.$id.tsx", "utf8");
  const coluna = readFileSync("src/components/produtos/familias-da-lista.tsx", "utf8");

  it("a lista tem a coluna de famílias, Inserir produto e Editar famílias; o nome abre a pasta", () => {
    expect(lista).toContain("<FamiliasDaLista");
    expect(lista).toContain("<EditarFamilias");
    expect(lista).toContain("Inserir produto");
    expect(lista).toContain("Editar famílias");
    expect(lista).toContain("filtrarPorFamiliaDaLista(produtos, familiaDe, familiaEscolhida)");
    expect(lista.match(/to="\/produtos\/\$id"\s+params=\{\{ id: p\.id \}\}/g)?.length).toBe(2);
    // O que os outros testes e o dono contam com: o assistente, o cadastro completo e a família na lista.
    expect(lista).toContain("Cadastro completo");
    expect(lista).toContain("Modelos do mercado");
  });

  it("a pasta edita nome, família, unidade na proposta, preço, máquina, material e tamanhos", () => {
    for (const marca of [
      'htmlFor="pasta-nome"',
      'htmlFor="pasta-familia"',
      'htmlFor="pasta-descricao"',
      "Unidade na proposta",
      'rotulo="Como se calcula"',
      'rotulo="Custo do cadastro"',
      'htmlFor="pasta-maquina"',
      'htmlFor="pasta-material"',
      "<AbaTamanhos",
      "<ProdutoMateriaisEditor",
      "Método de cálculo da casa",
      'from("produto_tamanhos")',
    ])
      expect(pasta, marca).toContain(marca);
    // A gravação do cadastro pede as linhas de volta: a política que barra devolve zero linhas, sem erro.
    expect(pasta).toMatch(/\.from\("produtos"\)\s*\.update\(payloadDoCadastro\(cadastro, \{ canSeePrices, canSeeFinancials \}\)\)\s*\.eq\("id", id\)\s*\.select\("id"\)/);
  });

  it("preço e custo só vão no que se grava para quem os vê", () => {
    const base = {
      nome: " Lona ",
      descricao: "",
      familia: "Lonas",
      categoria: "impressao_grande_formato",
      tipo: "produto" as const,
      unidade: "m2",
      imagem_url: "",
      custo_medio: "40,5",
      preco_base: "89,9",
      margem_minima: "40",
      area_minima_cobrada: "",
      tempo_producao_min: "",
      maquina_padrao_id: "",
      material_principal_id: "",
      observacoes_internas: "",
    };
    const operacional = payloadDoCadastro(base, { canSeePrices: false, canSeeFinancials: false });
    expect(operacional).not.toHaveProperty("preco_base");
    expect(operacional).not.toHaveProperty("custo_medio");
    expect(operacional.nome).toBe("Lona");
    expect(operacional.tempo_producao_min).toBeNull();
    const financeiro = payloadDoCadastro(base, { canSeePrices: true, canSeeFinancials: true });
    expect(financeiro.preco_base).toBe(89.9);
    expect(financeiro.custo_medio).toBe(40.5);
    expect(financeiro.area_minima_cobrada).toBeNull();
  });

  it("a coluna de famílias marca a escolhida e não usa title= (a dica não aparece no toque)", () => {
    expect(coluna).toContain("aria-pressed={escolhida === f.nome}");
    expect(coluna).toContain('data-testid="familias-da-lista"');
    expect(coluna).not.toMatch(/\stitle=/);
    expect(coluna).toContain('.eq("familia", plano.de)');
    expect(coluna).toContain('.select("id")');
  });
});
