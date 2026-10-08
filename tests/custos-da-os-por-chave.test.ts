import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O CUSTO DA OS SE LANÇA PELA ABA FINANCEIRO, E SÓ ASSIM, PELA API.
 *
 * Até 07/10/2026 `custos_operacionais_os` tinha, além da leitura pela chave
 * (custos.read ou resultado.read), uma regra ALL aberta por `is_staff` e grant
 * de tudo para anon e authenticated. ALL vale também para SELECT. Ensaiado
 * com as contas do Leonardo (vendedor+operador) e do Sergio (operador): liam
 * o custo de todas as OS, lançavam custo assinando em nome de outra pessoa e
 * com data retroativa, zeravam e apagavam o custo que a baixa de estoque
 * gravou, e destravavam o fechamento da OS com um lançamento de R$ 0,01.
 *
 * Aqui, diferente das vizinhas de estoque, a TELA grava: o addCusto da aba
 * Financeiro da OS. A migração 20261007233000 deixou a escrita do tamanho da
 * tela:
 *   lança   → quem vê o financeiro (can_see_financials, a porta da aba), em
 *             nome próprio, só as seis colunas que o formulário manda
 *   altera  → ninguém pela API (não há tela que altere)
 *   apaga   → ninguém pela API (não há tela que apague)
 *   lê      → a regra que já existia (custos.read ou resultado.read)
 * Baixa de estoque, apontamento de máquina e perda continuam gravando por
 * função SECURITY DEFINER, que não depende de regra nem de grant.
 *
 * Este teste segura o que o repositório pode vir a mudar: a migração refeita
 * sem a trava, uma migração nova que reabra a escrita, a aba abrindo para
 * outra chave, ou o formulário mandando uma coluna que o grant não cobre (o
 * lançamento levaria "permission denied" em produção). O comportamento foi
 * provado no banco (claims + SET LOCAL ROLE, 6 contas, antes e depois, tudo
 * desfeito).
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261007233000_custos_da_os_por_chave.sql";
const TABELA = "custos_operacionais_os";

// A migração que criou "custos op write" (ALL is_staff) e o grant de escrita.
// É o passado que ESTA desfaz; nenhuma outra pode repetir aquilo.
const LEGADO = new Set(["20260711153521_c09581ca-e4ee-48d2-b585-050202e7dc5b.sql"]);

/** As colunas que o formulário da aba manda e que o grant de INSERT cobre. */
const COLUNAS_DA_TELA = ["categoria", "origem", "os_id", "quantidade", "usuario_id", "valor_unitario"];

/** SQL sem comentários de linha: o cabeçalho explica a regra antiga e não conta. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

type Regra = { arquivo: string; nome: string; comando: string; corpo: string };

function regras(arquivo: string, sql: string): Regra[] {
  const re = new RegExp(`CREATE\\s+POLICY\\s+"([^"]+)"\\s+ON\\s+(?:public\\.)?${TABELA}\\b([\\s\\S]*?);`, "gi");
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    nome: m[1],
    // Sem FOR, a regra vale para tudo (ALL).
    comando: (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[2])?.[1] ?? "ALL").toUpperCase(),
    corpo: m[2],
  }));
}

type Grant = { arquivo: string; privilegios: string; alvo: string; para: string };

function grants(arquivo: string, sql: string): Grant[] {
  const re = new RegExp(
    `GRANT\\s+([\\s\\S]*?)\\s+ON\\s+(?:TABLE\\s+)?(?:public\\.)?(${TABELA}|ALL\\s+TABLES\\s+IN\\s+SCHEMA\\s+public)\\b\\s+TO\\s+([^;]+);`,
    "gi",
  );
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    privilegios: m[1].replace(/\s+/g, " ").trim(),
    alvo: m[2].replace(/\s+/g, " ").toLowerCase(),
    para: m[3].replace(/\s+/g, " ").trim(),
  }));
}

/** "INSERT (a, b, c)" → ["a", "b", "c"], em ordem alfabética. */
function colunasDoGrant(privilegios: string): string[] {
  const m = /^INSERT\s*\(([^)]*)\)$/i.exec(privilegios);
  return m ? m[1].split(",").map((c) => c.trim()).sort() : [];
}

