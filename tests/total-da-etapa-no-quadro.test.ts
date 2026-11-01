import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { totalDaEtapa } from "../src/domain/os/total-da-etapa";

/**
 * Total em reais no alto de cada coluna do quadro de produção (31/10/2026), Onda 7a
 * do plano `docs/plano-interface-holdprint-31-10-2026.md`.
 */
describe("total da etapa", () => {
  it("soma o valor das OS da coluna", () => {
    expect(totalDaEtapa([{ valor_total: 1112.5 }, { valor_total: "745" }, { valor_total: 700 }])).toBe(2557.5);
  });

  it("coluna vazia vale zero", () => {
    expect(totalDaEtapa([])).toBe(0);
  });

  it("valor ausente, nulo, texto ou inválido vale zero, nunca NaN", () => {
    expect(totalDaEtapa([{}, { valor_total: null }, { valor_total: "abc" }, { valor_total: NaN }, { valor_total: 10 }])).toBe(10);
  });
});

describe("o quadro de produção", () => {
  const QUADRO = readFileSync("src/routes/_authenticated/kanban.tsx", "utf8");

  it("só soma para quem vê preço e só mostra quando há dinheiro na coluna", () => {
    expect(QUADRO).toContain('import { totalDaEtapa } from "@/domain/os/total-da-etapa";');
    expect(QUADRO).toContain("canSeePrices ? totalDaEtapa(itens) : 0");
    expect(QUADRO).toContain("{totalDaColuna > 0 && (");
    expect(QUADRO).toContain("{brl(totalDaColuna)}");
  });
});
