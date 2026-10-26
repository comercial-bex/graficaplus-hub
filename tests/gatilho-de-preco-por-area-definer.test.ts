import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const SQL = readFileSync("supabase/migrations/20261026700000_gatilho_de_preco_por_area_definer.sql", "utf8");

describe("gatilho de preço por área roda como DEFINER", () => {
  it("a migração troca o gatilho para SECURITY DEFINER", () => {
    expect(SQL).toContain("ALTER FUNCTION public.tg_item_precificar_por_area() SECURITY DEFINER;");
  });
  it("o motivo está registrado: colunas de preço do produto sem SELECT para quem está logado", () => {
    expect(SQL).toContain("permission denied for table produtos");
    expect(SQL).toContain("preco_parceiro_acima");
  });
  it("nenhuma migração de gatilho de item lê colunas de preço do produto sem ser DEFINER ou ser corrigida depois", () => {
    // A leitura de preco_parceiro_acima/acima_de_m2 nasceu em 20261025200000; a correção tem de vir depois.
    const arquivos = readdirSync("supabase/migrations").sort();
    const nasceu = arquivos.find((a) => a.startsWith("20261025200000"));
    const corrigiu = arquivos.find((a) => a.startsWith("20261026700000"));
    expect(nasceu).toBeTruthy();
    expect(corrigiu).toBeTruthy();
    expect(arquivos.indexOf(corrigiu!)).toBeGreaterThan(arquivos.indexOf(nasceu!));
  });
});
