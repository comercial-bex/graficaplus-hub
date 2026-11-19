import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O desconto sumia da tela e do PDF (19/11/2026, orçamento #261): o contrato da migração, lido como TEXTO. O que o SQL
 * faz de verdade foi provado no banco vivo, numa transação desfeita, e está em docs/ensaio-espelhos-de-valor-19-11-2026.md.
 *
 * A tela e o PDF leem o preço pelo espelho orcamento_custos. O gatilho que copia para lá era "AFTER UPDATE OF colunas",
 * e o desconto grava outras colunas: quem recalcula o total é um gatilho BEFORE, que não conta para "UPDATE OF".
 * Controle no banco, sem a correção: desconto de 10 por cento no #251, banco R$ 34,05 e tela R$ 37,83.
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase", "migrations");
const NOME = "20261119200000_espelhos_de_valor_seguem_o_gatilho.sql";
const sql = readFileSync(join(PASTA, NOME), "utf8");
const doc = readFileSync(join(RAIZ, "docs", "ensaio-espelhos-de-valor-19-11-2026.md"), "utf8");

const semComentarios = (t: string) =>
  t
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const codigo = semComentarios(sql);

/** O CREATE TRIGGER inteiro, do nome até o ponto e vírgula. Só no começo da linha: a guarda cita o gatilho antigo num texto. */
function gatilho(nome: string): string {
  const m = new RegExp(`^CREATE TRIGGER ${nome}\\b[\\s\\S]*?;`, "m").exec(codigo);
  if (!m) throw new Error(`sem o gatilho ${nome}`);
  return m[0].replace(/\s+/g, " ");
}

describe("migração 20261119200000: espelhos de valor seguem o gatilho", () => {
  it("tem prefixo único e é uma transação só, com lock_timeout curto", () => {
    expect(readdirSync(PASTA).filter((n) => n.startsWith(NOME.slice(0, 14)))).toEqual([NOME]);
    expect(codigo).toMatch(/^\s*BEGIN;/m);
    expect(codigo).toContain("SET LOCAL lock_timeout = '5s';");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("só troca os gatilhos se forem exatamente os que o banco tinha", () => {
    expect(codigo).toContain(
      "'CREATE TRIGGER tg_sync_orcamento_custos AFTER INSERT OR UPDATE OF valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION tg_sync_orcamento_custos()'",
    );
    expect(codigo).toContain(
      "'CREATE TRIGGER tg_sync_item_os_custos AFTER INSERT OR UPDATE OF valor_unitario, custo_unitario, valor_total ON public.itens_os FOR EACH ROW EXECUTE FUNCTION tg_sync_item_os_custos()'",
    );
    expect(codigo.indexOf("DO $guarda$")).toBeLessThan(codigo.indexOf("DROP TRIGGER"));
  });

  it("não cria nem troca função: só a condição de disparo muda", () => {
    expect(codigo).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });
});

describe("o espelho do orçamento segue o VALOR, não a lista de colunas do UPDATE", () => {
  const update = gatilho("tg_sync_orcamento_custos");
  const insert = gatilho("tg_sync_orcamento_custos_ao_criar");

  it("dispara em qualquer UPDATE em que um dos cinco valores mudou, inclusive por gatilho BEFORE", () => {
    expect(update).toContain("AFTER UPDATE ON public.orcamentos FOR EACH ROW WHEN (");
    expect(update).not.toMatch(/UPDATE OF/);
    for (const c of ["valor_subtotal", "valor_total", "desconto_percentual", "custo_estimado", "margem_estimada"]) {
      expect(update).toContain(`OLD.${c} IS DISTINCT FROM NEW.${c}`);
    }
    expect(update).toContain("EXECUTE FUNCTION public.tg_sync_orcamento_custos();");
  });

  it("a linha nova continua nascendo no espelho", () => {
    expect(insert).toBe(
      "CREATE TRIGGER tg_sync_orcamento_custos_ao_criar AFTER INSERT ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION public.tg_sync_orcamento_custos();",
    );
  });
});

describe("o espelho do item de OS também, porque o preço por metro quadrado é recalculado num BEFORE", () => {
  const update = gatilho("tg_sync_item_os_custos");

  it("dispara quando valor unitário, custo ou total mudam, venha de onde vier", () => {
    expect(update).toContain("AFTER UPDATE ON public.itens_os FOR EACH ROW WHEN (");
    expect(update).not.toMatch(/UPDATE OF/);
    for (const c of ["valor_unitario", "custo_unitario", "valor_total"]) {
      expect(update).toContain(`OLD.${c} IS DISTINCT FROM NEW.${c}`);
    }
    expect(gatilho("tg_sync_item_os_custos_ao_criar")).toBe(
      "CREATE TRIGGER tg_sync_item_os_custos_ao_criar AFTER INSERT ON public.itens_os FOR EACH ROW EXECUTE FUNCTION public.tg_sync_item_os_custos();",
    );
  });

  it("o gatilho da OS fica como está: nenhum BEFORE de ordens_servico mexe no que ele espelha", () => {
    expect(codigo).not.toContain("tg_sync_os_resultados_financeiros");
  });
});

describe("a ressincronização dos orçamentos atrasados", () => {
  it("só corrige a diferença do desconto; outra diferença para a migração", () => {
    expect(codigo).toContain("há orçamento com espelho diferente fora do desconto: é outro defeito, investigue antes");
    expect(codigo).toMatch(/SET valor_total = o\.valor_total,\s+desconto_percentual = o\.desconto_percentual,\s+updated_at = now\(\)/);
  });

  it("deixa rastro por orçamento, com o número e sem valor", () => {
    expect(codigo).toContain("'espelho_de_valor_resincronizado'");
    expect(codigo).toContain("jsonb_build_object('numero', x.numero, 'migracao', '20261119200000')");
  });

  it("confere no fim que espelho e tabela batem, e que as funções de gatilho seguem fechadas", () => {
    expect(codigo).toContain("'o espelho dos orçamentos ainda difere da tabela'");
    expect(codigo).toContain("'o espelho dos itens de OS difere da tabela'");
    expect(codigo).toContain("has_function_privilege('anon', 'public.tg_sync_orcamento_custos()', 'EXECUTE')");
    expect(codigo).not.toMatch(/\bDELETE\b/i);
  });
});

describe("o roteiro de ensaio", () => {
  it("registra o controle sem a correção, o ensaio com ela e o estado de aplicação", () => {
    expect(doc).toContain(NOME);
    expect(doc).toContain("RAISE EXCEPTION");
    expect(doc).toContain("37,83");
    expect(doc).toContain("34,05");
    expect(doc).toContain("1.283,91");
    expect(doc).toMatch(/[Aa]plicad/);
  });
});
