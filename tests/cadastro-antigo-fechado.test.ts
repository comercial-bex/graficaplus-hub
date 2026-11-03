import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * O cadastro antigo do convite (nove campos) foi fechado ao público em
 * 03/11/2026. A página usa só parceiro_cadastrar_rapido; a antiga aceitava
 * nome, e-mail e telefone sem conferir com a conta e disparava a boas-vindas
 * pelo WhatsApp da gráfica.
 */
const SQL = readFileSync("supabase/migrations/20261103500000_fechar_cadastro_antigo_do_convite.sql", "utf8");

function fontes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fontes(p);
    return /\.(ts|tsx)$/.test(e.name) && !p.endsWith("integrations/supabase/types.ts") ? [p] : [];
  });
}

describe("cadastro antigo do convite", () => {
  it("a migração tira de PUBLIC, anon e authenticated, devolve ao service_role e confere com has_function_privilege", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.parceiro_cadastrar_por_convite\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.parceiro_cadastrar_por_convite\([^)]*\)\s+TO service_role;/);
    expect(SQL).toContain("has_function_privilege('anon', v_f, 'EXECUTE')");
    expect(SQL).toContain("COMMENT ON FUNCTION public.parceiro_cadastrar_por_convite(");
  });
  it("nenhum arquivo do app a chama (só o types.ts gerado a cita)", () => {
    const chamadores = [...fontes("src")].filter((f) => readFileSync(f, "utf8").includes("parceiro_cadastrar_por_convite"));
    expect(chamadores).toEqual([]);
  });
});
