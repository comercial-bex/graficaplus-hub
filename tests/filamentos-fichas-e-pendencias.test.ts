import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migracao = readFileSync(new URL("../supabase/migrations/20261027600000_filamentos_fichas_e_pendencias.sql", import.meta.url), "utf8");

describe("filamentos, fichas e pendências (27/10/2026)", () => {
  it("'Novo filamento' não cita colunas que não existem nem grava a coluna gerada", () => {
    const funcao = migracao.slice(migracao.indexOf("CREATE OR REPLACE FUNCTION public.upsert_filamento_3d"), migracao.indexOf("INSERT INTO public.materiais"));
    // `materiais` não tem tipo/ativa e `custo_por_grama_calculado` é GERADA: os dois travavam o cadastro.
    expect(funcao).not.toMatch(/INSERT INTO materiais \([^)]*\b(tipo|ativa)\b/);
    expect(funcao).not.toMatch(/custo_por_grama_calculado/);
    expect(funcao).toMatch(/INSERT INTO materiais \(nome, unidade, status/);
    expect(funcao).toContain("'g'");
  });

  it("o vinil transparente tem preço real e os outros seis materiais ficam sem preço, avisando", () => {
    expect(migracao).toContain("17.6230");
    expect(migracao.match(/'SEM PREÇO:|'[^']*SEM PREÇO: informar/g)?.length).toBe(6);
  });

  it("cada produto da tabela ganha vinil/lona e tinta na ficha", () => {
    for (const p of ["Adesivo transparente", "Adesivo fosco", "Adesivo blackout", "Adesivo PROMO", "Adesivo perfurado promocional", "Lona fosca", "Lona backlight"]) {
      expect(migracao.match(new RegExp(`\\('${p}','[^']+', [0-9.]+, `, "g"))?.length, p).toBe(2);
    }
  });

  it("as pendências param se o trecho da regra mudou, em vez de aplicar uma regra velha", () => {
    expect(migracao.match(/não encontrado/g)?.length).toBeGreaterThanOrEqual(5);
    expect(migracao).toContain("producao_3d_jobs");
    expect(migracao).toContain("p.sku LIKE 'BRI-%'");
  });
});
