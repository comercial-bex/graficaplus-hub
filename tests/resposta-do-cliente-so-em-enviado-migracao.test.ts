import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Resposta do cliente pelo link só em orçamento enviado e dentro da validade (17/11/2026): contrato da migração
 * lido como TEXTO. O SQL de verdade foi provado no banco vivo, numa transação desfeita
 * (docs/ensaio-resposta-do-cliente-so-em-enviado.md). O md5 do corpo abaixo é o que o ensaio imprimiu no banco.
 */
const NOME = "20261117110000_resposta_do_cliente_so_em_enviado.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-resposta-do-cliente-so-em-enviado.md");
const ASSINATURA = "responder_orcamento_publico(";
const corpo = corpoDa(sql, ASSINATURA);
const cab = cabecalhoDa(sql, ASSINATURA);

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, ENSAIADA e APLICADA", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117110000_"))).toEqual([NOME]);
    expect(sql).toMatch(/ENSAIADA no banco vivo em 17\/11\/2026/);
    expect(sql).toMatch(/APLICADA no banco vivo/);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("função nova: não troca função viva, não toca tabela, view nem policy", () => {
    expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/ALTER TABLE|CREATE\s+(OR REPLACE\s+)?VIEW|CREATE POLICY|CREATE TRIGGER|DROP /i);
    expect(codigo).not.toMatch(/INSERT\s+INTO|DELETE\s+FROM|TRUNCATE/i);
  });
});

describe("ordem de aplicação e desfazer (achado da revisão)", () => {
  it("o cabeçalho manda aplicar antes do Publish e não promete plano B no front", () => {
    expect(sql).toMatch(/ORDEM OBRIGATÓRIA: aplicar esta migração ANTES do Publish/);
    expect(sql).toMatch(/NÃO basta o DROP/);
    expect(sql).not.toMatch(/o front tolera a função ausente/);
  });
});

describe("responder_orcamento_publico", () => {
  it("assinatura, SECURITY DEFINER e search_path fixo", () => {
    expect(cab).toContain("(\n  p_token text, p_decisao text, p_nome text, p_observacao text, p_ip text)");
    expect(cab).toContain("RETURNS jsonb");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("o corpo é o que foi ensaiado no banco vivo", () => {
    expect(md5(corpo)).toBe("fd8cdb0b9085736f8d63e0965fa9c691");
    expect(doc).toContain("fd8cdb0b9085736f8d63e0965fa9c691");
  });

  it("trava a linha, só grava a partir de enviado e filtra o UPDATE pelo status", () => {
    expect(corpo).toContain("WHERE token_publico = p_token FOR UPDATE");
    expect(corpo.match(/AND status::text = 'enviado'/g)).toHaveLength(2);
    expect(corpo).toContain("v_orc.status::text <> 'enviado'");
  });

  it("a validade conta do envio, na falta dele da criação, e o último dia vale inteiro (horário de Brasília)", () => {
    expect(corpo).toContain("coalesce(v_orc.enviado_em, v_orc.created_at) AT TIME ZONE 'America/Sao_Paulo'");
    expect(corpo).toContain("v_hoje > v_ate");
    expect(corpo).not.toMatch(/v_hoje >= v_ate/);
  });

  it("devolve os nove códigos e nunca lança erro por causa do estado do orçamento", () => {
    const codigos = [...corpo.matchAll(/'codigo', '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(codigos)].sort()).toEqual(
      ["dados_invalidos", "decisao_invalida", "encerrado", "ja_aprovado", "ja_virou_pedido", "nao_encontrado", "nao_liberado", "ok", "vencido"].sort(),
    );
    expect(corpo).not.toMatch(/RAISE EXCEPTION/);
  });

  it("aprovar grava aprovado_em, nome e IP; ajuste grava recusado (rejeitado no enum)", () => {
    expect(corpo).toContain("SET status = 'aprovado', aprovado_em = now(), aprovado_por_nome = btrim(p_nome)");
    expect(corpo).toContain("aprovado_ip = p_ip");
    expect(corpo).toContain("UPDATE public.orcamentos SET status = 'rejeitado'");
  });

  it("só service_role executa: REVOKE de PUBLIC, anon e authenticated antes do GRANT", () => {
    const rev = "REVOKE ALL ON FUNCTION public.responder_orcamento_publico(text, text, text, text, text) FROM PUBLIC, anon, authenticated;";
    const gr = "GRANT EXECUTE ON FUNCTION public.responder_orcamento_publico(text, text, text, text, text) TO service_role;";
    expect(codigo).toContain(rev);
    expect(codigo).toContain(gr);
    expect(codigo.indexOf(rev)).toBeLessThan(codigo.indexOf(gr));
    expect(codigo).not.toMatch(/GRANT EXECUTE[^;]*\b(anon|authenticated|PUBLIC)\b/);
    expect(codigo).toContain("has_function_privilege('anon'");
  });
});

describe("documento do ensaio", () => {
  it("traz os resultados literais", () => {
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain('"codigo": "vencido"');
    expect(doc).toContain('"codigo": "ja_aprovado"');
    expect(doc).toContain('"codigo": "ja_virou_pedido"');
    expect(doc).toContain('"codigo": "nao_liberado"');
    expect(doc).toContain("rejeitados=10 (era 9) aprovados=33 (era 31)");
  });
});
