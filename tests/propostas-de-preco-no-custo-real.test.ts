import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { margemLiquida } from "../src/domain/precos/custo-real";
import { barrasDaProposta, propostaResolve } from "../src/domain/precos/propostas";

/**
 * Propostas de preço no custo real (17/11/2026): o contrato da migração, lido como TEXTO. O que o SQL faz de verdade
 * foi provado no banco vivo, numa transação desfeita, e está em docs/ensaio-propostas-no-custo-real-17-11-2026.md.
 *
 * O defeito: preco_proposta_criar (o "Pedir este preço" de Preços por produto) gravava custo, piso e margens só com o
 * material, e preco_proposta_aprovar regravava o registro assim na hora de aprovar. O Adesivo vinil recortado a
 * R$ 99,90 ficou com piso de R$ 12,07 e margem de 92,75 por cento no histórico, quando o gestor viu 72,84 e 58,71.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261117100000_propostas_de_preco_no_custo_real.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-propostas-no-custo-real-17-11-2026.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

/** O corpo de uma função, entre `AS $f$` e o `$f$` que fecha, lido do arquivo COM comentários. */
function corpoDe(nome: string): string {
  const i = sql.indexOf(`FUNCTION public.${nome}(`);
  if (i < 0) throw new Error(`sem ${nome}`);
  const ini = sql.indexOf("$f$", i) + 3;
  return sql.slice(ini, sql.indexOf("$f$", ini));
}

/** O SQL fora dos corpos de função: o que a migração executa ela mesma. */
const foraDasFuncoes = codigo.replace(/AS \$f\$[\s\S]*?\$f\$/g, "AS $f$ $f$");

