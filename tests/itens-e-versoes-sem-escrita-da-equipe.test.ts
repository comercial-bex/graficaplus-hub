import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ITEM DE OS E DE ORÇAMENTO: A EQUIPE LÊ, SÓ QUEM MEXE NA VENDA GRAVA.
 * VERSÃO DE ORÇAMENTO: SÓ A FUNÇÃO GRAVA.
 *
 * Em 31/05/2026 duas migrações com o mesmo prefixo se atropelaram: uma trocou
 * "itens_os staff all" e "orc_itens staff all" (ALL is_staff) por regras por
 * permissão, e a outra, que roda depois por ordem alfabética, recriou as duas.
 * A intenção dela era a equipe LER item; ALL também abre gravação. Ensaiado em
 * 08/10/2026: o Sergio (operador) mudava o preço do item da OS 49 (total de
 * R$ 100 para R$ 1), apagava o item, mudava o total do orçamento 75 de R$ 700
 * para R$ 1 e criava uma "versão 99" que a aprovar_orcamento aprovava no lugar
 * da verdadeira.
 *
 * A migração 20261008043700 deixa a leitura com a equipe (o dinheiro já fica
 * de fora pelo grant por coluna e pelas views), a gravação com as regras por
 * permissão que já existiam (kanban.move ou orcamentos.create) e fecha a
 * versão do orçamento a quem não é a aprovar_orcamento.
 *
 * Este teste segura o que o repositório pode vir a mudar: a migração refeita
 * sem a trava, uma migração nova que recrie a regra ALL da equipe, um REVOKE
 * do authenticated que apague os grants por coluna (e mate a lista de itens
 * de todo mundo), e a aba Itens da OS voltando a mostrar os botões a quem a
 * regra recusa.
 */

const RAIZ = join(__dirname, "..");
const PASTA_MIGRACOES = join(RAIZ, "supabase/migrations");
const ESTA = "20261008043700_itens_e_versoes_sem_escrita_da_equipe.sql";
const ITENS = ["itens_os", "orcamento_itens"] as const;
const VERSOES = ["orcamento_versoes", "orcamento_versao_itens"] as const;
const TABELAS = [...ITENS, ...VERSOES] as const;
type Tabela = (typeof TABELAS)[number];

// As migrações que criaram (e recriaram) as regras ALL is_staff. É o passado
// que ESTA desfaz; nenhuma outra pode repetir aquilo.
const LEGADO = new Set([
  "20260531172858_70c34c0f-bf50-43ba-bd7e-94186ba5ee46.sql",
  "20260531203000_separate_financial_rls_views.sql",
  "20260711152743_58a66792-5467-4896-a8cc-8b0d1ef60107.sql",
]);

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

const migracoes = readdirSync(PASTA_MIGRACOES)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(PASTA_MIGRACOES, f), "utf8") }));

const sqlDesta = readFileSync(join(PASTA_MIGRACOES, ESTA), "utf8");
const codigoDesta = semComentarios(sqlDesta);
const regrasDesta = regras(ESTA, sqlDesta);

