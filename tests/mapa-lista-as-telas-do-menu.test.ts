import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AREAS, FORA_DO_MENU, telasDoItem } from "../src/lib/menu";

const tela = readFileSync("src/routes/_authenticated/mapa-sistema.tsx", "utf8");

describe("mapa do sistema lê as telas do menu", () => {
  it("usa a árvore e a lista de 'fora do menu', sem cópia manual", () => {
    expect(tela).toContain("AREAS.map");
    expect(tela).toContain("Object.entries(FORA_DO_MENU)");
    expect(tela).toContain('data-testid="mapa-telas-do-menu"');
  });
  it("a árvore tem itens em todas as áreas e cada item tem ao menos uma tela", () => {
    expect(AREAS.length).toBeGreaterThanOrEqual(4);
    for (const a of AREAS) {
      const itens = a.subgrupos.flatMap((s) => s.itens);
      expect(itens.length, a.label).toBeGreaterThan(0);
      for (const i of itens) expect(telasDoItem(i).length, i.title).toBeGreaterThan(0);
    }
    expect(Object.keys(FORA_DO_MENU).length).toBeGreaterThan(0);
  });
});
