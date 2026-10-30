import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261030300000_brindes_piso_da_margem.sql", "utf8");

describe("brindes no piso da margem mínima", () => {
  const casos: [string, number, number][] = [
    ["BRI-CUIA380", 30, 50.9],
    ["BRI-KC3B", 59, 98.9],
    ["BRI-KCL2", 69, 115.9],
  ];

  it.each(casos)("%s: o preço cumpre os 40% de margem mínima do cadastro", (sku, custo, preco) => {
    expect((preco - custo) / preco).toBeGreaterThanOrEqual(0.4);
    expect(SQL).toContain(`'${sku}', ${preco.toFixed(2)}`);
  });

  it.each(casos)("%s: é o piso (custo ÷ 0,60) arredondado ao próximo ,90", (_sku, custo, preco) => {
    const piso = custo / 0.6;
    const ate90 = Math.ceil(piso - 0.9) + 0.9;
    expect(Math.round(ate90 * 100) / 100).toBe(preco);
  });

  it("só sobe e nunca baixa um preço (idempotente)", () => {
    expect(SQL).toContain("p.preco_base < v.preco");
  });
});
