import { describe, expect, it } from "vitest";
import { AREAS } from "../src/lib/menu";

/**
 * Produção no menu enxuto (02/11/2026, OK do dono ao plano do custeio). Em
 * 20/10 eram cinco subgrupos; agora quatro: o que acontece com a OS depois da
 * máquina (trabalho parado, entrega, perdas) virou aba da própria OS, e a arte,
 * o material e a compra ficaram juntos.
 */
describe("Produção no menu", () => {
  const producao = AREAS.find((a) => a.id === "producao")!;

  it("tem quatro subgrupos, na ordem do trabalho", () => {
    expect(producao.subgrupos.map((s) => s.label)).toEqual([
      "Fila da oficina",
      "Máquinas",
      "Arte e material",
      "Impressão 3D",
    ]);
  });

  it("a OS é um hub: parada, entrega, perdas e ocorrências são abas dela", () => {
    const os = producao.subgrupos[0].itens.find((i) => i.url === "/os")!;
    expect(os.abas.map((a) => a.url)).toEqual(["/onde-para", "/entregas", "/perdas", "/ocorrencias"]);
    expect(os.atalho).toBe(2);
  });

  it("arte, material e compras ficam juntos; o selo de artes aguardando continua no item", () => {
    const sub = producao.subgrupos.find((s) => s.label === "Arte e material")!;
    expect(sub.itens.map((i) => i.url)).toEqual(["/design", "/materiais", "/compras"]);
    expect(sub.itens[0].badge).toBe("artesAguardando");
  });

  it("nenhum subgrupo de um item só sobrou em Produção", () => {
    for (const s of producao.subgrupos) {
      if (s.label === "Impressão 3D") continue; // um item com seis abas: é um hub
      expect(s.itens.length, s.label ?? "").toBeGreaterThan(1);
    }
  });
});
