import { describe, expect, it } from "vitest";
import { AREAS } from "../src/lib/menu";

/**
 * Produção com cinco subgrupos (20/10/2026). Eram seis títulos para nove itens,
 * e "Arte" tinha um item só. Agora "Arte, entrega e qualidade": a arte antes da
 * máquina, a entrega e as perdas depois dela.
 */
describe("Produção no menu", () => {
  const producao = AREAS.find((a) => a.id === "producao")!;

  it("tem cinco subgrupos, na ordem do trabalho", () => {
    expect(producao.subgrupos.map((s) => s.label)).toEqual([
      "Fila da oficina",
      "Máquinas",
      "Arte, entrega e qualidade",
      "Material e compras",
      "Impressão 3D",
    ]);
  });

  it("o subgrupo novo leva os três itens dos dois antigos, arte primeiro", () => {
    const sub = producao.subgrupos.find((s) => s.label === "Arte, entrega e qualidade")!;
    expect(sub.itens.map((i) => i.url)).toEqual(["/design", "/entregas", "/perdas"]);
    // O selo de artes aguardando continua no item.
    expect(sub.itens[0].badge).toBe("artesAguardando");
  });

  it("nenhum subgrupo de um item só sobrou em Produção", () => {
    for (const s of producao.subgrupos) {
      if (s.label === "Impressão 3D") continue; // um item com seis abas: é um hub
      expect(s.itens.length, s.label ?? "").toBeGreaterThan(1);
    }
  });
});
