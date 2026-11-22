import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 22/11/2026. A função que grava o troféu e a arte no orçamento (`salvar_trofeu_no_orcamento`) nasce fechada e
 * confere a permissão por dentro. Estes testes travam o SQL da migração 20261122400000: o fechamento (a regra de
 * segurança do projeto), a permissão, as recusas, o escopo da arte e o desfazer.
 */
const arquivo = "20261122400000_salvar_trofeu_no_orcamento.sql";
const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
const codigo = sql.replace(/--[^\n]*/g, "");
const ASSINATURA = "salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)";

describe("migração: gravar o troféu no orçamento", () => {
  it("o prefixo é único, é uma transação só e para se a função já existe", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("20261122400000"))).toEqual([arquivo]);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("salvar_trofeu_no_orcamento já existe: releia antes de recriar");
    expect(sql).toContain("aplique antes a migração 20261122200000");
  });

  it("a função nasce FECHADA: REVOKE ALL de PUBLIC, anon e authenticated, e só authenticated volta", () => {
    expect(codigo).toContain(`REVOKE ALL ON FUNCTION public.${ASSINATURA}\n  FROM PUBLIC, anon, authenticated;`);
    expect(codigo).toContain(`GRANT EXECUTE ON FUNCTION public.${ASSINATURA}\n  TO authenticated;`);
    // um GRANT só, e quem recebe é só `authenticated` (o `public.` do nome da função é o schema, não o papel)
    expect(codigo.match(/GRANT /g)).toHaveLength(1);
    const concedido = codigo.match(/GRANT[^;]*;/)![0].split(/\sTO\s/)[1].trim();
    expect(concedido).toBe("authenticated;");
  });

  it("e confere depois: anon e PUBLIC sem EXECUTE, authenticated com, SECURITY DEFINER e search_path fixo", () => {
    const final = codigo.slice(codigo.indexOf("DO $final$"));
    expect(final).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(final).toContain("a.grantee = 0 AND a.privilege_type = 'EXECUTE'");
    expect(final).toContain("has_function_privilege('authenticated', v_oid, 'EXECUTE')");
    expect(final).toContain("prosecdef");
    expect(final).toContain("search_path=public");
    expect(codigo.indexOf("DO $final$")).toBeLessThan(codigo.indexOf("COMMIT;"));
  });

  it("é SECURITY DEFINER com search_path fixo e confere orcamentos.create por auth.uid()", () => {
    expect(codigo).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(codigo).toContain("v_uid := public.require_permission('orcamentos.create');");
  });

  it("recusa orçamento que já virou OS, quantidade quebrada, troféu sem preço, modelo inexistente e item de outro orçamento", () => {
    for (const frase of [
      "Este orçamento já virou OS: os itens ficam como foram vendidos.",
      "A quantidade de troféus precisa ser um número inteiro, de 1 para cima.",
      "O troféu está sem preço: refaça a conta antes de salvar.",
      "Modelo de troféu não encontrado ou desativado.",
      "Este troféu não pertence a este orçamento.",
      "Uma linha de arte está sem valor.",
    ]) {
      expect(codigo, frase).toContain(frase);
    }
    expect(codigo).toContain("v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido'");
    expect(codigo).toContain("FOR UPDATE");
  });

  it("editar só alcança troféu DESTE orçamento e de origem 'trofeu'", () => {
    expect(codigo).toContain("WHERE id = p_item_id AND orcamento_id = p_orcamento_id AND origem_calculo = 'trofeu' FOR UPDATE");
  });

  it("a arte é trocada só nas linhas do próprio troféu, sem tocar em `gerado_por_item_id`", () => {
    expect(codigo).toContain("origem_calculo = 'trofeu_arte' AND parametros ->> 'trofeu_item_id' = v_item::text");
    expect(codigo).toContain("jsonb_build_object('trofeu_item_id', v_item)");
    // `gerado_por_item_id` é das respostas que cobram e apaga em cascata: o troféu não pode entrar nessa mecânica
    expect(codigo).not.toContain("gerado_por_item_id");
  });

  it("o item não tem produto: os gatilhos de custo e de preço por área deixam o valor como o servidor mandou", () => {
    const insercoes = codigo.match(/INSERT INTO public\.orcamento_itens \([^)]*\)/g) ?? [];
    expect(insercoes).toHaveLength(2);
    for (const i of insercoes) {
      expect(i).not.toContain("produto_id");
      expect(i).not.toContain("preco_m2");
      expect(i).not.toContain("largura");
      expect(i).not.toContain("altura");
    }
  });

  it("os rótulos do PDF: 'Troféu de acrílico' e 'Arte do troféu'", () => {
    expect(codigo).toContain("'Troféu de acrílico'");
    expect(codigo).toContain("'Arte do troféu'");
  });

  it("não mexe em tabela nenhuma além dos itens do orçamento", () => {
    expect(codigo).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO)\s+public\.(?!orcamento_itens\b)/i);
    expect(codigo).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/i);
  });

  it("traz o DESFAZER: só a função some, e como tirar também as linhas", () => {
    const desfazer = sql.slice(sql.indexOf("DESFAZER"));
    expect(desfazer).toContain(`DROP FUNCTION public.${ASSINATURA};`);
    expect(desfazer).toContain("origem_calculo IN ('trofeu', 'trofeu_arte')");
  });
});