describe("migração 20261117100000: propostas de preço no custo real", () => {
  it("tem prefixo único e é uma transação só, com lock_timeout curto", () => {
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("só troca as duas funções se o corpo vivo for o que foi lido (md5)", () => {
    expect(codigo).toContain("'4db878d2fc485462cd65e865dda8973e'");
    expect(codigo).toContain("'462f90afe3237e362b7aee6964445402'");
    expect(codigo.indexOf("DO $guarda$")).toBeLessThan(codigo.indexOf("CREATE OR REPLACE FUNCTION"));
  });

  it("os corpos não têm linha de comentário, para o md5 do banco bater com o arquivo", () => {
    for (const f of ["_preco_proposta_numeros", "preco_proposta_criar", "preco_proposta_aprovar"]) {
      expect(corpoDe(f)).not.toMatch(/--/);
    }
  });
});

describe("_preco_proposta_numeros: a conta única dos números da proposta", () => {
  const corpo = corpoDe("_preco_proposta_numeros");

  it("usa o custo real da visão: custo de produção, preço mínimo recomendado e margem líquida", () => {
    expect(corpo).toContain("FROM public.produto_custo_real r");
    expect(corpo).toContain("v_real.custo_producao,");
    expect(corpo).toContain("v_real.preco_minimo_recomendado,");
    expect(corpo).toContain("COALESCE(NULLIF(v_prod.margem_minima, 0), 30)");
    expect(corpo).toContain("round((1 - v_real.custo_real / p_preco_atual) * 100, 2)");
    expect(corpo).toContain("round((1 - v_real.custo_real / p_preco_proposto) * 100, 2)");
  });

  it("produto sem custo real cai na conta de antes, só com o material, e diz qual base usou", () => {
    expect(corpo).toContain("public._preco_piso(v_prod.custo_medio, v_prod.margem_minima)");
    expect(corpo).toContain("public._preco_margem(p_preco_proposto, v_prod.custo_medio)");
    expect(corpo).toContain("'custo_real'::text");
    expect(corpo).toContain("'material'::text");
  });

  it("ninguém de fora executa: nem anon, nem quem está logado, nem a chave do servidor", () => {
    expect(codigo).toContain(
      "REVOKE ALL ON FUNCTION public._preco_proposta_numeros(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(codigo).not.toMatch(/GRANT EXECUTE ON FUNCTION public\._preco_proposta_numeros/);
    expect(codigo).toMatch(/LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS \$f\$/);
  });

  it("é a mesma margem líquida da tela Preços por produto", () => {
    // Adesivo vinil recortado: custo real 41,25. O banco grava 58,71; a tela mostra 58,7.
    expect(margemLiquida(99.9, 41.25)).toBe(58.7);
    expect(margemLiquida(68, 41.25)).toBe(39.3);
  });
});

describe("pedir e aprovar gravam com a conta única", () => {
  const criar = corpoDe("preco_proposta_criar");
  const aprovar = corpoDe("preco_proposta_aprovar");

  it("pedir grava os números da conta e diz no rastro qual base usou, sem custo em reais", () => {
    expect(criar).toContain("public._preco_proposta_numeros(v_prod.id, COALESCE(v_prod.preco_base, 0), v_preco)");
    expect(criar).toContain("v_num.custo, v_num.piso, v_num.margem_minima,");
    expect(criar).toContain("'base', v_num.base");
    expect(criar).not.toContain("public._preco_margem(");
  });

  it("aprovar mantém a trava do piso do MATERIAL: o preço mínimo recomendado é recomendação", () => {
    expect(aprovar).toContain("v_piso := public._preco_piso(v_prod.custo_medio, v_prod.margem_minima);");
    expect(aprovar).toContain("IF v_piso IS NOT NULL AND v_prop.preco_proposto < v_piso THEN");
    expect(aprovar).toContain("IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN");
  });

  it("aprovar congela os números da conta, lidos antes de o preço mudar", () => {
    const conta = aprovar.indexOf("public._preco_proposta_numeros(v_prod.id, v_prop.preco_atual, v_prop.preco_proposto)");
    const muda = aprovar.indexOf("UPDATE public.produtos SET preco_base = v_prop.preco_proposto");
    expect(conta).toBeGreaterThan(-1);
    expect(muda).toBeGreaterThan(conta);
    expect(aprovar).toContain("margem_atual = v_num.margem_atual, margem_proposta = v_num.margem_proposta");
    expect(aprovar).not.toContain("public._preco_margem(");
  });

  it("as duas continuam só de quem está logado, e o banco confere admin ou gestor que vê custo", () => {
    for (const assinatura of ["preco_proposta_criar(uuid, numeric, text)", "preco_proposta_aprovar(uuid)"]) {
      expect(codigo).toContain(`REVOKE ALL ON FUNCTION public.${assinatura} FROM PUBLIC, anon, authenticated, service_role;`);
      expect(codigo).toContain(`GRANT EXECUTE ON FUNCTION public.${assinatura} TO authenticated;`);
    }
    for (const corpo of [criar, aprovar]) {
      expect(corpo).toContain("public.has_role(v_uid, 'gestor'::public.app_role)");
      expect(corpo).toContain("NOT public.pode_ver_custo(v_uid)");
    }
  });
});

describe("as duas propostas aprovadas em 16/11 voltam aos números da decisão", () => {
  it("só os dois registros, só se ainda estiverem no material, e só se a conta de hoje der o que o gestor viu", () => {
    expect(codigo).toContain("('a6821c5e-e983-497a-85b3-1670dcd4db16'::uuid, 20.80::numeric, 34.33::numeric, 71.73::numeric, 30::numeric, 37.88::numeric, 48.25::numeric)");
    expect(codigo).toContain("('8ad77013-1c08-4a80-84f5-22c8b3b2e2ae'::uuid,  7.24::numeric, 38.06::numeric, 72.84::numeric, 40::numeric, 39.34::numeric, 58.71::numeric)");
    expect(codigo).toContain("WHERE pp.id = r.id AND pp.status = 'aprovada' AND pp.custo = r.custo_material");
    expect(codigo).toContain("o custo mudou desde 16/11. Não restaure.");
  });

  it("fora das funções, a migração só escreve em precos_propostas e no rastro, e nunca muda preço", () => {
    const escritas = [...foraDasFuncoes.matchAll(/\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+(public\.\w+)/gi)].map((m) => m[1]);
    expect([...new Set(escritas)].sort()).toEqual(["public.logs_auditoria", "public.precos_propostas"]);
    expect(foraDasFuncoes).not.toMatch(/\bDELETE\b/i);
  });

  it("o rastro da restauração não leva custo em reais", () => {
    expect(codigo).toContain("jsonb_build_object('proposta_id', x.id, 'base', 'custo_real', 'migracao', '20261117100000')");
  });

  it("o cartão do recortado, com os números restaurados, fica verde e resolve", () => {
    const p = { margem_minima: 40, margem_atual: 39.34, margem_proposta: 58.71, piso: 72.84, preco_proposto: 99.9 };
    const [piso, hoje, seAprovar] = barrasDaProposta(p);
    expect(piso.valor).toBe(40);
    expect(hoje.faixa).toBe("abaixo");
    expect(seAprovar.faixa).toBe("acima");
    expect(propostaResolve(p)).toBe(true);
  });
});

describe("o roteiro de ensaio", () => {
  it("registra o ensaio desfeito, o que cada caso provou e o estado de aplicação", () => {
    expect(doc).toContain(NOME);
    expect(doc).toContain("RAISE EXCEPTION");
    expect(doc).toContain("abaixo do piso de 12,07");
    expect(doc).toContain("base=material");
    expect(doc).toMatch(/[Aa]plicad/);
  });
});
