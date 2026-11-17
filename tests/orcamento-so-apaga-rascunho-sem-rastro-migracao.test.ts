import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Orçamento só é apagado se for rascunho sem rastro (17/11/2026): contrato da migração lido como TEXTO. O SQL de
 * verdade foi provado no banco vivo, numa transação desfeita (docs/ensaio-orcamento-so-apaga-rascunho-sem-rastro.md).
 */
const NOME = "20261117120000_orcamento_so_apaga_rascunho_sem_rastro.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-orcamento-so-apaga-rascunho-sem-rastro.md");
const ASSINATURA = "tg_orcamento_so_apaga_rascunho_sem_rastro()";
const corpo = corpoDa(sql, ASSINATURA);
const cab = cabecalhoDa(sql, ASSINATURA);

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, ENSAIADA e APLICADA, transação única", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117120000_"))).toEqual([NOME]);
    expect(sql).toMatch(/ENSAIADA no banco vivo em 17\/11\/2026/);
    expect(sql).toMatch(/APLICADA no banco vivo/);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("não escreve em dado, não troca função viva e NÃO mexe em TRUNCATE nem em DELETE de anon", () => {
    expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i);
    expect(codigo).not.toMatch(/REVOKE\s+(TRUNCATE|DELETE)/i);
    expect(codigo).not.toMatch(/GRANT\s+(TRUNCATE|DELETE)/i);
    expect(codigo).not.toMatch(/ALTER TABLE|DROP /i);
  });
});

describe("tg_orcamento_so_apaga_rascunho_sem_rastro", () => {
  it("é SECURITY DEFINER com search_path fixo e o corpo é o que foi ensaiado", () => {
    expect(cab).toContain("RETURNS trigger");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
    expect(md5(corpo)).toBe("2cab53763268a9fa8a82ae15b4113f04");
    expect(doc).toContain("2cab53763268a9fa8a82ae15b4113f04");
  });

  it("só deixa apagar rascunho: o primeiro teste é o status", () => {
    expect(corpo.trimStart().startsWith("DECLARE v_motivo text;\nBEGIN\n  IF OLD.status::text <> 'rascunho' THEN")).toBe(true);
  });

  it("olha os rastros: envio, versão, link aberto, aprovação, OS, comprovante, cobrança, parceiro, WhatsApp, portal, 3D, RIP e PDF", () => {
    for (const pedaco of [
      "OLD.enviado_em IS NOT NULL",
      "public.orcamento_versoes v WHERE v.orcamento_id = OLD.id",
      "public.documentos_enviados d WHERE d.tipo = 'orcamento' AND d.referencia_id = OLD.id",
      "OLD.visualizado_em IS NOT NULL OR coalesce(OLD.visualizacoes, 0) > 0",
      "OLD.aprovado_em IS NOT NULL OR OLD.versao_aprovada_id IS NOT NULL",
      "public.aprovacoes a WHERE a.orcamento_id = OLD.id",
      "OLD.os_id IS NOT NULL",
      "public.ordens_servico o WHERE o.orcamento_id = OLD.id",
      "public.orcamento_comprovantes c WHERE c.orcamento_id = OLD.id",
      "public.contas_receber r WHERE r.orcamento_id = OLD.id",
      "public.whatsapp_cobrancas w WHERE w.orcamento_id = OLD.id",
      "public.parceiro_orcamentos p WHERE p.pedido_orcamento_id = OLD.id",
      "public.portal_cliente_solicitacoes s WHERE s.orcamento_id = OLD.id",
      "public.orcamentos_3d d3 WHERE d3.orcamento_id = OLD.id",
      "public.rip_job_vinculos j WHERE j.orcamento_id = OLD.id",
      "public.documentos_gerados g WHERE g.tipo = 'orcamento' AND g.referencia_id = OLD.id",
    ]) {
      expect(corpo, pedaco).toContain(pedaco);
    }
  });

  it("falha com 23001 e texto neutro que manda falar com o gestor, sem citar Recusado nem Expirado", () => {
    expect(corpo).toContain("USING ERRCODE = '23001'");
    expect(corpo).toContain("Fale com o gestor.");
    expect(corpo).not.toMatch(/Recusado|Expirado|Cancelar/);
    const msgs = [...corpo.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter((m) => /[a-z]{4,} [a-z]{3,}/.test(m) && !m.startsWith("ele") && !m.startsWith("o cliente"));
    for (const m of msgs.filter((x) => x.startsWith("Este orçamento"))) expect(m).not.toMatch(/[()—–→]/);
  });

  it("devolve OLD quando não há motivo, para a exclusão seguir", () => {
    expect(corpo).toContain("RETURN OLD;");
  });
});

describe("gatilho e fechamento", () => {
  it("BEFORE DELETE FOR EACH ROW em orcamentos, e a função de gatilho fechada para PUBLIC, anon e authenticated", () => {
    expect(codigo).toMatch(/CREATE TRIGGER tg_orcamento_so_apaga_rascunho_sem_rastro\s+BEFORE DELETE ON public\.orcamentos\s+FOR EACH ROW EXECUTE FUNCTION public\.tg_orcamento_so_apaga_rascunho_sem_rastro\(\);/);
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_so_apaga_rascunho_sem_rastro() FROM PUBLIC, anon, authenticated;");
    expect(codigo).not.toMatch(/GRANT EXECUTE/);
  });

  it("confere no fim que o gatilho está ligado e que anon e authenticated não executam a função", () => {
    const v = codigo.slice(codigo.lastIndexOf("DO $v$"));
    expect(v).toContain("tgenabled = 'O'");
    expect(v).toContain("has_function_privilege('anon'");
    expect(v).toContain("has_function_privilege('authenticated'");
  });
});

describe("documento do ensaio", () => {
  it("traz os resultados literais", () => {
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain("apagaria 24 e bloquearia 103");
    expect(doc).toContain("{165,166,169,170,172,173,181,182,183,185,186,188,189,190,194,199,207,214,219,225,230,232,252,253}");
    expect(doc).toContain("vendedor: rascunho livre 183 -> linhas apagadas=0");
    expect(doc).toContain("23001");
  });
});
