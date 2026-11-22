import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MATERIAL, MODELOS, REGRAS, REGRAS_DA_ARTE, TAXAS } from "./apoio/trofeus";

/**
 * 22/11/2026. A migração planta o catálogo e as regras do troféu. Os testes da conta (`trofeus-conta.test.ts`)
 * usam o fixture `tests/apoio/trofeus.ts`: aqui ele é comparado com o SQL, para os dois nunca discordarem.
 */
const arquivo = "20261122200000_trofeu_catalogo_e_regras.sql";
const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
const codigo = sql.replace(/--[^\n]*/g, "");

const MATERIAL_PELO_NOME: Record<string, string> = {
  "ACRILICO CRISTAL VIRGEM 2MM": MATERIAL.cristal2,
  "ACRILICO CRISTAL VIRGEM 3MM": MATERIAL.cristal3,
  "ACRILICO CRISTAL VIRGEM 6MM": MATERIAL.cristal6,
  "ACRILICO PRETO VIRGEM 3MM": MATERIAL.preto3,
  "Acrilico esp dourado 2mm": MATERIAL.dourado2,
};

function pecasDoSql() {
  const re = /\('(Troféu [^']+)', (\d+), '([^']+)', '([^']+)', ([\d.]+), ([\d.]+), ([\d.]+), (\d+), ([\d.]+), '([^']+)'\)/g;
  const linhas = [...codigo.matchAll(re)].map((m) => ({
    modelo: m[1],
    ordem: Number(m[2]),
    nome: m[3],
    materialId: MATERIAL_PELO_NOME[m[4]],
    espessuraMm: Number(m[5]),
    larguraM: Number(m[6]),
    alturaM: Number(m[7]),
    quantidade: Number(m[8]),
    fatorDeForma: Number(m[9]),
    decoracao: m[10],
  }));
  return linhas;
}