describe("migração 20261008043700: item e versão sem escrita da equipe", () => {
  it("tira as quatro regras ALL de is_staff e só cria regras de leitura", () => {
    expect(codigoDesta).toContain('DROP POLICY IF EXISTS "itens_os staff all" ON public.itens_os;');
    expect(codigoDesta).toContain('DROP POLICY IF EXISTS "orc_itens staff all" ON public.orcamento_itens;');
    expect(codigoDesta).toContain('DROP POLICY IF EXISTS "orc_versoes staff all" ON public.orcamento_versoes;');
    expect(codigoDesta).toContain(
      'DROP POLICY IF EXISTS "orc_versoes_itens staff all" ON public.orcamento_versao_itens;',
    );
    expect(regrasDesta.map((r) => `${r.tabela}:${r.comando}`)).toEqual([
      "itens_os:SELECT",
      "orcamento_itens:SELECT",
      "orcamento_versoes:SELECT",
      "orcamento_versao_itens:SELECT",
    ]);
    for (const r of regrasDesta) expect(r.corpo).toMatch(/TO\s+authenticated/);
  });

  it("item: a equipe lê; a regra de gravação por permissão fica intocada", () => {
    for (const tabela of ITENS) {
      const [leitura] = regrasDesta.filter((r) => r.tabela === tabela);
      expect(leitura.corpo).toContain("public.is_staff((select auth.uid()))");
    }
    // Quem grava é quem já podia: kanban.move ou orcamentos.create (item da
    // OS) e orcamentos.create (item do orçamento). Mexer nelas aqui mudaria
    // quem vende, não quem lê.
    expect(codigoDesta).not.toMatch(/"itens_os permission all"/);
    expect(codigoDesta).not.toMatch(/"orc_itens permission all"/);
  });

  it("versão: lê quem vê preço, porque a versão guarda o orçamento inteiro com valor", () => {
    for (const tabela of VERSOES) {
      const [leitura] = regrasDesta.filter((r) => r.tabela === tabela);
      expect(leitura.corpo).toContain("public.can_see_prices((select auth.uid()))");
      expect(leitura.corpo).not.toMatch(/is_staff/);
    }
  });

  it("versão: tira todo privilégio de anon e authenticated e devolve só SELECT", () => {
    for (const tabela of VERSOES) {
      expect(codigoDesta).toContain(`REVOKE ALL ON public.${tabela} FROM PUBLIC, anon, authenticated;`);
      expect(codigoDesta).toContain(`GRANT SELECT ON public.${tabela} TO authenticated;`);
    }
  });

  it("item: tira o anon, mas NÃO mexe no grant do authenticated (SELECT por coluna)", () => {
    for (const tabela of ITENS) {
      expect(codigoDesta).toContain(`REVOKE ALL ON public.${tabela} FROM PUBLIC, anon;`);
      // REVOKE do authenticated na tabela apaga também os grants por coluna:
      // as views invoker (itens_os_operacional, orcamento_itens_operacional...)
      // morreriam inteiras e a lista de itens sumiria para todo mundo.
      const revogaAuthenticated = new RegExp(
        `REVOKE[^;]*ON\\s+(?:TABLE\\s+)?public\\.${tabela}\\b[^;]*\\bauthenticated\\b`,
        "i",
      );
      expect(codigoDesta).not.toMatch(revogaAuthenticated);
    }
  });
});

describe("nenhuma outra migração reabre a escrita da equipe", () => {
  it("regra com is_staff nessas tabelas é só de leitura, e versão não ganha regra de escrita", () => {
    const culpadas = migracoes
      .filter(({ arquivo }) => !LEGADO.has(arquivo) && arquivo !== ESTA)
      .flatMap(({ arquivo, sql }) => regras(arquivo, sql))
      .filter(
        (r) =>
          (r.comando !== "SELECT" && /is_staff/.test(r.corpo)) ||
          ((VERSOES as readonly string[]).includes(r.tabela) && r.comando !== "SELECT"),
      )
      .map((r) => `${r.arquivo}: "${r.nome}" ON ${r.tabela} FOR ${r.comando}`);
    expect(
      culpadas,
      `Gravar item é de quem mexe na venda (kanban.move/orcamentos.create); versão só a aprovar_orcamento grava. A migração ${ESTA} fechou:\n  ${culpadas.join("\n  ")}`,
    ).toEqual([]);
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

describe("a tela", () => {
  const telaDaOS = readFileSync(join(RAIZ, "src/routes/_authenticated/os.$id.tsx"), "utf8");

  it("a aba Itens da OS só mostra incluir/apagar a quem a regra deixa gravar", () => {
    expect(telaDaOS).toContain(
      'podeEditarItens={hasPermission("kanban.move") || hasPermission("orcamentos.create")}',
    );
    expect(telaDaOS).toMatch(/\{podeEditarItens && \(\s*<>\s*<div className="flex justify-end">\s*<ProdutoAutocomplete/);
    expect(telaDaOS).toMatch(/\{podeEditarItens && \(\s*<Button variant="ghost" size="icon" onClick=\{\(\) => remove\(i\.id\)\}>/);
  });

  it("apagar item confere o erro e as linhas apagadas (a regra recusa em silêncio)", () => {
    const remove = /async function remove\(id: string\) \{([\s\S]*?)\n  \}/.exec(telaDaOS)?.[1] ?? "";
    expect(remove).toMatch(/\.from\("itens_os"\)\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
    expect(remove).toMatch(/if \(error\)/);
    expect(remove).toMatch(/data\.length === 0/);
  });

  it("ninguém grava versão de orçamento direto (só a aprovar_orcamento)", () => {
    const culpados: string[] = [];
    const re = new RegExp(`\\.from\\(\\s*["'\`](${VERSOES.join("|")})["'\`]\\s*\\)([^;]{0,400})`, "g");
    for (const arquivo of [
      ...arquivosFonte(join(RAIZ, "src")),
      ...arquivosFonte(join(RAIZ, "supabase/functions")),
    ]) {
      for (const m of readFileSync(arquivo, "utf8").matchAll(re)) {
        if (/\.(insert|update|upsert|delete)\s*\(/.test(m[2]))
          culpados.push(`${arquivo.replace(RAIZ + "/", "")} (${m[1]})`);
      }
    }
    expect(culpados).toEqual([]);
  });
});
