import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Histórico de versões do orçamento, só leitura (17/11/2026): contrato da migração lido como TEXTO. O SQL de verdade
 * foi provado no banco vivo, numa transação desfeita (docs/ensaio-orcamento-historico-de-versoes.md).
 */
const NOME = "20261117130000_orcamento_historico_de_versoes.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-orcamento-historico-de-versoes.md");
const ASSINATURA = "orcamento_historico_de_versoes(p_orcamento uuid)";
const corpo = corpoDa(sql, ASSINATURA);
const cab = cabecalhoDa(sql, ASSINATURA);

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, ENSAIADA e APLICADA, transação única", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117130000_"))).toEqual([NOME]);
    expect(sql).toMatch(/ENSAIADA no banco vivo em 17\/11\/2026/);
    expect(sql).toMatch(/APLICADA no banco vivo/);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("só leitura: nenhuma escrita, nenhuma função viva trocada, nenhuma tabela tocada", () => {
    expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(codigo).not.toMatch(/ALTER TABLE|CREATE TRIGGER|CREATE POLICY|DROP /i);
    expect(corpo).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/);
  });
});

describe("orcamento_historico_de_versoes", () => {
  it("é STABLE SECURITY DEFINER com search_path fixo e o corpo é o que foi ensaiado", () => {
    expect(cab).toContain("RETURNS jsonb");
    expect(cab).toContain("STABLE");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
    expect(md5(corpo)).toBe("676b8c35c23fc2cdff16aac6465d83fb");
    expect(doc).toContain("676b8c35c23fc2cdff16aac6465d83fb");
  });

  it("lê quem vê preço e devolve lista vazia para quem não vê, sem sessão ou sem id", () => {
    expect(corpo).toContain("v_uid IS NULL OR p_orcamento IS NULL OR NOT public.can_see_prices(v_uid)");
    expect(corpo).toContain("RETURN '[]'::jsonb;");
    expect(corpo.indexOf("can_see_prices")).toBeLessThan(corpo.indexOf("orcamento_versoes v"));
  });

  it("devolve só os campos da tela, nunca o retrato inteiro, o PDF nem o destinatário", () => {
    const chaves = [...corpo.matchAll(/^\s+'([a-z_]+)', /gm)].map((m) => m[1]);
    expect(chaves).toEqual([
      "id", "numero", "status", "criada_em", "enviada_em", "aprovada_em", "autor", "valor_total",
      "qtd_itens", "retroativa", "e_a_aprovada", "o_que_mudou", "valor_anterior",
    ]);
    expect(corpo).not.toMatch(/pdf_url|destinatario|canal|'snapshot'/);
  });

  it("ordena da mais nova para a mais velha e compara cada versão com a anterior", () => {
    expect(corpo).toContain("jsonb_agg(x.j ORDER BY x.n DESC)");
    expect(corpo).toContain("WINDOW w AS (ORDER BY v.numero_versao)");
    expect(corpo).toContain("public.orcamento_retrato_diferencas(lag(v.snapshot) OVER w, v.snapshot)");
  });

  it("anon fora (REVOKE explícito de PUBLIC e anon), authenticated e service_role dentro", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.orcamento_historico_de_versoes(uuid) FROM PUBLIC, anon;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.orcamento_historico_de_versoes(uuid) TO authenticated, service_role;");
    expect(codigo).not.toMatch(/GRANT EXECUTE[^;]*\b(anon|PUBLIC)\b/);
  });
});

describe("documento do ensaio", () => {
  it("traz os resultados literais", () => {
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain("admin, orcamento 159: 3 versoes; numeros em ordem=3,2,1");
    expect(doc).toContain("sem papel em 159: 0 versoes");
    expect(doc).toContain("anon: 42501");
    expect(doc).toContain("versoes antes/depois=94/94");
  });
});
