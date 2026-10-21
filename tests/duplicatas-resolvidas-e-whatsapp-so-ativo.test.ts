import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Cadastros repetidos resolvidos e o WhatsApp ligando só a cliente ATIVO
 * (21/10/2026, decisão do dono). Aplicado depois de ensaio com rollback: uma
 * mensagem simulada da YRLEN ligou ao cadastro que ficou (8a82c1a7) e a da
 * Cibele ao dela (28a00daf), sem criar lead e sem enfileirar aviso; restaram 0
 * grupos repetidos de cliente ativo.
 */

const SQL = readFileSync("supabase/migrations/20261021090000_duplicatas_resolvidas_e_whatsapp_so_cliente_ativo.sql", "utf8");

describe("o WhatsApp conta só cliente ativo", () => {
  it("as três portas (telefone, whatsapp_principal, contato) filtram o ativo", () => {
    expect(SQL).toContain("WHERE telefone_normalizado = v_tel AND ativo IS NOT FALSE");
    expect(SQL).toContain("normalize_whatsapp_phone(whatsapp_principal) = v_tel AND ativo IS NOT FALSE");
    expect(SQL).toContain("JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE");
  });

  it("se só houver inativo, ele ainda é o cliente (quem volta a escrever continua conhecido)", () => {
    expect(SQL).toContain("IF v_clientes IS NULL THEN");
  });

  it("a edição é ancorada no corpo vivo: âncora fora do esperado para a migração", () => {
    expect(SQL).toContain("IF n <> 1 THEN");
    expect(SQL).toContain("IF n <> 2 THEN");
    expect(SQL).toContain("'ORDER BY ativo IS NOT FALSE DESC, created_at LIMIT 1'");
  });
});

describe("os cadastros repetidos", () => {
  it("inativa, nunca apaga", () => {
    expect(SQL).not.toMatch(/\bDELETE\b/i);
    expect(SQL.match(/UPDATE public\.clientes SET ativo = false/g)).toHaveLength(2);
  });

  it("YRLEN: as quatro de 20/10 saem; a de 19/10 fica", () => {
    for (const id of ["61b42546", "74a99cef", "5ee82f0b", "c9cbf70e"]) expect(SQL).toContain(id);
    const inativacao = SQL.slice(SQL.indexOf("-- 3. YRLEN"), SQL.indexOf("-- 4. Cibele"));
    expect(inativacao).not.toContain("8a82c1a7");
  });

  it("Cibele: o orçamento e o orçamento 3D da repetida vão para a mais antiga ANTES de inativar", () => {
    const bloco = SQL.slice(SQL.indexOf("-- 4. Cibele"), SQL.indexOf("-- 5. Acrílico"));
    const move = bloco.indexOf("UPDATE public.orcamentos_3d SET cliente_id = '28a00daf");
    const inativa = bloco.indexOf("UPDATE public.clientes SET ativo = false");
    expect(bloco).toContain("UPDATE public.orcamentos SET cliente_id = '28a00daf");
    expect(move).toBeGreaterThan(0);
    expect(inativa).toBeGreaterThan(move);
  });
});

describe("o acrílico virgem 3 mm", () => {
  it("chapa cristal virgem 3 mm, 1 m² por m², sem duplicar a ficha se rodar de novo", () => {
    expect(SQL).toContain("material_principal_id = 'd4f62f64-1647-49a6-9827-30ca6547ab6c'");
    expect(SQL).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = '328251b9");
  });
});
