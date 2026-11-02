import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chipsDoFiltro,
  RELATORIOS,
  relatoriosDisponiveis,
  relatoriosNoFiltro,
} from "../src/components/relatorios/cartoes-de-relatorio";
import { alternarFavorito, chaveDosFavoritos, gravarFavoritos, lerFavoritos } from "../src/domain/favoritos-no-aparelho";
import { chaveDosFavoritosDeProduto, lerFavoritosDeProduto } from "../src/domain/orcamentos/favoritos-de-produto";

/**
 * Relatórios em cartões (01/11/2026), no jeito do Holdprint: desenho, uma linha
 * de "para que serve", estrela e filtros por área. Cada cartão rola até a
 * tabela, que continua no mesmo lugar.
 */

const ler = (c: string) => readFileSync(c, "utf8");

describe("a lista de relatórios bate com as tabelas da página", () => {
  const pagina = ler("src/routes/_authenticated/relatorios.tsx");

  it("cada cartão tem uma âncora na página e um título igual ao da tabela", () => {
    expect(RELATORIOS).toHaveLength(10);
    for (const r of RELATORIOS) {
      expect(pagina.includes(`<Card id="${r.ancora}" className="scroll-mt-24">`), r.ancora).toBe(true);
      expect(pagina.includes(`<CardTitle>${r.titulo}</CardTitle>`), r.titulo).toBe(true);
      expect(r.descricao.length).toBeGreaterThan(12);
    }
    expect(new Set(RELATORIOS.map((r) => r.chave)).size).toBe(10);
    expect(pagina.includes("<CartoesDeRelatorio verFinanceiro={canSeeFinancials} />")).toBe(true);
  });

  it("sem permissão de dinheiro os quatro financeiros somem dos cartões", () => {
    expect(relatoriosDisponiveis(true)).toHaveLength(10);
    const semDinheiro = relatoriosDisponiveis(false);
    expect(semDinheiro).toHaveLength(6);
    expect(semDinheiro.some((r) => r.categoria === "financeiro")).toBe(false);
  });

  it("os chips contam certo e os favoritos saem na ordem da estrela", () => {
    const todos = relatoriosDisponiveis(true);
    const chips = chipsDoFiltro(todos, ["os-atrasadas", "faturamento", "inexistente"]);
    expect(chips.map((c) => `${c.rotulo}:${c.quantidade}`)).toEqual([
      "Favoritos:2",
      "Todos:10",
      "Financeiro:4",
      "Produção:4",
      "WhatsApp:2",
    ]);
    expect(relatoriosNoFiltro(todos, "favoritos", ["os-atrasadas", "faturamento", "inexistente"]).map((r) => r.chave)).toEqual([
      "os-atrasadas",
      "faturamento",
    ]);
    expect(relatoriosNoFiltro(todos, "whatsapp", []).map((r) => r.chave)).toEqual(["conversas-abertas", "tempo-de-resposta"]);
    // Sem dinheiro, o chip Financeiro nem aparece e o favorito financeiro não conta.
    const semDinheiro = relatoriosDisponiveis(false);
    expect(chipsDoFiltro(semDinheiro, ["faturamento"]).map((c) => c.rotulo)).toEqual(["Favoritos", "Todos", "Produção", "WhatsApp"]);
    expect(chipsDoFiltro(semDinheiro, ["faturamento"])[0].quantidade).toBe(0);
  });
});

describe("favoritos no aparelho valem para menu, produtos e relatórios", () => {
  it("a chave genérica e a de produto apontam para o mesmo jeito de ler", () => {
    expect(chaveDosFavoritos("bexprint:relatorios:favoritos", "A@B.c")).toBe("bexprint:relatorios:favoritos:a@b.c");
    expect(chaveDosFavoritosDeProduto("a@b.c")).toBe("bexprint:orcamento:produtos-favoritos:a@b.c");
    const dados = new Map<string, string>();
    const armazem = { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v) };
    gravarFavoritos("x", alternarFavorito([], "lucro-por-os"), armazem);
    expect(lerFavoritos("x", armazem)).toEqual(["lucro-por-os"]);
    expect(lerFavoritosDeProduto("x", armazem)).toEqual(["lucro-por-os"]);
  });
});

describe("a tela dos cartões", () => {
  const tela = ler("src/components/relatorios/cartoes-de-relatorio.tsx");

  it("tem estrela com aria-pressed, rola até a âncora e não usa title= nem text-primary", () => {
    expect(tela.includes("nos favoritos`")).toBe(true);
    expect(tela.includes("dos favoritos`")).toBe(true);
    expect(tela.includes("scrollIntoView(")).toBe(true);
    expect(tela.includes('data-testid="cartoes-de-relatorio"')).toBe(true);
    expect(/\stitle=/.test(tela)).toBe(false);
    expect(/(?<![-\w])text-primary(?![-\w])/.test(tela)).toBe(false);
    // Os chips e as estrelas têm 44 px no toque.
    expect(tela.includes("min-h-11")).toBe(true);
    expect(tela.includes("h-9 w-9")).toBe(true);
  });
});
