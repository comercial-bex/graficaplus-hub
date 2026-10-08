import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * APONTAMENTO DE PRODUÇÃO SÓ SE GRAVA POR FUNÇÃO.
 *
 * Até 08/10/2026 `apontamentos_producao` tinha três regras FOR ALL (duas de
 * is_staff, uma de producao.start) e grant de escrita para anon e
 * authenticated. Ensaiado com contas simuladas: qualquer pessoa da equipe,
 * até o financeiro, criava, alterava e apagava apontamento direto pela API.
 * Retroagir o início em 6 h fazia o fechamento lançar R$ 86,59 de máquina em
 * vez de R$ 28,86; fechar direto parava o relógio sem lançar custo nenhum.
 *
 * Quem grava de verdade são funções SECURITY DEFINER (iniciar_apontamento,
 * comecar_na_maquina, fechar_apontamento_interno por trás de
 * finalizar/terminar/mandar para acabamento): rodam como dona da tabela e não
 * precisam de regra nem de grant. A migração 20261008052700 tirou as regras e
 * os grants de escrita; a leitura continua para a equipe (a linha não tem
 * dinheiro, e o cartão da OS e o painel de produção leem direto).
 *
 * Este teste segura o que o repositório pode vir a mudar: a migração refeita
 * sem a trava, uma migração nova que reabra a escrita, ou uma tela que passe a
 * gravar direto (ela levaria "permission denied" em produção).
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261008052700_apontamentos_sem_escrita_direta.sql";
const TABELA = "apontamentos_producao";

// As migrações que criaram as regras ALL e os grants de escrita (inclusive o
// grant por coluna de agenda_id). É o passado que ESTA desfaz.
const LEGADO = new Set([
  "20260531203000_relatorios_prioritarios.sql",
  "20260711153521_c09581ca-e4ee-48d2-b585-050202e7dc5b.sql",
  "20260825110000_apontamento_de_producao.sql",
  "20260902110000_agendamento_honesto.sql",
]);

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

type Grant = { arquivo: string; privilegios: string; para: string };

function grants(arquivo: string, sql: string): Grant[] {
  const re = new RegExp(
    `GRANT\\s+([\\s\\S]*?)\\s+ON\\s+(?:TABLE\\s+)?(?:public\\.)?(?:${TABELA}|ALL\\s+TABLES\\s+IN\\s+SCHEMA\\s+public)\\b\\s+TO\\s+([^;]+);`,
    "gi",
  );
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    privilegios: m[1].replace(/\s+/g, " ").trim(),
    para: m[2].replace(/\s+/g, " ").trim(),
  }));
}

const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA_MIGRACOES, f), "utf8") }));

const sqlDesta = readFileSync(join(PASTA_MIGRACOES, ESTA), "utf8");
const codigoDesta = semComentarios(sqlDesta);

describe("migração 20261008052700: apontamento sem escrita direta", () => {
  it("tira as três regras de escrita e não cria regra nenhuma", () => {
    for (const nome of ["apontamento write", "apontamentos staff write", "producao write"]) {
      expect(codigoDesta).toContain(`DROP POLICY IF EXISTS "${nome}" ON public.${TABELA};`);
    }
    expect(regras(ESTA, sqlDesta)).toEqual([]);
  });

  it("não mexe na leitura da equipe: o cartão da OS e o painel de produção leem direto", () => {
    expect(codigoDesta).not.toMatch(/DROP POLICY IF EXISTS "(apontamentos staff read|apontamento read|producao read)"/);
    const leituraDaEquipe = migracoes
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter((r) => r.nome === "apontamentos staff read")
      .at(-1);
    expect(leituraDaEquipe?.comando).toBe("SELECT");
    expect(leituraDaEquipe?.corpo).toMatch(/is_staff/);
  });

  it("tira todo privilégio de anon e authenticated e devolve só SELECT, sem lista de colunas", () => {
    // REVOKE de PUBLIC sozinho não fecha: no Supabase anon e authenticated
    // têm grant próprio. O REVOKE da tabela leva junto o grant de agenda_id.
    expect(codigoDesta).toContain(`REVOKE ALL ON public.${TABELA} FROM PUBLIC, anon, authenticated;`);
    expect(grants(ESTA, sqlDesta)).toEqual([{ arquivo: ESTA, privilegios: "SELECT", para: "authenticated" }]);
  });
});

describe("nenhuma outra migração reabre a escrita no apontamento", () => {
  it("toda regra nova é de leitura", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter((r) => r.comando !== "SELECT")
      .map((r) => `${r.arquivo}: "${r.nome}" FOR ${r.comando}`);
    expect(
      culpadas,
      `Apontamento só se grava por função SECURITY DEFINER (iniciar_apontamento, comecar_na_maquina, finalizar_apontamento…); regra de escrita reabre o que a migração ${ESTA} fechou:\n  ${culpadas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nenhum grant novo dá escrita a anon ou authenticated, nem por coluna", () => {
    const culpados = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo))
      .flatMap(({ arquivo, sql }) => grants(arquivo, sql))
      .filter(
        (g) =>
          /\b(anon|authenticated|public)\b/i.test(g.para) &&
          /\b(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(g.privilegios),
      )
      .map((g) => `${g.arquivo}: GRANT ${g.privilegios} ON ${TABELA} TO ${g.para}`);
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

describe("a tela e as edge functions não gravam apontamento direto", () => {
  it("nenhum .from('apontamentos_producao') seguido de insert, update, upsert ou delete", () => {
    const culpados: string[] = [];
    const re = new RegExp(`\\.from\\(\\s*["'\`]${TABELA}["'\`]\\s*\\)([^;]{0,400})`, "g");
    for (const arquivo of [
      ...arquivosFonte(join(RAIZ, "src")),
      ...arquivosFonte(join(RAIZ, "supabase/functions")),
    ]) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(re)) {
        if (/\.(insert|update|upsert|delete)\s*\(/.test(m[1])) culpados.push(arquivo.replace(RAIZ + "/", ""));
      }
    }
    expect(
      culpados,
      `Grave pelas funções: comecar_na_maquina / iniciar_apontamento (abrir), finalizar_apontamento / terminar_so_esta_maquina / terminar_na_maquina (fechar e lançar o custo). A tabela recusa escrita direta:\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });
});
