import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migração 20261113120000: palavras com intenção (cliente final e parceiro), lida como texto.
 * Trava o contrato: CHECK com dois tipos, assinatura nova sem sobrecarga, prioridade da classificação,
 * ACL, seed do dono e o aviso do grupo intocado.
 */
const PASTA = join(__dirname, "..", "supabase/migrations");
const BRUTO = readFileSync(join(PASTA, "20261113120000_palavras_de_origem_com_intencao.sql"), "utf8");
const SQL = BRUTO.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

function corpoDa(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, nome).toBeGreaterThanOrEqual(0);
  return SQL.slice(inicio, SQL.indexOf("$function$;", inicio));
}

describe("palavras com intenção: migração", () => {
  it("é transacional e termina com a conferência", () => {
    expect(SQL).toMatch(/^\s*BEGIN;/m);
    expect(SQL.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(SQL).toContain("DO $conferencia$");
    expect(SQL.match(/RAISE EXCEPTION/g)!.length).toBeGreaterThanOrEqual(8);
  });

  it("nunca fala em revendedor e não manda mensagem a ninguém", () => {
    expect(SQL).not.toMatch(/revendedor/i);
    expect(SQL).not.toMatch(/notificacoes_fila|whatsapp_responder|net\.http/i);
  });

  it("o CHECK da palavra aceita só cliente_final e parceiro", () => {
    expect(SQL).toContain("DROP CONSTRAINT IF EXISTS palavras_de_origem_tipo_check");
    expect(SQL).toContain("CHECK (tipo IN ('cliente_final', 'parceiro'))");
  });

  it("apaga a assinatura antiga antes de criar a nova, sem sobrecarga", () => {
    const iDrop = SQL.indexOf("DROP FUNCTION IF EXISTS public.origem_salvar_palavra(text, boolean);");
    const iNova = SQL.indexOf("CREATE OR REPLACE FUNCTION public.origem_salvar_palavra(p_palavra text, p_ativo boolean, p_tipo text DEFAULT NULL)");
    expect(iDrop).toBeGreaterThanOrEqual(0);
    expect(iNova).toBeGreaterThan(iDrop);
    expect(SQL).toContain("origem_salvar_palavra tem % versões, deveria ter 1");
  });

  it("origem_salvar_palavra: definer, search_path, permissão, valida o tipo e devolve tipo_antes", () => {
    const c = corpoDa("origem_salvar_palavra");
    expect(c).toContain("SECURITY DEFINER");
    expect(c).toContain("SET search_path TO 'public'");
    expect(c).toContain("require_permission('configuracoes.manage')");
    expect(c).toContain("NOT IN ('cliente_final', 'parceiro')");
    expect(c).toContain("< 4");
    expect(c).toContain("tipo = v_tipo");
    expect(c).toContain("coalesce(p_tipo, v_tipo_antes, 'parceiro')");
    expect(c).toContain("'tipo_antes', v_tipo_antes");
  });

  it("ACL: nada para anon nem PUBLIC; tela executa a salvar, só o servidor executa a classificação", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.origem_salvar_palavra(text, boolean, text) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.origem_salvar_palavra(text, boolean, text) TO authenticated, service_role;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public._wa_classificar_contato(text, text, uuid, uuid) TO service_role;");
    expect(SQL).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\b(anon|PUBLIC)\b/);
  });

  it("classificação: manual, anúncio, palavra de parceiro, telefone, palavra de cliente final, nessa ordem", () => {
    const c = corpoDa("_wa_classificar_contato");
    const ramos = [...c.matchAll(/v_tipo := ([^;]+);\s*v_origem := ([^;]+);/g)].map((m) => `${m[1].trim()}|${m[2].trim()}`);
    expect(ramos).toEqual([
      "v_lead_tipo|'manual'",
      "v_tipo_anuncio|'anuncio'",
      "'parceiro'|'palavra'",
      "'parceiro'|'telefone'",
      "'cliente_final'|'palavra'",
    ]);
    expect(c).toContain("w.tipo = 'parceiro' AND position(' ' || w.palavra IN ' ' || v_texto) > 0");
    expect(c).toContain("w.tipo = 'cliente_final' AND position(' ' || w.palavra IN ' ' || v_texto) > 0");
    expect(c.indexOf("w.tipo = 'cliente_final'")).toBeGreaterThan(c.indexOf("normalize_whatsapp_phone"));
    expect(c).toContain("STABLE SECURITY DEFINER");
    expect(c).toContain("SET search_path TO 'public'");
  });

  it("semeia as quatro palavras do dono, normalizadas, sem sobrescrever", () => {
    const i = SQL.indexOf("INSERT INTO public.palavras_de_origem");
    const bloco = SQL.slice(i, SQL.indexOf("ON CONFLICT (palavra) DO UPDATE SET tipo = EXCLUDED.tipo, ativo = true", i));
    const lista = [...bloco.matchAll(/\('([^']+)', 'cliente_final', true\)/g)].map((m) => m[1]);
    expect(lista).toEqual(["quero comprar agora", "quero fazer um orcamento", "quero saber mais", "gostei do outro"]);
    for (const p of lista) expect(p).toBe(p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  });

  it("não recria o aviso do grupo nem toca em parceiros, preço ou clientes", () => {
    expect(SQL).not.toMatch(/FUNCTION public\.tg_atendimento_avisa_grupo/);
    expect(SQL).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE)\s+public\.(parceiros|orcamentos|clientes|leads)\b/i);
  });

  it("o aviso já trata cliente_final como tabela cheia (contrato que justifica não mexer nele)", () => {
    const velha = readFileSync(join(PASTA, "20261113100000_origem_do_contato_e_aviso_novo.sql"), "utf8");
    expect(velha).toContain("WHEN NEW.tipo_contato = 'cliente_final' THEN 'cliente final, tabela cheia'");
  });
});
