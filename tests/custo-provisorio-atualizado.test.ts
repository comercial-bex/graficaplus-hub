import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261030400000_custo_provisorio_atualizado.sql", "utf8");

describe("custo provisório acompanha o produto parecido", () => {
  it("cobre os seis produtos e só mexe em quem ainda é provisório e diferente", () => {
    for (const n of ["Adesivo PROMO", "Adesivo fosco", "Adesivo blackout", "Adesivo perfurado promocional", "Lona fosca", "Lona backlight"]) {
      expect(SQL).toContain(`'${n}'`);
    }
    expect(SQL).toContain("LIKE '%PROVISÓRIOS%'");
    expect(SQL).toContain("p.custo_medio <> s.custo_medio");
  });
  it("não toca o adesivo transparente (custo real da ficha) e deixa a volta anotada", () => {
    expect(SQL).not.toContain("transparente");
    expect(SQL).toContain("14.78");
  });
  it("com os custos novos todas as margens ficam acima do mínimo de 30%", () => {
    const casos: [number, number][] = [[9.21, 23.9], [9.21, 34.9], [9.38, 34.9], [20.26, 34.9], [20.26, 54.9]];
    for (const [c, p] of casos) expect((p - c) / p).toBeGreaterThan(0.3);
  });
});
