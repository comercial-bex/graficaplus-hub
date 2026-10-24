import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { economiaEmPct, juntarExtras, ordenar, precoAPartirDe } from "../src/domain/parceiros/vitrine";
import type { ItemDoCatalogo } from "../src/domain/parceiros/preco";

const item = (o: Partial<ItemDoCatalogo>): ItemDoCatalogo =>
  ({
    produto_id: "p", nome: "X", categoria: "adesivos", unidade: "m2", por_area: true, area_minima: null,
    preco_referencia: 100, preco_parceiro: 85, origem: "nivel", oferta_id: null, oferta_titulo: null,
    faixas: null, tamanhos: [], ...o,
  }) as ItemDoCatalogo;

describe("vitrine do parceiro", () => {
  it("economia: % abaixo do balcão no preço de entrada", () => {
    expect(economiaEmPct(item({}))).toBe(15);
    expect(economiaEmPct(item({ preco_parceiro: 100 }))).toBeNull();
    const f = item({ preco_referencia: null, preco_parceiro: null, faixas: [
      { quantidade_minima: 100, preco_referencia: 60, preco_parceiro: 45 },
      { quantidade_minima: 10, preco_referencia: 80, preco_parceiro: 64 },
    ] });
    expect(economiaEmPct(f)).toBe(20); // a faixa de entrada (10) é 80 → 64
    expect(precoAPartirDe(f)).toBe(45);
  });
  it("ordenar por menor preço e por maior economia", () => {
    const a = item({ produto_id: "a", nome: "A", preco_parceiro: 90, preco_referencia: 100 });
    const b = item({ produto_id: "b", nome: "B", preco_parceiro: 50, preco_referencia: 100 });
    expect(ordenar([a, b], "menor_preco").map((x) => x.nome)).toEqual(["B", "A"]);
    expect(ordenar([a, b], "maior_economia").map((x) => x.nome)).toEqual(["B", "A"]);
    expect(ordenar([b, a], "nome").map((x) => x.nome)).toEqual(["A", "B"]);
  });
  it("junta foto e tipo; sem extras, vira produto sem foto", () => {
    const [x, y] = juntarExtras(
      [item({ produto_id: "1" }), item({ produto_id: "2" })],
      [{ produto_id: "1", imagem_url: "https://x/f.jpg", tipo: "servico", descricao: "d" }],
    );
    expect(x).toMatchObject({ imagem_url: "https://x/f.jpg", tipo: "servico", descricao: "d" });
    expect(y).toMatchObject({ imagem_url: null, tipo: "produto" });
  });
  it("o painel usa o mesmo menu lateral da equipe (Sidebar) e o botão de tema", () => {
    const casca = readFileSync("src/components/parceiro/casca.tsx", "utf8");
    const menu = readFileSync("src/components/parceiro/menu-do-parceiro.tsx", "utf8");
    expect(casca).toContain("SidebarProvider");
    expect(casca).toContain("ThemeToggle");
    expect(menu).toContain('from "@/components/ui/sidebar"');
  });
});
