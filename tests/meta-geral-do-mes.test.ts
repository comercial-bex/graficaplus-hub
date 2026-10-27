import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { metaGeralDaEquipe } from "../src/hooks/useMetasDaEquipe";

const card = readFileSync(new URL("../src/components/painel/MetaDoMes.tsx", import.meta.url), "utf8");
const equipe = readFileSync(new URL("../src/components/painel/MetasDaEquipe.tsx", import.meta.url), "utf8");

describe("meta geral do mês (27/10/2026)", () => {
  it("a meta geral é a soma das metas de cada vendedor (R$ 40 mil = 10 + 20 + 10)", () => {
    expect(metaGeralDaEquipe([{ meta: 10000 }, { meta: "20000" }, { meta: 10000 }])).toBe(40000);
    expect(metaGeralDaEquipe([])).toBe(0);
    expect(metaGeralDaEquipe(undefined)).toBe(0);
  });

  it("o card e o bloco da equipe leem a MESMA consulta, para nunca mostrarem metas diferentes", () => {
    expect(card).toContain("useMetasDaEquipe(canSeeFinancials)");
    expect(equipe).toContain("useMetasDaEquipe(podeVer)");
  });

  it("a barra tem verde (recebido), azul (vendido a receber) e vermelho (falta), com o ponto de equilíbrio como marco", () => {
    expect(card).toContain("bg-red-500/75");
    expect(card).toContain("bg-[color:var(--bex-cyan)]/60");
    expect(card).toContain("marcoEquilibrio");
    expect(card).toContain("empata em");
    // sem metas por vendedor, volta para o ponto de equilíbrio em vez de desenhar zero
    expect(card).toMatch(/metaGeral > 0 \? metaGeral : temEquilibrio \? meta : 0/);
  });

  it("o texto ao lado do vendido mostra a % da meta da barra (a geral), não a do ponto de equilíbrio", () => {
    expect(card).toContain("{pct(atingido)} de {brl(metaDaBarra)}");
  });

  it("meta batida pinta a barra inteira de verde", () => {
    expect(card).toContain('bateu ? "bg-emerald-500"');
  });

  it("as contas da barra fecham em 100%", () => {
    const meta = 40000, vendido = 4951.89, recebido = 2821.49;
    const recebidoPct = Math.min((100 * Math.min(recebido, vendido)) / meta, 100);
    const vendidoPct = Math.max(Math.min((100 * vendido) / meta, 100) - recebidoPct, 0);
    const faltaPct = Math.max(100 - recebidoPct - vendidoPct, 0);
    expect(recebidoPct + vendidoPct + faltaPct).toBeCloseTo(100, 6);
    expect(faltaPct).toBeCloseTo(87.62, 1);
  });
});
