import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * CUSTO LÍQUIDO ZERO NÃO É "CUSTO LANÇADO".
 *
 * O estorno de baixa (20261008100000) lança a linha NEGATIVA espelho em
 * custos_operacionais_os. Depois de um estorno total a OS tem linhas que
 * somam R$ 0,00 — e três lugares perguntavam "existe linha?" em vez de
 * "existe custo?": a vw_resultado_os e a rel_lucro_por_os marcavam
 * custo_lancado = true com margem realizada de 100%, e a fechar_os deixava a
 * OS fechar sem a trava "custos_operacionais". Ensaiado em 15/10/2026 na OS
 * 49 como o gestor: antes, margem 100% e fechamento livre; depois, a tela
 * mostra o aviso "sem custo", a margem fica vazia e o fechamento trava.
 *
 * Este teste lê a ÚLTIMA definição de cada objeto entre todas as migrações —
 * é ela que vale no banco depois de aplicar tudo em ordem. Uma migração nova
 * que recrie a view a partir de uma cópia antiga (sem o NULLIF), ou sem
 * security_invoker (CREATE OR REPLACE VIEW sem o WITH troca as opções e a
 * view passa a rodar como dona, furando a RLS), fica vermelha aqui.
 */

const PASTA = join(__dirname, "..", "supabase/migrations");
const migracoes = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA, f), "utf8").replace(/--[^\n]*/g, "") }));

/** Última CREATE [OR REPLACE] VIEW de `nome`, com o arquivo onde está. */
function ultimaView(nome: string) {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:public\\.)?${nome}\\b([\\s\\S]*?);`, "gi");
  const todas = migracoes.flatMap(({ arquivo, sql }) => [...sql.matchAll(re)].map((m) => ({ arquivo, corpo: m[1] })));
  return todas.at(-1);
}

/** Última CREATE [OR REPLACE] FUNCTION de `nome`, com o corpo entre as aspas de dólar. */
function ultimaFuncao(nome: string) {
  const todas: { arquivo: string; corpo: string }[] = [];
  const cabeca = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${nome}\\s*\\(`, "gi");
  for (const { arquivo, sql } of migracoes) {
    for (const m of sql.matchAll(cabeca)) {
      const resto = sql.slice(m.index! + m[0].length);
      const corpo = /\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(resto);
      if (corpo) todas.push({ arquivo, corpo: corpo[2] });
    }
  }
  return todas.at(-1);
}

describe("custo estornado não conta como custo lançado", () => {
  it("vw_resultado_os: o realizado é NULLIF(soma, 0) e a view continua security_invoker", () => {
    const v = ultimaView("vw_resultado_os");
    expect(v, "nenhuma migração define vw_resultado_os").toBeDefined();
    expect(v!.corpo).toMatch(/WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    expect(v!.corpo).toMatch(/realizado\s+AS\s*\(\s*SELECT\s+co\.os_id,\s*NULLIF\(sum\(co\.total\),\s*\(0\)::numeric\)\s+AS\s+total/i);
    // O resto da view já trata NULL como "sem custo": é isso que acende o
    // aviso da aba Financeiro e tira a OS da conta "OS com custo" do painel.
    expect(v!.corpo).toMatch(/\(rl\.total IS NOT NULL\) AS custo_lancado/);
  });

  it("rel_lucro_por_os (Relatórios): o mesmo NULLIF, security_invoker", () => {
    const v = ultimaView("rel_lucro_por_os");
    expect(v).toBeDefined();
    expect(v!.corpo).toMatch(/WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    expect(v!.corpo).toMatch(/NULLIF\(sum\(co1\.total\),\s*\(0\)::numeric\)\s+AS\s+custos_lancados/i);
  });

  it("fechar_os: a trava de custo olha a SOMA, não a existência de linha", () => {
    const f = ultimaFuncao("fechar_os");
    expect(f, "nenhuma migração define fechar_os").toBeDefined();
    expect(f!.corpo).toMatch(
      /COALESCE\(\(SELECT SUM\(co\.total\) FROM public\.custos_operacionais_os co\s+WHERE co\.os_id = fechar_os\.os_id\), 0\) <= 0\s+THEN v_bloqueios := v_bloqueios \|\| '"custos_operacionais"'/,
    );
    expect(f!.corpo).not.toMatch(/NOT EXISTS \(SELECT 1 FROM public\.custos_operacionais_os/);
  });
});
