import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FAMILIAS } from "@/lib/produtos-catalogo";

/**
 * Catálogo, fase 2a (25/10/2026): família e SKU. A migração só acrescenta (coluna nula e
 * preenchimento do que está vazio) — não pode tocar em preço, custo nem nome.
 */
const SQL = readFileSync("supabase/migrations/20261025100000_catalogo_familia_e_codigo.sql", "utf8");
const linhas = [...SQL.matchAll(/^\s*\('([^']+)',\s*'([a-z_]+)',\s*'([^']+)',\s*(NULL|'[A-Z0-9-]+')\)/gm)].map((m) => ({
  nome: m[1],
  categoria: m[2],
  familia: m[3],
  sku: m[4] === "NULL" ? null : m[4].replaceAll("'", ""),
}));

describe("migração de família e código", () => {
  it("cobre os 53 produtos do catálogo", () => {
    expect(linhas.length).toBe(53);
  });
  it("só usa famílias da lista sugerida", () => {
    for (const l of linhas) expect(FAMILIAS as readonly string[]).toContain(l.familia);
  });
  it("os SKUs novos são únicos e seguem o padrão em uso (3 letras, hífen, código)", () => {
    const skus = linhas.map((l) => l.sku).filter((s): s is string => !!s);
    expect(new Set(skus).size).toBe(skus.length);
    for (const s of skus) expect(s).toMatch(/^[A-Z]{3}-[A-Z0-9]{2,9}$/);
  });
  it("não mexe em preço, custo, nome nem categoria, e preserva SKU que já existe", () => {
    const update = SQL.slice(SQL.indexOf("UPDATE public.produtos"));
    expect(update).toMatch(/SET familia = COALESCE\(p\.familia, m\.familia\),\s*sku\s*= COALESCE\(p\.sku, m\.sku\)/);
    const set = update.slice(update.indexOf("SET"), update.indexOf("FROM"));
    expect(set).not.toMatch(/preco|custo|margem|nome|categoria/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE VIEW/i);
  });
  it("a tela do cadastro grava a família na tabela (não na view)", () => {
    const tela = readFileSync("src/routes/_authenticated/produtos.tsx", "utf8");
    expect(tela).toContain("familia: f.familia.trim() || null");
    expect(tela).toContain('.from("produtos").select("id, familia")');
  });
});
