import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SQL = readFileSync("supabase/migrations/20261030200000_banner_balcao.sql", "utf8");

describe("balcão do banner próprio", () => {
  it("é o preço de parceiro vezes 1,7, arredondado ao próximo ,90", () => {
    const bruto = 37.9 * 1.7;
    expect(Math.round((Math.ceil(bruto - 0.9) + 0.9) * 100) / 100).toBe(64.9);
    expect(SQL).toContain("64.90");
  });
  it("só muda quem ainda está em 110 (idempotente) e deixa a volta anotada", () => {
    expect(SQL).toContain("AND preco_base = 110.00");
    expect(SQL).toContain("voltar BAN-LON a 110,00");
  });
  it("a margem sobre o custo cheio de R$ 15,95 fica acima do mínimo de 40%", () => {
    expect((64.9 - 15.95) / 64.9).toBeGreaterThan(0.4);
  });
});
