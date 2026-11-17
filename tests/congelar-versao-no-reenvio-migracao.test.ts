import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASTA_MIGRACOES, cabecalhoDa, corpoDa, lerDoc, lerMigracao, md5, semComentarios } from "./apoio/corpo-da-funcao";

/**
 * Congelar a versão também no reenvio (17/11/2026): contrato da migração lido como TEXTO. O SQL de verdade foi
 * provado no banco vivo, numa transação desfeita (docs/ensaio-congelar-versao-no-reenvio.md).
 */
const NOME = "20261117180000_congelar_versao_no_reenvio.sql";
const sql = lerMigracao(NOME);
const codigo = semComentarios(sql);
const doc = lerDoc("ensaio-congelar-versao-no-reenvio.md");
const congelar = corpoDa(sql, "orcamento_congelar_versao(");
const gatilho = corpoDa(sql, "tg_orcamento_congela_versao()");
const confirmar = corpoDa(sql, "confirmar_envio_documento(");

describe("arquivo, ordem e escopo", () => {
  it("prefixo único, ENSAIADA e APLICADA, transação única", () => {
    expect(readdirSync(PASTA_MIGRACOES).filter((n) => n.startsWith("20261117180000_"))).toEqual([NOME]);
    expect(sql).toMatch(/ENSAIADA no banco vivo em 17\/11\/2026/);
    expect(sql).toMatch(/APLICADA no banco vivo/);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("não faz carga retroativa: nenhuma escrita fora das funções, nenhuma tabela alterada", () => {
    const fora = codigo
      .replace(/AS \$function\$[\s\S]*?\$function\$/g, "")
      .replace(/AS \$g\$[\s\S]*?\$g\$/g, "");
    expect(fora).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i);
    expect(codigo).not.toMatch(/ALTER TABLE|CREATE TRIGGER|DROP /i);
  });

  it("troca só tg_orcamento_congela_versao e confirmar_envio_documento, cada uma com o md5 do corpo vivo conferido antes", () => {
    expect(codigo.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
    expect(codigo).toContain("'73d5680ed15a4534da13718eafd5ed61'");
    expect(codigo).toContain("'9d0ab672aaba56e75de28ea6fa307317'");
    expect(codigo.indexOf("73d5680ed15a4534da13718eafd5ed61")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION public.orcamento_congelar_versao"));
    expect(codigo.indexOf("9d0ab672aaba56e75de28ea6fa307317")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION public.orcamento_congelar_versao"));
  });
});

describe("os três corpos são os que foram ensaiados no banco vivo", () => {
  it("md5 de cada corpo", () => {
    expect(md5(congelar)).toBe("60c04a27d5693293c6cb0481afa73b21");
    expect(md5(gatilho)).toBe("16098a54f9fd7b3874894946c7f414ca");
    expect(md5(confirmar)).toBe("c4509f50c6b41e9131f5a6530969be56");
    for (const h of ["60c04a27d5693293c6cb0481afa73b21", "16098a54f9fd7b3874894946c7f414ca", "c4509f50c6b41e9131f5a6530969be56"]) expect(doc).toContain(h);
  });
});

describe("orcamento_congelar_versao", () => {
  const cab = cabecalhoDa(sql, "orcamento_congelar_versao(");
  it("assinatura, SECURITY DEFINER e search_path fixo", () => {
    expect(cab).toContain("(p_orc public.orcamentos, p_aprovando boolean, p_uid uuid)");
    expect(cab).toContain("RETURNS uuid");
    expect(cab).toContain("SECURITY DEFINER");
    expect(cab).toContain("SET search_path TO 'public'");
  });

  it("usa o hash de itens e total: mesmo conteúdo reaproveita a versão, conteúdo novo cria a seguinte", () => {
    expect(congelar).toContain("md5(v_itens::text || '|' || coalesce(p_orc.valor_total::text, '0'))");
    expect(congelar).toContain("v_ultima.snapshot->>'hash' = v_hash");
    expect(congelar).toContain("coalesce(v_ultima.numero_versao, 0) + 1");
    expect(congelar).toContain("INSERT INTO public.orcamento_versao_itens");
    expect(congelar).toContain("RETURN v_id;");
  });

  it("a área derivada não faz versão nova: itens sem area_cobrada e mesmo total reaproveitam a última (achado da revisão)", () => {
    expect(congelar).toContain("e - 'area_cobrada'");
    expect(congelar).toContain("coalesce(v_ultima.valor_total, 0) = coalesce(p_orc.valor_total, 0)");
    expect(congelar).toContain("v_ultima.snapshot->>'hash' IS NOT NULL");
    expect(congelar).toContain("IF v_igual THEN");
    expect(doc).toContain("217: hash igual=false | versoes 1 para 1");
  });

  it("o retrato da versão não leva custo, token nem IP", () => {
    expect(congelar).toContain("public.jsonb_sem_custo(to_jsonb(p_orc) - 'token_publico' - 'aprovado_ip')");
  });

  it("só service_role executa", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid) FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid) TO service_role;");
  });
});

describe("tg_orcamento_congela_versao", () => {
  it("só delega e guarda versao_aprovada_id", () => {
    expect(gatilho).toContain("public.orcamento_congelar_versao(NEW, v_aprovando, auth.uid())");
    expect(gatilho).toContain("IF v_aprovando THEN NEW.versao_aprovada_id := v_id; END IF;");
    expect(gatilho).not.toMatch(/INSERT|UPDATE/);
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.tg_orcamento_congela_versao() FROM PUBLIC, anon, authenticated;");
  });

  it("o gatilho em si não é recriado nem solto", () => {
    expect(codigo).not.toMatch(/CREATE TRIGGER|DROP TRIGGER|ALTER TABLE/i);
    expect(codigo).toContain("tgname = 'zz_orcamento_congela_versao' AND tgenabled = 'O'");
  });
});

describe("confirmar_envio_documento", () => {
  it("congela só quando o orçamento JÁ estava enviado, depois de gravar, com o usuário que confirmou", () => {
    const bloco = "IF v_status = 'enviado' THEN\n      SELECT * INTO v_orc FROM public.orcamentos WHERE id = v_env.referencia_id;\n      PERFORM public.orcamento_congelar_versao(v_orc, false, p_usuario);\n    END IF;";
    expect(confirmar).toContain(bloco);
    expect(confirmar.indexOf(bloco)).toBeGreaterThan(confirmar.indexOf("ELSIF v_status = 'enviado' AND v_sem_data THEN"));
    expect(confirmar.indexOf(bloco)).toBeLessThan(confirmar.indexOf("INSERT INTO public.eventos_negocio"));
  });

  it("tirando o bloco novo e a variável nova sobra o corpo vivo de antes (mesmas regras de envio)", () => {
    // o ensaio no banco provou o md5 9d0ab672...; aqui o texto confere que nada das regras antigas saiu
    for (const regra of [
      "Este envio não é seu pelo WhatsApp da gráfica.",
      "A mensagem ainda não saiu pelo WhatsApp.",
      "UPDATE public.orcamentos SET status = 'enviado', enviado_em = coalesce(enviado_em, v_msg_em)",
      "ELSIF v_status = 'enviado' AND v_sem_data THEN",
      "'documento_enviado_ao_cliente'",
      "RETURN jsonb_build_object('status_mudou', v_status_mudou, 'enviado_em_gravado', v_gravou_data);",
    ]) expect(confirmar, regra).toContain(regra);
    expect(doc).toContain("md5 igual)=true md5 antes=9d0ab672aaba56e75de28ea6fa307317");
  });

  it("não reescreve enviado_em no reenvio", () => {
    expect(confirmar.match(/SET enviado_em = /g)).toHaveLength(1); // só o ramo antigo "enviado sem data"
    expect(confirmar).not.toMatch(/enviado_em = now\(\)/);
  });

  it("continua só para service_role", () => {
    expect(codigo).toContain("REVOKE ALL ON FUNCTION public.confirmar_envio_documento(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(codigo).toContain("GRANT EXECUTE ON FUNCTION public.confirmar_envio_documento(uuid, uuid) TO service_role;");
  });
});

describe("documento do ensaio", () => {
  it("traz os resultados literais", () => {
    expect(doc).toContain("ENSAIO OK, DESFEITO");
    expect(doc).toContain("igual antes e depois=true");
    expect(doc).toContain("faixa mudou=true valor da versao=57.60 valor atual=448.00");
    expect(doc).toContain("depois do reenvio: versoes=2 valor da versao nova=448.00");
    expect(doc).toContain("segundo reenvio sem mudanca: versoes=2 (nao nasce a 3)");
    expect(doc).toContain("versoes no banco dentro do ensaio: 96 (eram 94)");
  });
});
