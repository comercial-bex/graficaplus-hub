import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 22/11/2026. A chapa Terzian 1030 × 2030 mm (1,03 × 2,03 m) vende 1,00 × 2,00 m: a borda é sobra. Decisão do dono: o
 * custo e o estoque contam 2,00 m² por chapa. E o preto 3 mm estava a R$ 400,00 o m², que era o valor do saldo de
 * abertura, porque a NF-e 859 (R$ 389,00 a chapa) nunca tinha sido lançada. Estes testes travam a migração.
 */
const arquivo = "20261122100000_custo_do_acrilico_pela_area_util.sql";
const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
const codigo = sql.replace(/--[^\n]*/g, "");

describe("migração: custo do acrílico pela área útil da chapa", () => {
  it("o prefixo é único e a migração é uma transação só", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("20261122100000"))).toEqual([arquivo]);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it("para antes de gravar se o banco não estiver como foi medido", () => {
    for (const guarda of [
      "a medida útil já existe em materiais",
      "a NF-e 859 já está em Compras",
      "o preto 3 mm não está mais a R$ 400,00",
      "os lotes da NF-e 860 e 862 não estão como foram lançados",
      "já saiu material dos lotes de 04/11",
      "os itens da NF-e 860 e 862 não rendem mais 2,091 m²",
      "os três lotes de abertura de 3 mm não estão mais a R$ 400,00",
      "há automação de estoque mínimo ativa",
    ]) {
      expect(sql, guarda).toContain(guarda);
    }
  });

  it("a medida útil nasce com CHECK e cabe dentro da chapa", () => {
    expect(codigo).toContain("ADD COLUMN largura_util_m numeric(8, 3) CHECK (largura_util_m IS NULL OR largura_util_m > 0)");
    expect(codigo).toContain("ADD COLUMN comprimento_util_m numeric(8, 3) CHECK (comprimento_util_m IS NULL OR comprimento_util_m > 0)");
    expect(codigo).toContain("largura_util_m <= largura_chapa_m");
    expect(codigo).toContain("comprimento_util_m <= comprimento_chapa_m");
  });

  it("as visões são recriadas COM as opções de antes, e o leitor ganha o SELECT nas colunas novas", () => {
    expect(codigo).toContain("GRANT SELECT (largura_util_m, comprimento_util_m) ON public.materiais TO authenticated;");
    // o GRANT vem antes de recriar a operacional (invoker com coluna sem grant cai inteira)
    expect(codigo.indexOf("GRANT SELECT (largura_util_m")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE VIEW public.materiais_operacional"));
    expect(codigo).toContain("CREATE OR REPLACE VIEW public.materiais_operacional WITH (security_invoker = true) AS");
    expect(codigo).toContain(
      "CREATE OR REPLACE VIEW public.materiais_financeiro WITH (security_invoker = false, security_barrier = true) AS",
    );
    expect(codigo).toContain("WHERE is_staff(auth.uid()) AND can_see_financials(auth.uid());");
    // nenhuma visão de materiais recriada sem o WITH
    expect(codigo).not.toMatch(/CREATE OR REPLACE VIEW public\.materiais_\w+ AS/);
    // a conferência final cobra as opções e a permissão
    expect(codigo).toContain("'security_invoker=true' = ANY(reloptions)");
    expect(codigo).toContain("'security_barrier=true' = ANY(reloptions)");
    expect(codigo).toContain("has_column_privilege('authenticated', 'public.materiais', 'largura_util_m', 'SELECT')");
  });

  it("as colunas antigas das visões continuam na mesma ordem, com as novas no fim", () => {
    const op = codigo.slice(codigo.indexOf("CREATE OR REPLACE VIEW public.materiais_operacional"), codigo.indexOf("FROM materiais;"));
    const colunas = [...op.matchAll(/^\s+(\w+),?$/gm)].map((m) => m[1]);
    expect(colunas).toEqual([
      "nome", "unidade", "estoque", "created_at", "estoque_minimo", "localizacao", "status", "largura_bobina_m",
      "comprimento_bobina_m", "caracteristicas", "formato", "largura_chapa_m", "comprimento_chapa_m", "espessura_mm",
      "largura_util_m", "comprimento_util_m",
    ]);
  });

  it("o custo por m² é a chapa ÷ 2,00 m²", () => {
    for (const [nome, custo, chapa] of [
      ["ACRILICO CRISTAL VIRGEM 2MM", "158.00", 316.0],
      ["ACRILICO CRISTAL VIRGEM 3MM", "180.00", 360.0],
      ["ACRILICO BRANCO VIRGEM 3MM", "200.00", 400.0],
      ["ACRILICO CRISTAL VIRGEM 6MM", "400.76", 801.51],
      ["ACRILICO CRISTAL VIRGEM 10MM", "641.25", 1282.49],
    ] as const) {
      expect(codigo, nome).toContain(`('${nome}', ${custo})`);
      expect(Math.round((chapa / 2) * 100) / 100, nome).toBe(Number(custo));
    }
    expect(codigo).toContain("SET largura_util_m = 1.000, comprimento_util_m = 2.000");
  });

  it("as compras de 04/11 passam a render 2,000 m², no item, no lote e na entrada", () => {
    expect(codigo).toContain("SET rende_do_material = 2.000");
    expect(codigo).toMatch(/UPDATE public\.material_lotes\s+SET quantidade = 2\.00/);
    expect(codigo).toMatch(/UPDATE public\.movimentacoes_estoque mv\s+SET quantidade = 2\.00/);
    expect(codigo).toContain("WHEN 'E-261104-NF860' THEN 180.00 ELSE 200.00");
  });

  it("os lotes de abertura de 3 mm saem de R$ 400,00", () => {
    expect(codigo).toContain("l.codigo = 'ABERTURA' AND l.custo_unitario_snapshot = 400");
    expect(codigo).toContain("('ACRILICO PRETO VIRGEM 3MM', 194.50)");
  });

  it("a NF-e 859 entra como as de 04/11: R$ 389,00, PIX, rende 2,000 m², lote e entrada a R$ 194,50", () => {
    expect(codigo).toContain("'NF-e 859', 'venda'");
    expect(codigo).toContain("'Pix', 'À vista', true, 389.00, 0, 389.00");
    expect(codigo).toContain("'014896', 'ACRILICO CAST PRETO 3MM 1030 X 2030 - TERZIAN', 'CH', 1, 389.00, 0, 389.00, 389.00");
    expect(codigo).toContain("'E-261104-NF859', 2.00, 0, 'm²', 194.50, 389.00");
    expect(codigo).toContain("'entrada', 2.00, 'm²', 194.50, v_lote, 'entrada_manual'");
    expect(codigo).toContain("'2026-11-04 10:21:40-03'");
    expect(codigo).toContain("'custo_pela_area_util'");
    expect(Math.round((389 / 2) * 100) / 100).toBe(194.5);
  });

  it("não cria função nova, não mexe em preço de venda e confere o resultado antes do COMMIT", () => {
    expect(codigo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
    expect(codigo).not.toMatch(/preco_base|produto_precos/);
    expect(codigo.indexOf("DO $final$")).toBeLessThan(codigo.indexOf("COMMIT;"));
    expect(codigo).toContain("('ACRILICO PRETO VIRGEM 3MM', 194.50, 4.00)");
  });
});
