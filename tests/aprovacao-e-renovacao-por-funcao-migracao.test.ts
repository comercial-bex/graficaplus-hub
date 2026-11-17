import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Aprovar só de enviado e renovar por função (17/11/2026): contrato da migração lido como TEXTO. O SQL de verdade foi
 * provado no banco vivo, numa transação desfeita, com admin, gestor, vendedor, financeiro e conta sem papel
 * (docs/ensaio-aprovacao-e-renovacao-por-funcao.md).
 */
const NOME = "20261117190000_aprovacao_e_renovacao_por_funcao.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-aprovacao-e-renovacao-por-funcao.md");
const aprovar = corpoDa(sql, "aprovar_orcamento(");
const renovar = corpoDa(sql, "renovar_orcamento_vencido(");

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, depois da 180000, ENSAIADA e APLICADA, transação única", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117190000_"))).toEqual([NOME]);
    expect("20261117190000_" > "20261117180000_").toBe(true);
    expect(sql).toMatch(/ENSAIADA no banco vivo em 17\/11\/2026/);
    expect(sql).toMatch(/APLICADA no banco vivo/);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("exige que a 180000 já exista (a renovação chama orcamento_congelar_versao)", () => {
    expect(codigo).toContain("to_regprocedure('public.orcamento_congelar_versao(public.orcamentos, boolean, uuid)') IS NULL");
  });

  it("fica de fora: gatilho de transição, Cancelado, aviso ao cliente, api_executar e qualquer UPDATE ou DELETE solto", () => {
    expect(codigo).not.toMatch(/tg_orcamento_transicao_de_status|tg_orcamento_notificar_cliente|api_executar|cancelar_orcamento|cancelado/i);
    expect(codigo).not.toMatch(/CREATE TRIGGER|ALTER TYPE|ALTER TABLE|DROP |TRUNCATE/i);
    const fora = codigo.replace(/AS \$function\$[\s\S]*?\$function\$/g, "").replace(/AS \$f\$[\s\S]*?\$f\$/g, "");
    expect(fora).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i);
  });
});

describe("os dois corpos são os que foram ensaiados no banco vivo", () => {
  it("md5 de cada corpo", () => {
    expect(md5(aprovar)).toBe("c41a77749e1673be56e5ddff732b6ad4");
    expect(md5(renovar)).toBe("57e68e8f3ad1d5f922b88b4b82d2f827");
    expect(doc).toContain("c41a77749e1673be56e5ddff732b6ad4");
    expect(doc).toContain("57e68e8f3ad1d5f922b88b4b82d2f827");
  });
});