const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA_MIGRACOES, f), "utf8") }));

const sqlDesta = readFileSync(join(PASTA_MIGRACOES, ESTA), "utf8");
const codigoDesta = semComentarios(sqlDesta);
const regrasDesta = regras(ESTA, sqlDesta);
const grantsDesta = grants(ESTA, sqlDesta);

describe("migração 20261007233000: custo da OS lançado por chave", () => {
  it("tira a regra ALL de is_staff e cria uma regra só, de INSERT", () => {
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "custos op write" ON public\.custos_operacionais_os;/);
    expect(regrasDesta.map((r) => `${r.nome}:${r.comando}`)).toEqual(["custos: lanca quem ve o financeiro:INSERT"]);
    expect(regrasDesta[0].corpo).toMatch(/TO\s+authenticated/);
    // Ser da equipe não basta para lançar custo.
    expect(regrasDesta[0].corpo).not.toMatch(/is_staff/);
  });

  it("lança quem vê o financeiro (a porta da aba), e em nome próprio", () => {
    const [lanca] = regrasDesta;
    expect(lanca.corpo).toMatch(/WITH\s+CHECK/i);
    expect(lanca.corpo).toContain("public.can_see_financials((select auth.uid()))");
    // Sem isto, quem lança assina pelo operador (ou por qualquer um).
    expect(lanca.corpo).toContain("usuario_id = (select auth.uid())");
  });

  it("não mexe na leitura: 'custos op read' (custos.read ou resultado.read) continua valendo", () => {
    expect(codigoDesta).not.toMatch(/DROP POLICY IF EXISTS "custos op read"/);
    // A última migração que cria a leitura é a que vale no banco.
    const leitura = migracoes
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter((r) => r.nome === "custos op read")
      .at(-1);
    expect(leitura?.comando).toBe("SELECT");
    expect(leitura?.corpo).toContain("'custos.read'");
    expect(leitura?.corpo).toContain("'resultado.read'");
  });

  it("tira tudo de anon e authenticated e devolve SELECT da tabela e INSERT só das colunas da tela", () => {
    // REVOKE de PUBLIC sozinho não fecha: no Supabase anon e authenticated
    // têm grant próprio.
    expect(codigoDesta).toContain(`REVOKE ALL ON public.${TABELA} FROM PUBLIC, anon, authenticated;`);
    expect(grantsDesta.map((g) => `${g.privilegios.replace(/\s*\(.*$/, "")} TO ${g.para}`)).toEqual([
      "SELECT TO authenticated",
      "INSERT TO authenticated",
    ]);
    // SELECT por coluna mataria as views security_invoker que citam a tabela
    // (vw_resultado_os e companhia) INTEIRAS, inclusive para o admin.
    expect(codigoDesta).not.toMatch(/GRANT\s+SELECT\s*\(/i);
    const [, insert] = grantsDesta;
    expect(colunasDoGrant(insert.privilegios)).toEqual(COLUNAS_DA_TELA);
    expect(codigoDesta).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*custos_operacionais_os/i);
  });
});

