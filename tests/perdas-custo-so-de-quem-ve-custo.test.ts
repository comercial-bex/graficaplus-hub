import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * PERDA: O CUSTO SÓ VALE, E SÓ SE LÊ, DE QUEM VÊ CUSTO.
 *
 * Toda perda com OS vira custo da OS (gatilho DEFINER). Até 15/10/2026 a tela
 * /perdas abria para toda a equipe com o campo "Custo unitário": o que fosse
 * digitado virava custo da OS. A regra "os_perdas write" era FOR ALL, então
 * quem mexe na OS também alterava e apagava perda pela API (a perda sumia, o
 * custo e a baixa ficavam). E a tabela entregava custo_unitario/custo_total
 * a toda a equipe — custo total ÷ quantidade é o custo do material, que a
 * tabela `materiais` esconde de quem não vê financeiro.
 *
 * Ensaiado com contas simuladas: o Leonardo (sem financeiro) digitando R$ 500
 * lançava R$ 500 na OS; depois, o banco usa o custo do cadastro (R$ 16,23) e o
 * custo sai com autor. Ninguém altera nem apaga. O custo se lê só pela view
 * os_perdas_financeiro (is_staff E can_see_financials), como em materiais.
 *
 * Migrações 20261015171000 (gatilho, regra, view, grants) e 20261015172000
 * (as colunas de custo saem do SELECT — depois de publicar a tela nova, que
 * não pede mais `*`).
 */

const RAIZ = join(__dirname, "..");
const PASTA = join(RAIZ, "supabase/migrations");
const PARTE1 = "20261015171000_perdas_custo_so_de_quem_ve_custo.sql";
const PARTE2 = "20261015172000_perdas_colunas_de_custo_fora_do_grant.sql";
// Quem abriu a escrita: o grant de tudo (04/08) e a regra ALL (20/08).
const LEGADO = new Set([
  "20260804134120_a026e426-b651-4ef3-957b-d614c08725ba.sql",
  "20260820160000_rls_honrar_permissoes_dos_papeis.sql",
]);

const migracoes = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA, f), "utf8").replace(/--[^\n]*/g, "") }));

function regras(sql: string) {
  const re = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?os_perdas\b([\s\S]*?);/gi;
  return [...sql.matchAll(re)].map((m) => ({
    nome: m[1],
    comando: (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[2])?.[1] ?? "ALL").toUpperCase(),
    corpo: m[2],
  }));
}

function grants(sql: string) {
  // [^;] para não atravessar comandos: "os_perdas_financeiro" começa com "os_perdas".
  const re = /GRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?os_perdas\s+TO\s+([^;]+);/gi;
  return [...sql.matchAll(re)].map((m) => ({ privilegios: m[1].replace(/\s+/g, " ").trim(), para: m[2].trim() }));
}

