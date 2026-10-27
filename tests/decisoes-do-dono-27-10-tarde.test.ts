import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const m = readFileSync(new URL("../supabase/migrations/20261028300000_decisoes_do_dono_27_10_tarde.sql", import.meta.url), "utf8");

describe("decisões do dono de 27/10 (tarde)", () => {
  it("mão de obra fica no salário mínimo, sem o prefixo que dispara o aviso de valor estimado", () => {
    expect(m).toContain("Decisão do dono (27/10/2026): salário mínimo");
    expect(m).not.toMatch(/observacoes = 'Provisório/);
  });
  it("material que o dono disse que não comprou fica inativo e some dos avisos de estoque e de custo", () => {
    expect(m).toContain("status = 'inativo'");
    expect(m).toContain("m.status = 'ativo'");
    expect(m).toContain("mx.status <> 'ativo'");
  });
  it("o prazo temporário não reinicia o relógio de OS parada", () => {
    expect(m).toContain("DISABLE TRIGGER tg_os_updated");
    expect(m).toContain("ENABLE TRIGGER tg_os_updated");
  });
  it("preço do acabamento = custo da hora ÷ 60 × 1,6, com os números da regra da casa", () => {
    // 33,03/60×1,6 = 0,88 ; 24,17/60×1,6 = 0,64 ; 1,2092×1,6 = 1,93
    expect(Math.round((33.03 / 60) * 1.6 * 100) / 100).toBe(0.88);
    expect(Math.round((24.17 / 60) * 1.6 * 100) / 100).toBe(0.64);
    expect(Math.round(1.2092 * 1.6 * 100) / 100).toBe(1.93); // 3 min × R$ 24,17/h ÷ 60 + máquina, sem arredondar o custo
    expect(m).toContain("preco_venda = 0.88");
    expect(m).toContain("preco_venda = 0.64");
    expect(m).toContain("preco_venda = 1.93");
  });
});
