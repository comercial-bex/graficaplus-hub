import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * RESERVA, INVENTÁRIO E PREVISÃO DE MATERIAL SÓ SE GRAVAM POR FUNÇÃO.
 *
 * Até 07/10/2026 `estoque_reservas`, `estoque_inventarios` e
 * `os_materiais_previstos` tinham uma regra ALL aberta por `is_staff` e grant
 * de escrita para anon e authenticated. Ensaiado com a conta do Sergio
 * (operador): criava reserva direto pela API, e a `baixar_estoque_os` baixa o
 * que está reservado — uma reserva falsa de 10 m² fez a baixa do gestor tirar
 * 12 m² do estoque e lançar R$ 194,76 de custo na OS, em vez de 2 m² e
 * R$ 32,46. Também forjava e apagava o registro do ajuste de inventário, e lia
 * e gravava o custo previsto de material da OS.
 *
 * Quem grava de verdade são funções SECURITY DEFINER (reservar, baixar,
 * ajustar inventário, gerar e recalcular a previsão): rodam como dona da
 * tabela e não precisam de regra nem de grant. A migração 20261007221500 tirou
 * as regras de escrita e os grants de escrita, e deixou a leitura assim:
 *   reservas   → a equipe (o card "Materiais da OS" mostra "reservado" a quem
 *                produz; a linha não tem custo, o custo vem do lote)
 *   inventário → quem lê movimentação de estoque
 *   previstos  → quem vê custo (estoque.cost.read ou can_see_financials)
 *
 * Este teste segura o que o repositório pode vir a mudar: a migração refeita
 * sem a trava, uma migração nova que reabra a escrita, ou uma tela que passe a
 * gravar direto (ela levaria "permission denied" em produção). O
 * comportamento foi provado no banco (claims + SET LOCAL ROLE, 6 contas, antes
 * e depois, tudo desfeito).
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261007221500_reservas_inventario_previstos_sem_escrita_direta.sql";
const TABELAS = ["estoque_reservas", "estoque_inventarios", "os_materiais_previstos"] as const;
type Tabela = (typeof TABELAS)[number];

// A migração que criou as regras ALL e os grants de escrita. É o passado que
// ESTA desfaz; nenhuma outra pode repetir aquilo.
const LEGADO = new Set(["20260711153521_c09581ca-e4ee-48d2-b585-050202e7dc5b.sql"]);