function ultimaFuncao(nome: string) {
  const cabeca = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${nome}\\s*\\(`, "gi");
  const todas: string[] = [];
  for (const { sql } of migracoes) {
    for (const m of sql.matchAll(cabeca)) {
      const corpo = /\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(sql.slice(m.index! + m[0].length));
      if (corpo) todas.push(corpo[2]);
    }
  }
  return todas.at(-1);
}

const sqlParte1 = migracoes.find((m) => m.arquivo === PARTE1)!.sql;
const sqlParte2 = migracoes.find((m) => m.arquivo === PARTE2)!.sql;

describe("banco: perda registrada pela tela, custo de quem vê custo", () => {
  it("o gatilho põe o autor da sessão e ignora o custo digitado por quem não vê financeiro", () => {
    const corpo = ultimaFuncao("tg_perda_custo_do_material");
    expect(corpo).toBeDefined();
    expect(corpo).toMatch(/if tg_op = 'INSERT' and v_uid is not null then\s+new\.created_by := v_uid;/);
    expect(corpo).toMatch(
      /if v_uid is not null and not public\.can_see_financials\(v_uid\) then\s+new\.custo_unitario := 0;/,
    );
    // A ordem importa: zerar ANTES do "se veio custo, aceita".
    expect(corpo!.indexOf("new.custo_unitario := 0")).toBeLessThan(
      corpo!.indexOf("if coalesce(new.custo_unitario, 0) > 0 then return new;"),
    );
  });

  it("a regra ALL sai; fica só registrar (INSERT), com a mesma condição de antes", () => {
    expect(sqlParte1).toMatch(/DROP POLICY IF EXISTS "os_perdas write" ON public\.os_perdas;/);
    const r = regras(sqlParte1);
    expect(r.map((x) => `${x.nome}:${x.comando}`)).toEqual(["perdas: registra quem mexe na OS:INSERT"]);
    expect(r[0].corpo).toContain("'os.update'");
    expect(r[0].corpo).toContain("'custos.create'");
  });

  it("nenhuma outra migração cria regra que não seja de leitura ou de registro", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== PARTE1)
      .flatMap(({ arquivo, sql }) => regras(sql).map((r) => ({ arquivo, ...r })))
      .filter((r) => r.comando !== "SELECT" && r.comando !== "INSERT")
      .map((r) => `${r.arquivo}: "${r.nome}" FOR ${r.comando}`);
    expect(culpadas, "perda não se altera nem se apaga pela API").toEqual([]);
  });

  it("nenhum grant dá UPDATE, DELETE, TRUNCATE ou ALL na tabela a anon/authenticated", () => {
    const culpados = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo))
      .flatMap(({ arquivo, sql }) => grants(sql).map((g) => ({ arquivo, ...g })))
      .filter((g) => /\b(anon|authenticated|public)\b/i.test(g.para) && /\b(ALL|UPDATE|DELETE|TRUNCATE)\b/i.test(g.privilegios))
      .map((g) => `${g.arquivo}: GRANT ${g.privilegios}`);
    expect(culpados).toEqual([]);
    expect(sqlParte1).toContain("REVOKE ALL ON public.os_perdas FROM PUBLIC, anon, authenticated;");
  });

  it("o custo se lê pela view os_perdas_financeiro: DEFINER com barreira, só is_staff E can_see_financials", () => {
    const view = /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.os_perdas_financeiro\s+WITH\s*\(([^)]*)\)\s+AS([\s\S]*?);/i.exec(sqlParte1);
    expect(view).not.toBeNull();
    expect(view![1]).toMatch(/security_invoker\s*=\s*false/);
    expect(view![1]).toMatch(/security_barrier\s*=\s*true/);
    expect(view![2]).toMatch(/WHERE public\.is_staff\(\(select auth\.uid\(\)\)\) AND public\.can_see_financials\(\(select auth\.uid\(\)\)\)/);
    expect(sqlParte1).toContain("REVOKE ALL ON public.os_perdas_financeiro FROM PUBLIC, anon, authenticated;");
    expect(sqlParte1).toContain("GRANT SELECT ON public.os_perdas_financeiro TO authenticated;");
  });

  it("o último SELECT concedido na tabela é por coluna, sem custo_unitario nem custo_total", () => {
    expect(sqlParte2).toContain("REVOKE SELECT ON public.os_perdas FROM authenticated;");
    const selects = migracoes
      .flatMap(({ arquivo, sql }) => grants(sql).map((g) => ({ arquivo, ...g })))
      .filter((g) => /\bauthenticated\b/.test(g.para) && /\bSELECT\b/i.test(g.privilegios));
    const ultimo = selects.at(-1)!;
    expect(ultimo.arquivo).toBe(PARTE2);
    expect(ultimo.privilegios).toMatch(/^SELECT \(/);
    expect(ultimo.privilegios).not.toMatch(/custo_unitario|custo_total/);
    expect(ultimo.privilegios).toMatch(/quantidade_perdida/);
  });
});

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !caminho.includes("integrations/supabase/types.ts")) acc.push(caminho);
  }
  return acc;
}

describe("tela: ninguém pede custo à tabela, e o campo de custo é de quem vê financeiro", () => {
  const perdas = readFileSync(join(RAIZ, "src/routes/_authenticated/perdas.tsx"), "utf8");
  const materiais = readFileSync(join(RAIZ, "src/routes/_authenticated/materiais.tsx"), "utf8");

  it("nenhum .from('os_perdas') pede `*`, custo_unitario ou custo_total; só /perdas insere; ninguém altera", () => {
    const culpados: string[] = [];
    for (const arquivo of [...arquivosFonte(join(RAIZ, "src")), ...arquivosFonte(join(RAIZ, "supabase/functions"))]) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(/\.from\(\s*["'`]os_perdas["'`]\s*\)([^;]{0,300})/g)) {
        const rel = arquivo.replace(RAIZ + "/", "");
        const sel = /\.select\(\s*([^)]*)\)/.exec(m[1])?.[1] ?? "";
        if (/\*|custo_unitario|custo_total/.test(sel)) culpados.push(`${rel}: select(${sel.trim()})`);
        if (/\.(update|upsert|delete)\s*\(/.test(m[1])) culpados.push(`${rel}: altera/apaga`);
        if (/\.insert\s*\(/.test(m[1]) && !rel.endsWith("routes/_authenticated/perdas.tsx")) culpados.push(`${rel}: insere`);
      }
    }
    expect(
      culpados,
      'os_perdas não entrega custo a ninguém logado: `*` ou coluna de custo derruba a consulta inteira. Custo vem de "os_perdas_financeiro", só para quem vê financeiro.',
    ).toEqual([]);
  });

  it("/perdas: a lista usa as colunas sem custo, e o custo vem da view só com canSeeFinancials", () => {
    const colunas = /const COLUNAS_SEM_CUSTO =\s*"([^"]+)"/.exec(perdas)?.[1];
    expect(colunas).toBeDefined();
    expect(colunas).not.toMatch(/custo|\*/);
    expect(perdas).toMatch(/\.from\("os_perdas"\)\s*\.select\(`\$\{COLUNAS_SEM_CUSTO\},/);
    expect(perdas).toMatch(/queryKey: \["os-perdas-custo", canSeeFinancials\],\s*enabled: canSeeFinancials,/);
    expect(perdas).toMatch(/custo_unitario: canSeeFinancials \? Number\(form\.custo_unitario\) \|\| 0 : 0,/);
    // O campo só aparece para quem vê financeiro.
    expect(perdas).toMatch(/\{canSeeFinancials \? \(\s*<div className="space-y-2">\s*<Label[^>]*>Custo unitário \(R\$\)/);
  });

  it("/materiais: custo de perda pela view para quem vê financeiro; os demais pedem só a quantidade", () => {
    expect(materiais).toMatch(/\.from\(canSeeFinancials \? "os_perdas_financeiro" : "os_perdas"\)/);
    expect(materiais).toMatch(/: "material_id, quantidade_perdida",/);
  });
});
