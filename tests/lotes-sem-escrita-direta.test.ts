import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * LOTE DE MATERIAL SÓ SE GRAVA POR FUNÇÃO, E SÓ LÊ QUEM VÊ CUSTO.
 *
 * Até 07/10/2026 `material_lotes` tinha uma regra ALL aberta por `is_staff`:
 * qualquer pessoa da equipe (operador, designer, instalador, vendedor) lia os
 * lotes com o preço de compra e criava, alterava e apagava lote direto pela
 * API. Ensaiado com as contas do Leonardo e do Sergio: liam os 7 lotes
 * (R$ 3.559,98 em custo) e gravavam. Mexer no lote mexe no saldo do material e
 * no custo que a baixa lança na OS.
 *
 * Quem grava lote de verdade são funções SECURITY DEFINER (entrada, saída,
 * ajuste, baixa, estorno e os gatilhos de estoque): rodam como dona da tabela
 * e não precisam de regra nem de grant. A migração 20261007201500 tirou a
 * regra de escrita e os grants de escrita, e trocou a leitura por "quem vê
 * custo" (estoque.cost.read ou can_see_financials).
 *
 * Este teste segura o que o repositório pode vir a mudar: a migração refeita
 * sem a trava, uma migração nova que reabra a escrita, ou uma tela que passe a
 * gravar lote direto (ela levaria "permission denied" em produção). O
 * comportamento foi provado no banco (claims + SET LOCAL ROLE, 6 contas, antes
 * e depois, tudo desfeito).
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261007201500_lotes_sem_escrita_direta.sql";

// A migração que criou a tabela com a regra ALL e o grant de escrita. É o
// passado que ESTA desfaz; nenhuma outra pode repetir aquilo.
const LEGADO = new Set(["20260711153521_c09581ca-e4ee-48d2-b585-050202e7dc5b.sql"]);

/** SQL sem comentários de linha: o cabeçalho explica a regra antiga e não conta. */
function semComentarios(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

type Regra = { arquivo: string; nome: string; comando: string; corpo: string };

function regrasDeLote(arquivo: string, sql: string): Regra[] {
  const re = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?material_lotes\b([\s\S]*?);/gi;
  return [...semComentarios(sql).matchAll(re)].map((m) => ({
    arquivo,
    nome: m[1],
    // Sem FOR, a regra vale para tudo (ALL).
    comando: (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[2])?.[1] ?? "ALL").toUpperCase(),
    corpo: m[2],
  }));
}

type Grant = { arquivo: string; privilegios: string; para: string };

function grantsDeLote(arquivo: string, sql: string): Grant[] {
  const re = /GRANT\s+([\s\S]*?)\s+ON\s+(?:TABLE\s+)?(?:public\.)?material_lotes\b\s+TO\s+([^;]+);/gi;
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

describe("migração 20261007201500: lote sem escrita direta", () => {
  it("tira a regra ALL de is_staff e não cria regra de escrita nenhuma", () => {
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "estoque canon write" ON public\.material_lotes;/);
    expect(codigoDesta).toMatch(/DROP POLICY IF EXISTS "estoque canon read" ON public\.material_lotes;/);
    const regras = regrasDeLote(ESTA, sqlDesta);
    expect(regras.map((r) => r.comando)).toEqual(["SELECT"]);
  });

  it("lê lote só quem vê custo, pelas mesmas portas de `materiais`", () => {
    const [leitura] = regrasDeLote(ESTA, sqlDesta);
    expect(leitura.nome).toBe("lotes: le quem ve custo");
    expect(leitura.corpo).toMatch(/TO\s+authenticated/);
    expect(leitura.corpo).toContain("public.has_permission((select auth.uid()), 'estoque.cost.read')");
    expect(leitura.corpo).toContain("public.can_see_financials((select auth.uid()))");
    // Lote traz o preço de compra em toda linha: ser da equipe, ou só ter a
    // chave de LER estoque, não abre custo.
    expect(leitura.corpo).not.toMatch(/is_staff/);
    expect(leitura.corpo).not.toMatch(/'estoque\.read'/);
  });

  it("tira todo privilégio de anon e authenticated e devolve só SELECT, sem lista de colunas", () => {
    // REVOKE de PUBLIC sozinho não fecha: no Supabase anon e authenticated
    // têm grant próprio.
    expect(codigoDesta).toMatch(
      /REVOKE ALL ON public\.material_lotes FROM PUBLIC, anon, authenticated;/,
    );
    const grants = grantsDeLote(ESTA, sqlDesta);
    expect(grants, "um grant só, de leitura, para authenticated").toEqual([
      { arquivo: ESTA, privilegios: "SELECT", para: "authenticated" },
    ]);
    // SELECT por coluna sem as de custo mataria a vw_resultado_os INTEIRA
    // (view security_invoker que cita custo_unitario_snapshot), inclusive
    // para o admin. Ensaiado em 07/10/2026. Quem não vê custo não vê a LINHA.
    expect(codigoDesta).not.toMatch(/GRANT\s+SELECT\s*\(/i);
  });
});

describe("nenhuma outra migração reabre a escrita em material_lotes", () => {
  it("toda regra de acesso nova em material_lotes é de leitura e não usa is_staff", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => regrasDeLote(arquivo, sql))
      .filter((r) => r.comando !== "SELECT" || /is_staff/.test(r.corpo))
      .map((r) => `${r.arquivo}: "${r.nome}" FOR ${r.comando}`);
    expect(
      culpadas,
      `Lote só se grava por função SECURITY DEFINER; regra de escrita (ou leitura por is_staff) reabre o que a migração ${ESTA} fechou:\n  ${culpadas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nenhum grant novo dá escrita em material_lotes a anon ou authenticated", () => {
    const culpados = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo))
      .flatMap(({ arquivo, sql }) => grantsDeLote(arquivo, sql))
      .filter(
        (g) =>
          /\b(anon|authenticated|public)\b/i.test(g.para) &&
          /\b(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(g.privilegios),
      )
      .map((g) => `${g.arquivo}: GRANT ${g.privilegios} TO ${g.para}`);
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

describe("a tela e as edge functions não gravam lote direto", () => {
  it("nenhum .from('material_lotes') seguido de insert, update, upsert ou delete", () => {
    const culpados: string[] = [];
    for (const arquivo of [
      ...arquivosFonte(join(RAIZ, "src")),
      ...arquivosFonte(join(RAIZ, "supabase/functions")),
    ]) {
      const texto = readFileSync(arquivo, "utf8");
      const re = /\.from\(\s*["'`]material_lotes["'`]\s*\)([^;]{0,400})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto))) {
        if (/\.(insert|update|upsert|delete)\s*\(/.test(m[1])) culpados.push(arquivo.replace(RAIZ + "/", ""));
      }
    }
    expect(
      culpados,
      `Grave lote pelas funções de estoque (registrar_entrada_material, registrar_saida_material, ajustar_estoque_material, baixar_estoque_os, estornar_baixa_estoque_os). A tabela recusa escrita direta:\n  ${culpados.join("\n  ")}`,
    ).toEqual([]);
  });
});