/** SQL sem comentários de linha: o cabeçalho explica a regra antiga e não conta. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

type Regra = { arquivo: string; tabela: Tabela; nome: string; comando: string; corpo: string };

function regras(arquivo: string, sql: string): Regra[] {
  const re = new RegExp(
    `CREATE\\s+POLICY\\s+"([^"]+)"\\s+ON\\s+(?:public\\.)?(${TABELAS.join("|")})\\b([\\s\\S]*?);`,
    "gi",
  );
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    tabela: m[2].toLowerCase() as Tabela,
    nome: m[1],
    // Sem FOR, a regra vale para tudo (ALL).
    comando: (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[3])?.[1] ?? "ALL").toUpperCase(),
    corpo: m[3],
  }));
}

type Grant = { arquivo: string; privilegios: string; alvo: string; para: string };

function grants(arquivo: string, sql: string): Grant[] {
  const re = new RegExp(
    `GRANT\\s+([\\s\\S]*?)\\s+ON\\s+(?:TABLE\\s+)?(?:public\\.)?(${TABELAS.join("|")}|ALL\\s+TABLES\\s+IN\\s+SCHEMA\\s+public)\\b\\s+TO\\s+([^;]+);`,
    "gi",
  );
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    privilegios: m[1].replace(/\s+/g, " ").trim(),
    alvo: m[2].replace(/\s+/g, " ").toLowerCase(),
    para: m[3].replace(/\s+/g, " ").trim(),
  }));
}

const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA_MIGRACOES, f), "utf8") }));

const sqlDesta = readFileSync(join(PASTA_MIGRACOES, ESTA), "utf8");
const codigoDesta = semComentarios(sqlDesta);
const regrasDesta = regras(ESTA, sqlDesta);
const leituraDe = (tabela: Tabela) => regrasDesta.filter((r) => r.tabela === tabela);

describe("migração 20261007221500: reserva, inventário e previsão sem escrita direta", () => {
  it("tira as três regras ALL de is_staff e não cria regra de escrita nenhuma", () => {
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "estoque reservas write" ON public\.estoque_reservas;/);
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "inv staff" ON public\.estoque_inventarios;/);
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "os mat prev staff" ON public\.os_materiais_previstos;/);
    expect(regrasDesta.map((r) => `${r.tabela}:${r.comando}`)).toEqual([
      "estoque_reservas:SELECT",
      "estoque_inventarios:SELECT",
      "os_materiais_previstos:SELECT",
    ]);
    for (const r of regrasDesta) expect(r.corpo).toMatch(/TO\s+authenticated/);
  });

  it("reserva: lê a equipe, porque o card da OS mostra 'reservado' a quem produz e o financeiro precisa do custo reservado", () => {
    const [leitura] = leituraDe("estoque_reservas");
    expect(leitura.nome).toBe("reservas: le a equipe");
    // Restringir à chave de estoque esvaziaria o card para o operador e
    // zeraria, sem erro, o custo reservado da vw_resultado_os para a Cibele
    // (financeiro, sem estoque.read). O custo da reserva vem do lote, que a
    // 20261007201500 já fecha para quem não vê custo.
    expect(leitura.corpo).toContain("public.is_staff((select auth.uid()))");
  });

  it("inventário: lê quem lê movimentação de estoque, não a equipe toda", () => {
    const [leitura] = leituraDe("estoque_inventarios");
    expect(leitura.nome).toBe("inventario: le quem le estoque");
    expect(leitura.corpo).toContain("public.has_permission((select auth.uid()), 'estoque.read')");
    expect(leitura.corpo).toContain("public.has_permission((select auth.uid()), 'estoque.cost.read')");
    expect(leitura.corpo).not.toMatch(/is_staff/);
  });

  it("previsão: lê só quem vê custo, pelas mesmas portas de `materiais` e `material_lotes`", () => {
    const [leitura] = leituraDe("os_materiais_previstos");
    expect(leitura.nome).toBe("previstos: le quem ve custo");
    expect(leitura.corpo).toContain("public.has_permission((select auth.uid()), 'estoque.cost.read')");
    // Sem can_see_financials, o custo previsto da vw_resultado_os zera para o
    // financeiro em silêncio (LEFT JOIN: linha escondida vira zero, não erro).
    expect(leitura.corpo).toContain("public.can_see_financials((select auth.uid()))");
    // Toda linha traz custo_unitario_previsto: ser da equipe, ou só ter a
    // chave de LER estoque, não abre custo.
    expect(leitura.corpo).not.toMatch(/is_staff/);
    expect(leitura.corpo).not.toMatch(/'estoque\.read'/);
  });

  it("tira todo privilégio de anon e authenticated e devolve só SELECT, sem lista de colunas", () => {
    // REVOKE de PUBLIC sozinho não fecha: no Supabase anon e authenticated
    // têm grant próprio.
    for (const tabela of TABELAS) {
      expect(codigoDesta).toContain(`REVOKE ALL ON public.${tabela} FROM PUBLIC, anon, authenticated;`);
    }
    expect(grants(ESTA, sqlDesta), "um grant por tabela, só de leitura, para authenticated").toEqual(
      TABELAS.map((tabela) => ({ arquivo: ESTA, privilegios: "SELECT", alvo: tabela, para: "authenticated" })),
    );
    // SELECT por coluna sem custo_unitario_previsto mataria a vw_resultado_os
    // INTEIRA (view security_invoker que cita a coluna), inclusive para o
    // admin. Quem não vê custo não vê a LINHA.
    expect(codigoDesta).not.toMatch(/GRANT\s+SELECT\s*\(/i);
  });
});

describe("nenhuma outra migração reabre a escrita nessas três tabelas", () => {
  it("toda regra de acesso nova é de leitura, e a da previsão não usa is_staff", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter(
        (r) => r.comando !== "SELECT" || (r.tabela === "os_materiais_previstos" && /is_staff/.test(r.corpo)),
      )
      .map((r) => `${r.arquivo}: "${r.nome}" ON ${r.tabela} FOR ${r.comando}`);
    expect(
      culpadas,
      `Reserva, inventário e previsão só se gravam por função SECURITY DEFINER; regra de escrita (ou previsão lida por is_staff) reabre o que a migração ${ESTA} fechou:\n  ${culpadas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nenhum grant novo dá escrita nelas a anon ou authenticated", () => {
    const culpados = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo))
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

describe("a tela e as edge functions não gravam direto", () => {
  it("nenhum .from(<tabela>) seguido de insert, update, upsert ou delete", () => {
    const culpados: string[] = [];
    const re = new RegExp(`\\.from\\(\\s*["'\`](${TABELAS.join("|")})["'\`]\\s*\\)([^;]{0,400})`, "g");
    for (const arquivo of [
      ...arquivosFonte(join(RAIZ, "src")),
      ...arquivosFonte(join(RAIZ, "supabase/functions")),
    ]) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(re)) {
        if (/\.(insert|update|upsert|delete)\s*\(/.test(m[2]))
          culpados.push(`${arquivo.replace(RAIZ + "/", "")} (${m[1]})`);
      }
    }
    expect(
      culpados,
      `Grave pelas funções: reservar_materiais_os (reserva), baixar_estoque_os (baixa), ajustar_estoque_material (inventário), recalcular_previsao_custos (previsão; a previsão nasce do item da OS). As tabelas recusam escrita direta:\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });
});
