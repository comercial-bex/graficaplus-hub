import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { diasAntesDeHojeBr, hojeBr, mesBr } from "../src/lib/hoje-br";

/**
 * O relógio da casa é o de Macapá.
 *
 * O banco roda em UTC e o navegador pode estar em qualquer fuso. `current_date` (no banco) e
 * `new Date().toISOString().slice(0, 10)` (na tela) devolvem a data de Greenwich, que entre 21h e a
 * meia-noite de Macapá já é amanhã. Na noite de 29/10/2026 o painel mostrou 9 OS atrasadas e 2
 * parcelas vencidas; as reais eram 1 e 0, e um pagamento lançado depois das 21h saía com a data do
 * dia seguinte. A migração 20261030810000 trocou tudo o que estava vivo no banco por `hoje_br()`, e
 * este arquivo impede que o defeito volte por qualquer das duas portas.
 */
const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const MIGRACAO = "20261030810000_relogio_de_macapa.sql";
const SQL = readFileSync(join(PASTA_MIGRACOES, MIGRACAO), "utf8");

// 30/10/2026, 22h30 em Macapá = 31/10, 01h30 em Greenwich.
const NOITE_DE_MACAPA = new Date("2026-10-31T01:30:00Z");
const MANHA_DE_MACAPA = new Date("2026-10-30T14:00:00Z");

describe("a data de hoje na tela (hojeBr)", () => {
  it("às 22h30 de Macapá ainda é o mesmo dia, mesmo que Greenwich já esteja no seguinte", () => {
    expect(NOITE_DE_MACAPA.toISOString().slice(0, 10)).toBe("2026-10-31"); // o defeito
    expect(hojeBr(NOITE_DE_MACAPA)).toBe("2026-10-30");
    expect(hojeBr(MANHA_DE_MACAPA)).toBe("2026-10-30");
  });

  it("no último dia do mês, o pedido das 21h ainda é do mês que está acabando", () => {
    const ultimaNoite = new Date("2026-11-01T01:00:00Z"); // 31/10, 22h em Macapá
    expect(mesBr(ultimaNoite)).toBe("2026-10");
    expect(mesBr(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11"); // meia-noite de Macapá
  });

  it("a virada do dia acontece à meia-noite de Macapá, às 03h em Greenwich", () => {
    expect(hojeBr(new Date("2026-10-31T02:59:59Z"))).toBe("2026-10-30");
    expect(hojeBr(new Date("2026-10-31T03:00:00Z"))).toBe("2026-10-31");
  });

  it("aceita o texto de um instante, como o created_at que o banco devolve", () => {
    expect(hojeBr("2026-10-31T01:30:00+00:00")).toBe("2026-10-30");
    expect(mesBr("2026-11-01T01:00:00.000Z")).toBe("2026-10");
  });

  it("os últimos 30 dias contam a partir do hoje de Macapá", () => {
    expect(diasAntesDeHojeBr(29, NOITE_DE_MACAPA)).toBe("2026-10-01");
    expect(diasAntesDeHojeBr(0, NOITE_DE_MACAPA)).toBe("2026-10-30");
    expect(diasAntesDeHojeBr(89, MANHA_DE_MACAPA)).toBe("2026-08-02");
  });
});

describe("a migração do relógio", () => {
  it("cria a função única e a fecha para o anônimo", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.hoje_br\(\) RETURNS date/);
    expect(SQL).toContain("(now() AT TIME ZONE 'America/Belem')::date");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.hoje_br\(\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.hoje_br\(\) TO authenticated, service_role;/,
    );
  });

  it("troca os quatro padrões de coluna que gravavam a data de Greenwich", () => {
    for (const [tabela, coluna] of [
      ["caixa_movimentos", "data"],
      ["contas_bancarias", "saldo_inicial_data"],
      ["contas_pagar", "vencimento"],
      ["produto_concorrentes", "coletado_em"],
    ]) {
      expect(SQL).toContain(
        `ALTER TABLE public.${tabela} ALTER COLUMN ${coluna} SET DEFAULT public.hoje_br();`,
      );
    }
  });

  it("transforma o que está vivo, para na primeira troca que não conhece e confere o resultado", () => {
    expect(SQL).toContain("pg_get_functiondef");
    expect(SQL).toContain("RAISE EXCEPTION '% tem % ocorrência(s) de [%], esperava %'");
    expect(SQL).toContain("current_date ainda em funções");
    expect(SQL).toContain("current_date ainda em visões");
  });

  it("devolve as opções das visões (security_invoker) em vez de abri-las", () => {
    expect(SQL).toContain("array_to_string(alvo.reloptions, ', ')");
  });

  it("o atraso da OS compara data com data, não com o instante", () => {
    expect(SQL).toContain('"prazo_entrega < now()", "prazo_entrega < public.hoje_br()"');
    expect(SQL).toContain('"os.prazo_entrega < now()", "os.prazo_entrega < public.hoje_br()"');
  });

  it("o estorno, o resumo de parceiro e o contador datam pelo dia de Macapá", () => {
    expect(SQL).toContain("(c.created_at AT TIME ZONE 'America/Belem')::date");
    expect(SQL).toContain("(max(o.created_at) AT TIME ZONE 'America/Belem')::date");
  });
});

/** Tira os comentários `--` para que explicar o defeito num comentário não reprove a migração. */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

describe("nada novo volta a ler o relógio do servidor", () => {
  const depois = readdirSync(PASTA_MIGRACOES)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > MIGRACAO.slice(0, 14))
    .sort();

  it("migração posterior não usa current_date, nem compara a data com now()", () => {
    for (const nome of depois) {
      const sql = semComentarios(readFileSync(join(PASTA_MIGRACOES, nome), "utf8"));
      expect(sql, `${nome} usa current_date: use public.hoje_br()`).not.toMatch(
        /\bcurrent_date\b/i,
      );
      expect(sql, `${nome} compara prazo/vencimento com now(): use public.hoje_br()`).not.toMatch(
        /\b(prazo_entrega|vencimento|data_vencimento)\s*(<|<=|>|>=)\s*now\(\)/i,
      );
    }
  });

  it("migração posterior não usa timestamptz::date sem o fuso de Macapá", () => {
    for (const nome of depois) {
      const sql = semComentarios(readFileSync(join(PASTA_MIGRACOES, nome), "utf8"));
      expect(sql, `${nome}: use (coluna AT TIME ZONE 'America/Belem')::date`).not.toMatch(
        /\b(created_at|updated_at|pago_em|aprovado_em|enviado_em)\s*\)?::date/i,
      );
    }
  });
});

function arquivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDe(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

describe("a tela não pergunta a data a Greenwich", () => {
  const fontes = arquivosDe(join(RAIZ, "src")).filter((f) => !f.endsWith("src/lib/hoje-br.ts"));

  it("ninguém monta o 'hoje' ou o 'mês atual' com new Date().toISOString()", () => {
    const hoje = /new Date\(\)\.toISOString\(\)\.(slice|substring)\(\s*0\s*,\s*(7|10)\s*\)/;
    const janela =
      /new Date\(\s*Date\.now\(\)\s*-[^)]*\)\.toISOString\(\)\.(slice|substring)\(\s*0\s*,\s*10\s*\)/;
    const culpados = fontes.filter((f) => {
      const texto = readFileSync(f, "utf8");
      return hoje.test(texto) || janela.test(texto);
    });
    expect(culpados.map((f) => f.replace(RAIZ + "/", ""))).toEqual([]);
  });
});