describe("migração: o catálogo e as regras do troféu de acrílico", () => {
  it("o prefixo é único e a migração é uma transação só", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("20261122200000"))).toEqual([arquivo]);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });

  it("para antes de criar se algo já existe ou se o custo do preto ainda não foi corrigido", () => {
    for (const guarda of [
      "as tabelas de troféu já existem",
      "esperava um material %, achei outro número",
      "o preto 3 mm não está a R$ 194,50: aplique antes a migração 20261122100000",
      "faltam funções de apoio",
    ]) {
      expect(sql, guarda).toContain(guarda);
    }
  });

  it("as regras são uma linha só, com o id uuid que a auditoria exige", () => {
    expect(codigo).toContain("id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n  unica boolean NOT NULL DEFAULT true UNIQUE CHECK (unica)");
    // tg_auditar converte o id em uuid: um id booleano quebraria a primeira alteração de preço
    expect(codigo).not.toMatch(/trofeu_regras \(\s*id boolean/);
  });

  it("toda tabela tem RLS, nada para anon e uma política de leitura e uma de escrita", () => {
    for (const tabela of ["trofeu_regras", "trofeu_modelos", "trofeu_pecas"]) {
      expect(codigo, tabela).toContain(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY;`);
      expect(codigo, tabela).toContain(`CREATE POLICY ${tabela}_leitura ON public.${tabela} FOR SELECT TO authenticated`);
      expect(codigo, tabela).toContain(`CREATE POLICY ${tabela}_escrita ON public.${tabela} FOR ALL TO authenticated`);
      expect(codigo, tabela).toContain(`CREATE TRIGGER tg_auditar_${tabela} AFTER INSERT OR UPDATE OR DELETE ON public.${tabela}`);
    }
    expect(codigo).toContain("REVOKE ALL ON public.trofeu_regras, public.trofeu_modelos, public.trofeu_pecas FROM PUBLIC, anon;");
    expect(codigo).toContain("has_table_privilege('anon', 'public.' || v_t, 'SELECT')");
  });

  it("as regras de preço só se leem com permissão de financeiro; modelos e peças, qualquer funcionário", () => {
    expect(codigo).toMatch(/trofeu_regras_leitura[\s\S]{0,120}can_see_financials\(\(SELECT auth\.uid\(\)\)\)/);
    expect(codigo).toMatch(/trofeu_modelos_leitura[\s\S]{0,120}is_staff\(\(SELECT auth\.uid\(\)\)\)/);
    expect(codigo).toMatch(/trofeu_pecas_leitura[\s\S]{0,120}is_staff\(\(SELECT auth\.uid\(\)\)\)/);
  });

  it("só admin e gestor escrevem, e a condição vale na leitura de linha e na gravação", () => {
    const escritas = [...codigo.matchAll(/CREATE POLICY trofeu_\w+_escrita[\s\S]*?;\n/g)].map((m) => m[0]);
    expect(escritas).toHaveLength(3);
    for (const e of escritas) {
      expect(e).toContain("USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))");
      expect(e).toContain("WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::app_role))");
      expect(e).not.toMatch(/vendedor|designer|anon/);
    }
  });

  it("não cria função nova", () => {
    expect(codigo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
  });

  it("as regras plantadas são as do fixture dos testes da conta", () => {
    const faixas = JSON.parse(codigo.match(/'(\[\{"de": 1[^']+)'::jsonb/)![1]);
    expect(faixas).toEqual(REGRAS.faixas);
    const velocidades = JSON.parse(codigo.match(/'(\{"2": 1\.5[^']+)'::jsonb/)![1]);
    expect(velocidades).toEqual(TAXAS.velocidadeDeCorteMPorMin);
    const linha = codigo.match(/2\.20, 4\.00, 0\.120, 0\.400,\n\s+(.+?), '\{/)![1];
    expect(linha).toBe(`${TAXAS.tintaMlM2.toFixed(2)}, ${TAXAS.colaMlPorJuncao.toFixed(2)}, ${TAXAS.gravacaoMinPorM2.toFixed(2)}, ${TAXAS.preparoDoLaserMin.toFixed(1)}`);
    expect([REGRAS.pisoDoMultiplicador, REGRAS.multiplicadorDeUrgencia, REGRAS.alturaMinimaM, REGRAS.alturaMaximaM]).toEqual([2.2, 4, 0.12, 0.4]);
    const arte = codigo.match(/3\.0, 3\.00, true, 20, 50\.00,\n\s+30\.00, 4\.00,/);
    expect(arte).not.toBeNull();
    expect([REGRAS_DA_ARTE.horasDaCriacaoExclusiva, REGRAS_DA_ARTE.multiplicador, REGRAS_DA_ARTE.descontoAPartirDe, REGRAS_DA_ARTE.descontoPct]).toEqual([3, 3, 20, 50]);
    expect([REGRAS_DA_ARTE.alteracaoExtra, REGRAS_DA_ARTE.nomeIndividualPorPeca]).toEqual([30, 4]);
  });

  it("o que ainda é estimativa está listado como provisório", () => {
    for (const nome of ["tinta_ml_m2", "velocidade_de_corte", "gravacao_min_por_m2", "medidas_dos_modelos", "custo_do_espelhado_dourado"]) {
      expect(codigo, nome).toContain(`'${nome}'`);
    }
    expect(codigo).toContain("provisorio boolean NOT NULL DEFAULT true");
  });

  it("os três modelos plantados são os do fixture, com a altura, a mão de obra e o ×3", () => {
    const modelos = [...codigo.matchAll(/\('(Troféu [^']+)', '(economico|padrao|premium)',\s+'[^']+',\s+([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) => ({
      nome: m[1],
      linha: m[2],
      alturaDeReferenciaM: Number(m[3]),
      minutosDeMaoDeObra: Number(m[4]),
      multiplicadorBase: Number(m[5]),
    }));
    expect(modelos).toEqual(
      MODELOS.map((m) => ({
        nome: m.nome,
        linha: m.linha,
        alturaDeReferenciaM: m.alturaDeReferenciaM,
        minutosDeMaoDeObra: m.minutosDeMaoDeObra,
        multiplicadorBase: m.multiplicadorBase,
      })),
    );
  });

  it("as 15 peças plantadas são as do fixture, na mesma ordem e com a mesma medida", () => {
    const doSql = pecasDoSql();
    expect(doSql).toHaveLength(15);
    for (const modelo of MODELOS) {
      const doModelo = doSql.filter((p) => p.modelo === modelo.nome).sort((a, b) => a.ordem - b.ordem);
      expect(doModelo.map((p) => p.ordem)).toEqual(modelo.pecas.map((_, i) => i + 1));
      expect(
        doModelo.map(({ nome, materialId, espessuraMm, larguraM, alturaM, quantidade, fatorDeForma, decoracao }) => ({
          nome, materialId, espessuraMm, larguraM, alturaM, quantidade, fatorDeForma, decoracao,
        })),
        modelo.nome,
      ).toEqual(modelo.pecas);
    }
  });

  it("todo material do seed existe no mapa (nenhuma peça cai sem material)", () => {
    for (const p of pecasDoSql()) expect(p.materialId, `${p.modelo} / ${p.nome}`).toBeTruthy();
  });

  it("confere o resultado antes do COMMIT", () => {
    expect(codigo.indexOf("DO $final$")).toBeLessThan(codigo.indexOf("COMMIT;"));
    expect(codigo).toContain("<> 15 THEN");
    expect(codigo).toContain("esperava 15 peças (2 + 4 + 9)");
  });

  it("o DESFAZER só derruba as três tabelas", () => {
    const desfazer = sql.slice(sql.indexOf("DESFAZER"));
    expect(desfazer).toContain("DROP TABLE public.trofeu_pecas;");
    expect(desfazer).toContain("DROP TABLE public.trofeu_modelos;");
    expect(desfazer).toContain("DROP TABLE public.trofeu_regras;");
  });
});
