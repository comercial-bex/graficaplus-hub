import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, semComentarios } from "./apoio/corpo-da-funcao";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Trava de transição de status do orçamento (17/11/2026): contrato da migração lido como TEXTO. */
const NOME = "20261117230000_orcamento_transicao_de_status.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-orcamento-transicao-de-status.md");
const gatilho = corpoDa(sql, "tg_orcamento_transicao_de_status(");
const sync = corpoDa(sql, "sync_orcamento_3d_para_funil(");

describe("arquivo e escopo", () => {
  it("prefixo único, depois da 214000, transação única, sem UPDATE solto", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117230000_"))).toEqual([NOME]);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    const fora = codigo.replace(/AS \$function\$[\s\S]*?\$function\$/g, "").replace(/AS \$f\$[\s\S]*?\$f\$/g, "");
    expect(fora).not.toMatch(/\b(UPDATE\s+(?!OF\b)|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE|ALTER TYPE)/i);
    expect(sql).toMatch(/COMO DESFAZER/);
    expect(sql).toMatch(/POR QUE/);
  });
});

describe("tabela de transições", () => {
  const tabela = (/IN \(([\s\S]*?)\)\s*;/.exec(codigo)?.[1] ?? "").match(/\('[a-z]+',\s*'[a-z]+'\)/g) ?? [];
  it("exatamente as seis legítimas, mais igual a si mesmo", () => {
    expect(tabela.map((t) => t.replace(/\s+/g, ""))).toEqual([
      "('rascunho','enviado')",
      "('enviado','aprovado')",
      "('enviado','rejeitado')",
      "('enviado','expirado')",
      "('expirado','enviado')",
      "('aprovado','convertido')",
    ]);
    expect(codigo).toContain("p_de IS NOT DISTINCT FROM p_para");
  });
  it("nada sai de rejeitado nem de convertido, e nada volta a rascunho", () => {
    expect(tabela.some((t) => /^\('(rejeitado|convertido)'/.test(t))).toBe(false);
    expect(tabela.some((t) => /,'rascunho'\)/.test(t.replace(/\s+/g, "")))).toBe(false);
  });
});

describe("gatilho", () => {
  it("BEFORE UPDATE OF status em orcamentos, erro com ERRCODE próprio e DETAIL", () => {
    expect(codigo).toMatch(/CREATE TRIGGER tg_orcamento_transicao_de_status\s+BEFORE UPDATE OF status ON public\.orcamentos\s+FOR EACH ROW/);
    expect(gatilho).toContain("USING ERRCODE = 'OR001'");
    expect(gatilho).toContain("DETAIL = 'transicao_invalida'");
    expect(gatilho).toContain("RETURN NEW;");
    expect(gatilho).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
  it("SECURITY DEFINER com search_path fixo e acesso fechado", () => {
    const cab = cabecalhoDa(sql, "tg_orcamento_transicao_de_status(");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_transicao_de_status() FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.orcamento_transicao_permitida(text, text) FROM PUBLIC, anon, authenticated;");
    expect(codigo).toMatch(/GRANT EXECUTE ON FUNCTION public\.tg_orcamento_transicao_de_status\(\) TO service_role;/);
  });
  it("texto do erro sem travessão, seta nem parênteses", () => {
    const msg = /RAISE EXCEPTION '([^']*)'/.exec(gatilho)?.[1] ?? "";
    const hint = /HINT = '([^']*)'/.exec(gatilho)?.[1] ?? "";
    for (const t of [msg, hint]) expect(t).not.toMatch(/[—–→()]|->/);
  });
});

describe("sync_orcamento_3d_para_funil", () => {
  it("troca guardada pelo md5 do corpo vivo e só a linha do status muda", () => {
    expect(codigo).toContain("'45167125eda9df1a95c9ab0cefa8e28a'");
    expect(codigo.indexOf("45167125eda9df1a95c9ab0cefa8e28a")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION public.sync_orcamento_3d_para_funil"));
    expect(sync).toContain("status = CASE WHEN public.orcamento_transicao_permitida(status::text, v_status::text) THEN v_status ELSE status END,");
    expect(sync).not.toMatch(/^\s*status = v_status,/m);
    expect(sync).toContain("IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;");
    const cab = cabecalhoDa(sql, "sync_orcamento_3d_para_funil(");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });
});

describe("não mexe nos escritores legítimos", () => {
  it("nenhum deles é recriado aqui", () => {
    for (const f of ["aprovar_orcamento", "responder_orcamento_publico", "renovar_orcamento_vencido", "api_executar", "confirmar_envio_documento", "registrar_envio_documento"]) {
      expect(codigo).not.toContain(`CREATE OR REPLACE FUNCTION public.${f}`);
    }
  });
  it("o front só faz transições da tabela", () => {
    const raiz = join(__dirname, "..");
    const acoes = readFileSync(join(raiz, "src/components/orcamento/acoes-do-status.tsx"), "utf8");
    expect(acoes).toMatch(/update\(\{ status: novo \}\)[\s\S]{0,40}\.eq\("id", orc\.id\)[\s\S]{0,40}\.eq\("status", "enviado"\)/);
    expect(acoes).toContain('novo: "rejeitado" | "expirado"');
    const contingencia = readFileSync(join(raiz, "src/lib/api/documento-whatsapp.functions.ts"), "utf8");
    expect(contingencia).toContain('.update({ status: "enviado", enviado_em: orc.enviado_em ?? agora })');
    expect(contingencia).toMatch(/\.eq\("status", "rascunho"\)/);
  });
});

describe("doc do ensaio", () => {
  it("embute a migração, cobre as combinações e termina em RAISE EXCEPTION", () => {
    expect(doc).toContain("CREATE TRIGGER tg_orcamento_transicao_de_status");
    expect(doc).toContain("45167125eda9df1a95c9ab0cefa8e28a");
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain("RAISE EXCEPTION E'ENSAIO OK, DESFEITO");
    expect(doc).toContain("estados text[] := ARRAY['rascunho','enviado','aprovado','rejeitado','expirado','convertido']");
    for (const f of ["aprovar_orcamento", "responder_orcamento_publico", "renovar_orcamento_vencido", "api_executar", "confirmar_envio_documento", "registrar_envio_documento", "sync_orcamento_3d_para_funil"]) expect(doc).toContain(f);
  });
});
