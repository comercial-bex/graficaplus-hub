import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { custoDosTerceirizados } from "@/domain/orcamentos/terceirizados";

/**
 * Decisão 11 (05/11/2026): a conversão em OS gravava o custo por peça do ITEM em centavos (itens_os.custo_unitario era
 * numeric(12,2)); R$ 100 por pedido em 30.000 peças virava R$ 0,00 no item e o relatório "Margem por produto" saía com
 * margem a mais. A migração 20261110220000 passa as colunas a numeric sem escala, derrubando e refazendo o que impedia o
 * ALTER TYPE (gatilho tg_sync_item_os_custos, rel_margem_por_produto e itens_os_financeiro).
 */

const PASTA = join(__dirname, "..", "supabase/migrations");
const NOME = "20261110220000_custo_da_os_sem_arredondar_a_centavos.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const semComentario = (t: string) => t.replace(/^\s*--.*$/gm, "");

describe("a troca de tipo", () => {
  it("passa as duas colunas a numeric SEM escala, não a numeric(p,s)", () => {
    expect(sql).toContain("ALTER TABLE public.itens_os ALTER COLUMN custo_unitario TYPE numeric;");
    expect(sql).toContain(
      "ALTER TABLE public.item_os_custos ALTER COLUMN custo_unitario TYPE numeric;",
    );
    expect(semComentario(sql)).not.toMatch(/custo_unitario\s+TYPE\s+numeric\s*\(/i);
  });

  it("é uma instrução só (um DO): atômica mesmo fora de uma transação explícita, e sem BEGIN/COMMIT que furariam o ensaio", () => {
    const codigo = semComentario(sql);
    expect((codigo.match(/^DO \$m\$/gm) ?? []).length).toBe(1);
    expect(codigo).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });

  it("é idempotente e recusa tipo inesperado", () => {
    expect(sql).toContain("IF v_tipo_os = 'numeric' AND v_tipo_esp = 'numeric' THEN");
    expect(sql).toContain(
      "IF v_tipo_os IS DISTINCT FROM 'numeric(12,2)' OR v_tipo_esp IS DISTINCT FROM 'numeric(12,2)' THEN",
    );
  });
});

describe("o que impedia o ALTER é derrubado e refeito igual", () => {
  it("derruba o gatilho e as duas visões, e só elas", () => {
    expect(sql).toContain("DROP TRIGGER tg_sync_item_os_custos ON public.itens_os;");
    expect(sql).toContain("DROP VIEW public.rel_margem_por_produto;");
    expect(sql).toContain("DROP VIEW public.itens_os_financeiro;");
    expect(
      (semComentario(sql).match(/\bDROP\s+(VIEW|TRIGGER|TABLE|FUNCTION|COLUMN)\b/gi) ?? []).length,
    ).toBe(3);
  });

  it("para em voz alta se o conjunto de dependentes das colunas mudou", () => {
    expect(sql).toContain(
      "'gatilho itens_os.tg_sync_item_os_custos | visão itens_os_financeiro | visão rel_margem_por_produto'",
    );
    expect(sql).toContain("RAISE EXCEPTION 'Dependentes das colunas de custo mudaram.");
    expect(sql).toContain(
      "RAISE EXCEPTION 'Alguma outra visão ou função depende de rel_margem_por_produto ou itens_os_financeiro",
    );
  });

  it("ignora só o tipo-lista que o Postgres cria sozinho para cada visão (dependência interna), nunca outro objeto", () => {
    expect(sql).toContain("AND NOT (d.classid = 'pg_type'::regclass AND d.deptype = 'i'");
    expect(sql).toContain("t.typcategory = 'A' AND t.typelem = d.refobjid");
  });

  it("recria a visão com o texto VIVO, nunca com uma cópia escrita à mão", () => {
    expect(sql).toContain("'definicao',  pg_get_viewdef(c.oid)");
    expect(sql).toContain("EXECUTE format('CREATE VIEW %s %s AS %s'");
    expect(semComentario(sql)).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+public\./i);
  });

  it("repõe opções, dono, privilégios e comentário (CREATE VIEW nasce com o padrão do schema, que abre para anon)", () => {
    expect(sql).toContain("to_jsonb(c.reloptions)");
    expect(sql).toContain("ALTER VIEW %s OWNER TO %I");
    expect(sql).toContain("aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))");
    expect(sql).toContain("REVOKE ALL ON %s FROM %s");
    expect(sql).toContain("GRANT %s ON %s TO %s%s");
    expect(sql).toContain("COMMENT ON VIEW %s IS %L");
  });

  it("rel_margem_por_produto continua fechada ao público e a conferência está no próprio bloco", () => {
    expect(sql).toContain("has_table_privilege('anon', 'public.rel_margem_por_produto', 'SELECT')");
    expect(sql).toContain(
      "has_table_privilege('authenticated', 'public.rel_margem_por_produto', 'SELECT')",
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'rel_margem_por_produto ficou legível para anon ou authenticated'",
    );
  });

  it("recria o gatilho com a definição viva e o mesmo estado (ligado/desligado)", () => {
    expect(sql).toContain("pg_get_triggerdef(t.oid), t.tgenabled");
    expect(sql).toContain("EXECUTE v_gatilho;");
    expect(sql).toContain("tg_sync_item_os_custos foi recriado com definição diferente");
  });

  it("os valores de hoje não mudam com a troca de tipo (conferido com trim_scale)", () => {
    expect(sql).toContain("trim_scale(custo_unitario)");
    expect(sql).toContain("Os valores de custo_unitario mudaram com a troca de tipo (não podia)");
  });
});

