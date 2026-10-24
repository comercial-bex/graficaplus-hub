import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 24/10/2026: 13 OS de conferência (#175–#187) para impressões do RIP sem OS nem
 * orçamento. Criadas em 'entrada', a TV da oficina passou de 14 para 27 OS; em
 * 'concluido' ela voltou a 14. OS de uso interno não se cobra nem prevê material.
 */
const SQL = readFileSync("supabase/migrations/20261024250000_auditoria_rip_os_de_conferencia.sql", "utf8");

describe("OS de conferência do RIP", () => {
  it.each([
    "os.finalidade = ''venda'' AND os.status IN (''concluido'',''faturado'')",
    "os.finalidade = ''venda'' AND os.status::text IN (''concluido'', ''faturado'')",
    "os.finalidade = ''venda'' AND os.status IN (''faturado'', ''concluido'')",
    "AND os.finalidade = ''venda''",
  ])("só OS de venda entra em: %s", (trecho) => {
    expect(SQL).toContain(trecho);
  });
  it("a migração é idempotente (confere se já foi trocada antes de trocar)", () => {
    expect((SQL.match(/IF position\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