describe("nenhuma outra migração reabre a escrita no custo da OS", () => {
  it("toda regra nova é de leitura", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter((r) => r.comando !== "SELECT")
      .map((r) => `${r.arquivo}: "${r.nome}" FOR ${r.comando}`);
    expect(
      culpadas,
      `O custo da OS só se lança pela aba Financeiro (regra "custos: lanca quem ve o financeiro") e por função SECURITY DEFINER; regra de escrita nova reabre o que a migração ${ESTA} fechou:\n  ${culpadas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nenhum grant novo dá escrita a anon ou authenticated", () => {
    const culpados = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => grants(arquivo, sql))
      .filter(
        (g) =>
          /\b(anon|authenticated|public)\b/i.test(g.para) &&
          /\b(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(g.privilegios),
      )
      .map((g) => `${g.arquivo}: GRANT ${g.privilegios} ON ${g.alvo} TO ${g.para}`);
    expect(culpados).toEqual([]);
  });
});

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome) && !caminho.includes("integrations/supabase/types.ts"))
      acc.push(caminho);
  }
  return acc;
}

const TELA_DA_OS = join(RAIZ, "src/routes/_authenticated/os.$id.tsx");

describe("a tela lança pela mesma porta que o banco confere", () => {
  const tela = readFileSync(TELA_DA_OS, "utf8");

  it("o addCusto manda exatamente as colunas do grant, com usuario_id da própria pessoa", () => {
    const m = /async function addCusto\(\)[\s\S]*?\.from\("custos_operacionais_os"\)\.insert\(\{([\s\S]*?)\}\)/.exec(tela);
    expect(m, "addCusto não foi achado em os.$id.tsx").not.toBeNull();
    const campos = [...m![1].matchAll(/^\s*(\w+)\s*:/gm)].map((c) => c[1]).sort();
    expect(
      campos,
      `Coluna nova no formulário de custo precisa entrar no GRANT INSERT (colunas) de ${TABELA}, numa migração nova; sem isso o lançamento leva "permission denied"`,
    ).toEqual(COLUNAS_DA_TELA);
    // A regra exige usuario_id = auth.uid(); a tela manda o id da sessão.
    expect(m![1]).toMatch(/usuario_id:\s*userId\b/);
    expect(tela).toMatch(/<FinanceiroTab osId=\{id\} userId=\{user\?\.id\}/);
  });

  it("a aba Financeiro abre com canSeeFinancials, que é financeiro.read, o mesmo que can_see_financials no banco", () => {
    expect(tela).toMatch(/\{canSeeFinancials && <TabsContent value="financeiro"><FinanceiroTab /);
    const auth = readFileSync(join(RAIZ, "src/lib/auth-context.tsx"), "utf8");
    expect(auth).toMatch(/const canSeeFinancials = hasPermission\("financeiro\.read"\);/);
    // A última definição de can_see_financials é a que vale no banco.
    const definicao = migracoes
      .map(({ sql }) => /CREATE OR REPLACE FUNCTION public\.can_see_financials\([\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(sql)?.[1])
      .filter(Boolean)
      .at(-1);
    expect(definicao).toMatch(/has_permission\(\s*_user_id\s*,\s*'financeiro\.read'\s*\)/);
  });

  it("ninguém em src/ nem nas edge functions altera, apaga ou faz upsert de custo, e só a aba insere", () => {
    const culpados: string[] = [];
    const re = new RegExp(`\\.from\\(\\s*["'\`]${TABELA}["'\`]\\s*\\)([^;]{0,400})`, "g");
    for (const arquivo of [
      ...arquivosFonte(join(RAIZ, "src")),
      ...arquivosFonte(join(RAIZ, "supabase/functions")),
    ]) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(re)) {
        const relativo = arquivo.replace(RAIZ + "/", "");
        if (/\.(update|upsert|delete)\s*\(/.test(m[1])) culpados.push(`${relativo} (altera/apaga)`);
        else if (/\.insert\s*\(/.test(m[1]) && arquivo !== TELA_DA_OS) culpados.push(`${relativo} (insere)`);
      }
    }
    expect(
      culpados,
      `A tabela recusa UPDATE/DELETE pela API; corrigir lançamento pede função SECURITY DEFINER com motivo e rastro. Custo de baixa, máquina e perda nasce das funções (baixar_estoque_os, finalizar_apontamento, gatilho de os_perdas):\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });
});