describe("aprovar_orcamento: guarda de origem", () => {
  const cab = cabecalhoDa(sql, "aprovar_orcamento(");
  it("troca guardada pelo md5 do corpo vivo e mesma assinatura e atributos", () => {
    expect(codigo).toContain("'c0d686195881973ba42b2e93708ee71a'");
    expect(codigo.indexOf("c0d686195881973ba42b2e93708ee71a")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION public.aprovar_orcamento"));
    expect(cab).toContain("(p_orcamento_id uuid, p_versao_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("só de enviado: aprovado devolve o que existe, com OS ou convertido dá tem_os, o resto dá origem_invalida", () => {
    expect(aprovar).toContain("IF v_orc.status::text = 'aprovado' THEN\n    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'versao_id', v_orc.versao_aprovada_id, 'ja_aprovado', true);");
    expect(aprovar).toContain("USING DETAIL = 'tem_os'");
    expect(aprovar).toContain("IF v_orc.status::text <> 'enviado' THEN");
    expect(aprovar).toContain("USING DETAIL = 'origem_invalida'");
    expect(aprovar).not.toMatch(/'rascunho'/); // rascunho NÃO é origem: o botão só aparece com o orçamento enviado
  });

  it("a guarda vem antes de qualquer escrita e a permissão antes da guarda", () => {
    expect(aprovar.indexOf("require_permission('orcamentos.approve')")).toBeLessThan(aprovar.indexOf("Guarda de origem"));
    expect(aprovar.indexOf("origem_invalida")).toBeLessThan(aprovar.indexOf("INSERT INTO public.orcamento_versoes"));
    expect(aprovar.indexOf("origem_invalida")).toBeLessThan(aprovar.indexOf("UPDATE public.orcamento_versoes"));
    expect(aprovar.indexOf("origem_invalida")).toBeLessThan(aprovar.indexOf("UPDATE public.orcamentos"));
    expect(aprovar.indexOf("origem_invalida")).toBeLessThan(aprovar.indexOf("INSERT INTO public.eventos_negocio"));
  });

  it("o único chamador da tela só aparece com o orçamento enviado (a escolha de origem está documentada)", () => {
    const tela = lerTela("src/components/orcamento/tela/CabecalhoIdentificacao.tsx");
    expect(tela).toMatch(/!fechado && orc\.status === "enviado" && podeConverter && hasPermission\("orcamentos\.approve"\)/);
    expect(tela).toContain("Cliente aprovou: converter em OS");
    expect(sql).toMatch(/DECISÃO DE ORIGEM: SÓ de enviado/);
  });

  it("assinatura e GRANT não mudam: authenticated e service_role, anon fora", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.aprovar_orcamento(uuid, uuid, text) FROM PUBLIC, anon;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(uuid, uuid, text) TO authenticated, service_role;");
  });
});

describe("renovar_orcamento_vencido", () => {
  const cab = cabecalhoDa(sql, "renovar_orcamento_vencido(");
  it("assinatura, SECURITY DEFINER e search_path fixo", () => {
    expect(cab).toContain("(p_orcamento_id uuid)");
    expect(cab).toContain("RETURNS jsonb");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("exige orcamentos.create e orcamentos.send antes de ler o orçamento", () => {
    expect(renovar.indexOf("require_permission('orcamentos.create')")).toBeLessThan(renovar.indexOf("FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE"));
    expect(renovar.indexOf("require_permission('orcamentos.send')")).toBeLessThan(renovar.indexOf("FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE"));
  });

  it("origem: expirado ou enviado vencido, sem OS e com valor; todos os erros levam um código no DETAIL", () => {
    expect(renovar).toContain("IF v_anterior NOT IN ('expirado', 'enviado') THEN");
    expect(renovar).toContain("IF v_orc.os_id IS NOT NULL OR v_anterior = 'convertido' THEN");
    expect(renovar).toContain("IF v_anterior = 'enviado' AND NOT v_vencido THEN");
    expect(renovar).toContain("IF NOT (coalesce(v_orc.valor_total, 0) > 0) THEN");
    const codigos = [...renovar.matchAll(/USING DETAIL = '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codigos).toEqual(["nao_encontrado", "tem_os", "origem_invalida", "ainda_valido", "nunca_enviado", "sem_valor"]);
    expect(renovar.match(/RAISE EXCEPTION/g)).toHaveLength(6);
  });

  it("vencido é a régua do link do cliente: dia de Brasília, último dia inteiro (achado da revisão)", () => {
    expect(renovar).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(renovar).toContain("(coalesce(v_orc.enviado_em, v_orc.created_at) AT TIME ZONE 'America/Sao_Paulo')::date + v_orc.validade_dias");
    expect(renovar).not.toContain("make_interval");
    expect(renovar).toContain("coalesce(v_orc.validade_dias, 0) > 0");
  });

  it("expirado que nunca foi enviado não renova: sem enviado_em e sem documento enviado (achado da revisão)", () => {
    expect(renovar).toContain("IF v_anterior = 'expirado' AND v_orc.enviado_em IS NULL");
    expect(renovar).toContain("FROM public.documentos_enviados d WHERE d.tipo = 'orcamento' AND d.referencia_id = p_orcamento_id");
    expect(renovar.indexOf("'nunca_enviado'")).toBeLessThan(renovar.indexOf("'sem_valor'"));
  });

  it("grava enviado_em agora, congela a versão depois de gravar e registra o evento", () => {
    const upd = renovar.indexOf("UPDATE public.orcamentos SET status = 'enviado', enviado_em = now() WHERE id = p_orcamento_id;");
    expect(upd).toBeGreaterThan(-1);
    expect(renovar.indexOf("public.orcamento_congelar_versao(v_orc, false, v_uid)")).toBeGreaterThan(upd);
    expect(renovar).toContain("'orcamento_renovado'");
    expect(renovar.match(/\bUPDATE public\./g)).toHaveLength(1);
  });

  it("não manda mensagem ao cliente nem enfileira nada", () => {
    expect(renovar).not.toMatch(/whatsapp|enfileirar|notificac/i);
  });

  it("devolve ok, status, status_anterior, enviado_em, valido_ate e versao_id", () => {
    for (const chave of ["'ok', true", "'orcamento_id'", "'status', 'enviado'", "'status_anterior'", "'enviado_em'", "'valido_ate'", "'versao_id'"]) {
      expect(renovar, chave).toContain(chave);
    }
  });

  it("anon fora, authenticated e service_role dentro", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.renovar_orcamento_vencido(uuid) FROM PUBLIC, anon;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.renovar_orcamento_vencido(uuid) TO authenticated, service_role;");
  });

  it("mensagens de erro em português simples, sem travessão, seta nem parênteses", () => {
    const msgs = [...renovar.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map((m) => m[1]).concat([...aprovar.matchAll(/RAISE EXCEPTION '([^']*)'/g)].map((m) => m[1]));
    expect(msgs.length).toBeGreaterThanOrEqual(8);
    for (const m of msgs) expect(m, m).not.toMatch(/[()—–→]/);
  });
});

describe("documento do ensaio", () => {
  it("traz os resultados literais", () => {
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain("tirando o bloco da guarda sobra o corpo vivo de antes (md5 igual)=true");
    expect(doc).toContain("detalhe=origem_invalida");
    expect(doc).toContain("detalhe=ainda_valido");
    expect(doc).toContain("detalhe=sem_valor");
    expect(doc).toContain("detalhe=tem_os");
    expect(doc).toContain("Permissão necessária: orcamentos.approve");
    expect(doc).toContain("(nao repete)");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
function lerTela(rel: string) {
  return readFileSync(join(__dirname, "..", rel), "utf8");
}
