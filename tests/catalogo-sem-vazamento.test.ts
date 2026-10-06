import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHAVES_DA_VITRINE } from "../src/domain/catalogo/vitrine";

/**
 * A TRAVA DO CATÁLOGO DE FORNECEDORES.
 *
 * DECISÕES DO DONO (05/10/2026) que estes testes seguram:
 *   - o cliente não vê o nome nem o código do fornecedor, nem o custo;
 *   - custo só para quem vê o financeiro; preço de venda para quem vê preço;
 *   - sem regra de venda o item é "sob consulta", nunca R$ 0,00.
 *
 * A vitrine do cliente (/catalogo/$token) responde a quem não tem login e a
 * rota de servidor usa a chave de serviço, que ignora RLS: o mesmo risco das
 * rotas do portal e da TV. Lê o CÓDIGO sem os comentários — a explicação de
 * um vazamento num comentário não pode reprovar o arquivo que o evita.
 */

const RAIZ = resolve(__dirname, "..");

/**
 * Tira comentários de linha e de bloco, respeitando o que está entre aspas.
 * Cópia do extrator de `portal-rotas-sem-vazamento.test.ts`: importar de um
 * arquivo de teste registraria os testes dele aqui de novo.
 */
function semComentarios(fonte: string): string {
  let saida = "";
  let i = 0;
  let aspas: string | null = null;
  while (i < fonte.length) {
    const c = fonte[i];
    const prox = fonte[i + 1];
    if (aspas) {
      saida += c;
      if (c === "\\") {
        saida += prox ?? "";
        i += 2;
        continue;
      }
      if (c === aspas) aspas = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      aspas = c;
      saida += c;
      i++;
      continue;
    }
    if (c === "/" && prox === "/") {
      while (i < fonte.length && fonte[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && prox === "*") {
      i += 2;
      while (i < fonte.length && !(fonte[i] === "*" && fonte[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    saida += c;
    i++;
  }
  return saida;
}

type Arquivo = { nome: string; codigo: string };

function ler(caminho: string): Arquivo {
  return { nome: caminho, codigo: semComentarios(readFileSync(join(RAIZ, caminho), "utf8")) };
}

function arquivosDe(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    const caminho = `${dir}/${nome}`;
    if (statSync(join(RAIZ, caminho)).isDirectory()) arquivosDe(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const rota = ler("src/routes/api.catalogo.vitrine.ts");
const servidor = ler("src/lib/api/catalogo-link.server.ts");
const pagina = ler("src/routes/catalogo.$token.tsx");
const publicos = [
  pagina,
  ler("src/components/catalogo/cartao-da-vitrine.tsx"),
  ler("src/lib/catalogo-publico.ts"),
  ler("src/domain/catalogo/vitrine.ts"),
];
const novos = [
  ...arquivosDe("src/components/catalogo"),
  ...arquivosDe("src/domain/catalogo"),
  "src/routes/_authenticated/catalogos.index.tsx",
  "src/routes/_authenticated/catalogos.$id.tsx",
  "src/routes/catalogo.$token.tsx",
  "src/routes/api.catalogo.vitrine.ts",
  "src/lib/catalogo-publico.ts",
  "src/lib/api/catalogo-link.server.ts",
].map(ler);

/** `.from(` que não vem logo depois de `.storage`: leitura de tabela. */
function leTabelaDireto(codigo: string): boolean {
  if (/\bsupabaseAdmin\s*\.\s*from\s*\(/.test(codigo)) return true;
  return [...codigo.matchAll(/\.from\s*\(/g)].some(
    (m) => !/\.storage\s*$/.test(codigo.slice(Math.max(0, m.index - 30), m.index)),
  );
}

/** Algum `console.x(...)` recebe credencial como VALOR (fora de texto fixo)? */
function credencialNoConsole(codigo: string): boolean {
  return [...codigo.matchAll(/console\.\w+\(([^;]*)\);/g)]
    .map((m) => m[1].replace(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""'))
    .some((args) => /token|hash|credencial|assinatura|segredo/i.test(args));
}

describe("os detectores acusam quando o defeito existe", () => {
  it("uma trava que nunca dispara é pior que trava nenhuma", () => {
    expect(leTabelaDireto('supabaseAdmin.from("fornecedor_item_custos").select("*")')).toBe(true);
    expect(leTabelaDireto("supabase.storage.from(BUCKET).getPublicUrl(c)")).toBe(false);
    expect(credencialNoConsole('console.error("falhou", hash);')).toBe(true);
    expect(credencialNoConsole('console.error("[catalogo] falhou", r.error.code);')).toBe(false);
    expect(novos.length).toBeGreaterThan(15);
  });
});

describe("a rota da vitrine", () => {
  it("a chave de serviço não entra no pacote do navegador", () => {
    const estaticos = [...rota.codigo.matchAll(/^import\s[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(estaticos).toEqual(["@tanstack/react-router"]);
    expect(rota.codigo).toMatch(/await import\("@\/lib\/api\/catalogo-link\.server"\)/);
    for (const a of publicos) expect(/client\.server|supabaseAdmin/.test(a.codigo), a.nome).toBe(false);
  });

  it("o servidor não lê tabela nem faz select: só chama catalogo_link_abrir, com o hash", () => {
    expect(leTabelaDireto(servidor.codigo)).toBe(false);
    expect(/\.select\s*\(/.test(servidor.codigo)).toBe(false);
    const nomes = [...servidor.codigo.matchAll(/\.rpc\s*(?:as any\s*\))?\s*\(\s*["'`]([a-z0-9_]+)["'`]/g)].map((m) => m[1]);
    expect(nomes).toEqual(["catalogo_link_abrir"]);
    expect(servidor.codigo).toMatch(/const hash = await hashDoSegredo\(token\)/);
    expect(servidor.codigo).toMatch(/\{\s*p_token_hash:\s*hash\s*\}/);
  });

  it("o token vem do cabeçalho, nunca da URL, e não entra em log", () => {
    expect(servidor.codigo).toMatch(/request\.headers\.get\(CABECALHO_DO_CATALOGO\)/);
    for (const a of [rota, servidor]) {
      expect(/request\.url|searchParams/.test(a.codigo), a.nome).toBe(false);
      expect(credencialNoConsole(a.codigo), a.nome).toBe(false);
    }
  });

  it("toda resposta sem cache, e a vitrine passa pela lista fechada antes de sair", () => {
    expect(servidor.codigo).toMatch(/"cache-control":\s*"no-store"/);
    expect([...servidor.codigo.matchAll(/new Response\(/g)]).toHaveLength(1);
    expect(servidor.codigo).toMatch(/const vitrine = vitrineFechada\(data\)/);
    expect(servidor.codigo).toMatch(/return resposta\(200, vitrine\)/);
    // Situação desconhecida nunca vira porta aberta.
    expect(servidor.codigo).toMatch(/if \(situacao !== "aberto"\) return indisponivel\(\)/);
  });
});

describe("o que o cliente vê", () => {
  it("as peças públicas não falam de custo, margem nem fornecedor", () => {
    for (const a of publicos) {
      expect(a.codigo, a.nome).not.toMatch(/custo|margem|fornecedor|\bluga\b/i);
    }
  });

  it("link que não abre recebe a frase combinada, e nada mais", () => {
    expect(pagina.codigo).toMatch(/MENSAGEM_VITRINE_INVALIDA/);
    expect(pagina.codigo).toMatch(/tokenDoCatalogoBemFormado\(token\)/);
    // Falha de rede não é link vencido: a página diferencia os dois.
    expect(pagina.codigo).toMatch(/motivo === "link_invalido"/);
  });
});

/** Linhas de SQL sem os comentários de linha. */
function semComentariosSql(sql: string): string {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

describe("o banco do catálogo (retrato em 20261005200000)", () => {
  const sql = semComentariosSql(
    readFileSync(join(RAIZ, "supabase/migrations/20261005200000_catalogo_de_fornecedores.sql"), "utf8"),
  );
  const tabelas = [
    "fornecedores",
    "fornecedor_catalogos",
    "fornecedor_secoes",
    "fornecedor_fotos",
    "fornecedor_itens",
    "fornecedor_item_modalidades",
    "fornecedor_item_custos",
    "fornecedor_importacoes",
    "fornecedor_item_custos_historico",
    "fornecedor_regras_venda",
    "catalogo_links",
    "catalogo_link_itens",
  ];

  it("toda tabela nasce com RLS e sem acesso de anon", () => {
    for (const t of tabelas) {
      expect(sql, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql, t).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(/GRANT[^;]*\bTO\b[^;]*\b(anon|PUBLIC)\b/i.test(sql)).toBe(false);
  });

  it("custo, histórico de custo, regra e importações só para quem vê o financeiro", () => {
    for (const t of [
      "fornecedor_item_custos",
      "fornecedor_item_custos_historico",
      "fornecedor_regras_venda",
      "fornecedor_importacoes",
    ]) {
      const politicas = [...sql.matchAll(new RegExp(`CREATE POLICY "[^"]+" ON public\\.${t} FOR SELECT[^;]*;`, "g"))];
      expect(politicas.length, t).toBe(1);
      expect(politicas[0][0], t).toMatch(/can_see_financials/);
    }
  });

  it("os links não têm policy nem GRANT: o hash do token não sai do banco", () => {
    for (const t of ["catalogo_links", "catalogo_link_itens"]) {
      expect(new RegExp(`CREATE POLICY [^;]* ON public\\.${t}\\b`).test(sql), t).toBe(false);
      // GRANT de TABELA; a função `catalogo_links(uuid)` tem o mesmo nome e abre, de propósito.
      expect(new RegExp(`GRANT (?!EXECUTE)[^;]*\\bpublic\\.${t}\\b(?!\\()`).test(sql), t).toBe(false);
    }
  });

  it("toda função nasce fechada; a vitrine só para a rota de servidor; as internas para ninguém", () => {
    const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(funcoes.length).toBe(24);
    for (const f of funcoes) {
      expect(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`).test(sql),
        f,
      ).toBe(true);
    }
    const grants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\) TO (\w+);/g)];
    for (const [, f, papel] of grants) {
      if (f === "catalogo_link_abrir") expect(papel, f).toBe("service_role");
      else expect(papel, f).toBe("authenticated");
      expect(f.startsWith("catalogo_"), f).toBe(true);
    }
    expect(grants).toHaveLength(13);
  });

  it("as chaves que catalogo_link_abrir monta estão na lista da vitrine — e custo não está", () => {
    const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.catalogo_link_abrir");
    const corpo = sql.slice(inicio, sql.indexOf("$f$;", inicio));
    const chaves = new Set([...corpo.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1]));
    const permitidas = new Set([...Object.values(CHAVES_DA_VITRINE).flat(), "situacao"]);
    for (const c of chaves) {
      if (["aberto", "invalido", "revogado", "vencido"].includes(c)) continue;
      expect(permitidas.has(c), c).toBe(true);
    }
    expect(corpo).not.toMatch(/'custo'|'margem_pct'|'codigo_fornecedor'|'descricao'|'regra'|'motivo'/);
    // Todo texto que sai passa pelo filtro do fornecedor.
    expect([...corpo.matchAll(/fornecedor_texto_para_cliente\(/g)].length).toBeGreaterThanOrEqual(5);
  });

  it("sem regra é sob consulta, nunca zero nem o custo", () => {
    expect(sql).toMatch(/IF p_custo IS NULL OR p_margem_pct IS NULL THEN RETURN NULL; END IF;/);
  });
});

describe("as telas novas leem o erro", () => {
  it("nenhum `const { data } = await` que descarta o erro", () => {
    for (const a of novos) expect(/const\s*\{\s*data\s*\}\s*=\s*await/.test(a.codigo), a.nome).toBe(false);
  });

  it("toda chamada ao Supabase das consultas confere o erro", () => {
    const consultas = novos.find((a) => a.nome.endsWith("catalogo/consultas.ts"))!.codigo;
    const chamadas = [...consultas.matchAll(/await \(supabase/g)].length;
    const conferencias = [...consultas.matchAll(/if \(error\) throw error;/g)].length;
    expect(chamadas).toBeGreaterThan(10);
    // +1: a conferência de dentro de lerTudo, que serve às listas paginadas.
    expect(conferencias).toBe(chamadas + 1);
  });

  it("o PostgREST corta em 1.000: as listas grandes são lidas em páginas com contagem exata", () => {
    const consultas = novos.find((a) => a.nome.endsWith("catalogo/consultas.ts"))!.codigo;
    for (const tabela of ["fornecedor_itens", "fornecedor_fotos", "fornecedor_secoes", "clientes"]) {
      const trecho = consultas.slice(consultas.indexOf(`.from("${tabela}")`), consultas.indexOf(`.from("${tabela}")`) + 400);
      expect(trecho, tabela).toMatch(/count: "exact"/);
      expect(trecho, tabela).toMatch(/\.range\(de, ate\)/);
    }
  });
});