describe("nenhuma migração posterior volta a pôr escala nas duas colunas", () => {
  it("custo_unitario de itens_os e de item_os_custos segue sem escala", () => {
    const depois = readdirSync(PASTA).filter(
      (f) => f.endsWith(".sql") && f.slice(0, 14) > NOME.slice(0, 14),
    );
    const culpadas = depois.filter((f) => {
      const t = semComentario(readFileSync(join(PASTA, f), "utf8"));
      return /ALTER\s+TABLE\s+(public\.)?(itens_os|item_os_custos)[\s\S]{0,120}custo_unitario[\s\S]{0,40}TYPE\s+numeric\s*\(/i.test(
        t,
      );
    });
    expect(culpadas).toEqual([]);
  });
});

describe("por que numeric(14,6) não serve", () => {
  const arredonda = (x: number, casas: number) => Math.round(x * 10 ** casas) / 10 ** casas;

  it("R$ 100 por pedido em 30.000 peças: com 6 casas a conta volta R$ 99,99 (um centavo a menos)", () => {
    const porPeca = custoDosTerceirizados(
      [{ id: "f", descricao: "Frete", valor: 100, base: "pedido" }],
      { largura: 1, altura: 1, quantidade: 30000 },
    ).total;
    expect(porPeca).toBeCloseTo(100 / 30000, 12);
    expect(arredonda(porPeca, 2) * 30000).toBe(0);
    expect(arredonda(porPeca, 4) * 30000).toBeCloseTo(99, 6);
    expect(arredonda(porPeca, 6) * 30000).toBeCloseTo(99.99, 6);
    expect(porPeca * 30000).toBeCloseTo(100, 9);
  });

  it("R$ 12,34 por pedido em 10.000.000 de peças: nem 6 casas (R$ 10,00) nem 8 (R$ 12,30) fecham", () => {
    const porPeca = 12.34 / 10_000_000;
    expect(arredonda(porPeca, 6) * 10_000_000).toBeCloseTo(10, 6);
    expect(arredonda(porPeca, 8) * 10_000_000).toBeCloseTo(12.3, 6);
    expect(porPeca * 10_000_000).toBeCloseTo(12.34, 9);
  });
});
