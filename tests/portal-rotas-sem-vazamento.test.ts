import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * A TRAVA DO PORTAL DO CLIENTE.
 *
 * As rotas /api/portal/* respondem a quem não tem login E usam a chave de
 * serviço, que ignora RLS e GRANT de coluna — o mesmo risco das rotas da TV,
 * com um agravante: do outro lado está o cliente, e o que vaza para ele é
 * custo e margem. E a página /publico/$token era demonstração que respondia
 * "recebemos" sem gravar.
 *
 * Cada teste abaixo é um defeito que já existiu aqui ou num vizinho:
 *   select("*") com chave de serviço       orcamento-publico.functions.ts
 *   cliente lendo a view financeira        /portal-cliente (sempre vazia)
 *   "receita líquida" na tela do cliente   /portal-cliente
 *   registro fixo para qualquer token      public-access.ts ('orc-245')
 *   segredo padrão escrito no código       public-access.server.ts
 *   "recebemos" sem gravação               public-access.server.ts
 *
 * Lê o CÓDIGO sem os comentários: a explicação de um defeito num comentário
 * não pode reprovar o arquivo que o evita.
 */

const RAIZ = resolve(__dirname, "..");

/**
 * Tira comentários de linha e de bloco, respeitando o que está entre aspas.
 * Cópia do extrator de `tv-rotas-sem-vazamento.test.ts`: importar de um
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
const DIR_ROTAS = join(RAIZ, "src/routes");
const DIR_API = join(RAIZ, "src/lib/api");
const MIGRACAO = join(RAIZ, "supabase/migrations/20261002101001_portal_do_cliente.sql");

type Arquivo = { nome: string; codigo: string };

function ler(dir: string, filtro: RegExp): Arquivo[] {
  return readdirSync(dir)
    .filter((nome) => filtro.test(nome))
    .sort()
    .map((nome) => ({ nome, codigo: semComentarios(readFileSync(join(dir, nome), "utf8")) }));
}

function lerUm(caminho: string): Arquivo {
  return { nome: caminho, codigo: semComentarios(readFileSync(join(RAIZ, caminho), "utf8")) };
}

function arquivosFonte(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosFonte(caminho, acc);
    else if (/\.(ts|tsx)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const rotas = ler(DIR_ROTAS, /^api\.portal\..+\.ts$/);
const servidores = ler(DIR_API, /^portal-.+\.server\.ts$/);
const todos = [...rotas, ...servidores];
const paginaPublica = lerUm("src/routes/publico.$token.tsx");
const clienteDoLink = lerUm("src/lib/public-access.ts");
const paginaLogada = lerUm("src/routes/_authenticated/portal-cliente.tsx");

/** `.from(` que não vem logo depois de `.storage`: leitura de tabela com a chave de serviço. */
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

describe("o extrator enxerga o que precisa", () => {
  it("os detectores acusam o defeito quando ele existe", () => {
    // Trava que nunca dispara é pior que trava nenhuma.
    expect(leTabelaDireto('supabaseAdmin.from("ordens_servico").select("*")')).toBe(true);
    expect(leTabelaDireto('db\n  .from("arquivos")')).toBe(true);
    expect(leTabelaDireto("supabaseAdmin.storage.from(bucket).createSignedUrl(c, 600)")).toBe(
      false,
    );
    expect(credencialNoConsole('console.error("falhou", credencial.hash);')).toBe(true);
    expect(credencialNoConsole("console.log(`token ${token}`, token);")).toBe(true);
    expect(credencialNoConsole('console.error("[portal] token recusado", error.code);')).toBe(
      false,
    );
  });

  it("acha as cinco rotas e os dois arquivos de servidor", () => {
    expect(rotas.map((a) => a.nome)).toEqual([
      "api.portal.arquivo.ts",
      "api.portal.arte.ts",
      "api.portal.envio.ts",
      "api.portal.mensagem.ts",
      "api.portal.painel.ts",
    ]);
    expect(servidores.map((a) => a.nome)).toEqual([
      "portal-comum.server.ts",
      "portal-link.server.ts",
    ]);
  });
});

describe("rotas do portal: nada sai do banco sem lista fechada", () => {
  it("nenhuma tabela é lida direto: só Storage.from(bucket), nunca supabaseAdmin.from(tabela)", () => {
    for (const a of todos) expect(leTabelaDireto(a.codigo), a.nome).toBe(false);
  });

  it("nenhum select", () => {
    for (const a of todos) expect(/\.select\s*\(/.test(a.codigo), a.nome).toBe(false);
  });

  it("do Storage, só URL assinada — o servidor não lê, não grava e não apaga arquivo", () => {
    const metodos = servidores.flatMap((a) =>
      [...a.codigo.matchAll(/\.storage\s*\.from\([^)]*\)\s*\.(\w+)/g)].map((m) => m[1]),
    );
    expect(metodos.sort()).toEqual(["createSignedUploadUrl", "createSignedUrl"]);
  });

  it("só chama funções portal_link_*, sempre por lerDoBanco e com o mesmo nome dentro e fora", () => {
    const servidor = servidores.find((a) => a.nome === "portal-link.server.ts")!.codigo;
    const nomes = [
      ...servidor.matchAll(/\.rpc\s*(?:as any\s*\))?\s*\(\s*["'`]([a-z0-9_]+)["'`]/g),
    ].map((m) => m[1]);
    expect(nomes.sort()).toEqual([
      "portal_link_abrir",
      "portal_link_abrir_envio",
      "portal_link_decidir_arte",
      "portal_link_enviar_mensagem",
      "portal_link_objeto",
      "portal_link_registrar_envio",
    ]);
    const embrulhadas = [
      ...servidor.matchAll(
        /lerDoBanco\(\s*"(portal_link_[a-z_]+)"\s*,\s*\(\)\s*=>\s*\(supabaseAdmin\.rpc as any\)\(\s*"(portal_link_[a-z_]+)"/g,
      ),
    ];
    expect(embrulhadas).toHaveLength(nomes.length);
    for (const [, fora, dentro] of embrulhadas) expect(fora).toBe(dentro);
  });

  it("toda credencial vai ao banco como hash", () => {
    const servidor = servidores.find((a) => a.nome === "portal-link.server.ts")!.codigo;
    const params = [...servidor.matchAll(/\b(p_token_hash)\s*:\s*([\w.]+)/g)].map((m) => m[2]);
    expect(params.length).toBe(6);
    for (const valor of params) expect(valor).toBe("credencial.hash");
    const comum = servidores.find((a) => a.nome === "portal-comum.server.ts")!.codigo;
    expect(comum).toMatch(/return \{ hash: await hashDoSegredo\(token\) \}/);
  });
});

describe("rotas do portal: o token não vaza e falha não vira 'recebido'", () => {
  it("o token vem do cabeçalho; o servidor nem olha a URL do pedido", () => {
    const comum = servidores.find((a) => a.nome === "portal-comum.server.ts")!.codigo;
    expect(comum).toMatch(/request\.headers\.get\(CABECALHO_DO_LINK\)/);
    for (const a of todos) {
      expect(/request\.url|searchParams/.test(a.codigo), a.nome).toBe(false);
      expect(/[?&]token=/i.test(a.codigo), a.nome).toBe(false);
    }
  });

  it("nenhum console recebe token, assinatura ou hash como valor", () => {
    for (const a of todos) expect(credencialNoConsole(a.codigo), a.nome).toBe(false);
  });

  it("toda resposta passa por respostaPortal, que nunca deixa cache", () => {
    const comum = servidores.find((a) => a.nome === "portal-comum.server.ts")!.codigo;
    expect(comum).toMatch(/"cache-control":\s*"no-store"/);
    const porFora = servidores.filter(
      (a) => a.nome !== "portal-comum.server.ts" && /new Response\(/.test(a.codigo),
    );
    expect(porFora.map((a) => a.nome)).toEqual([]);
  });

  it("200 nas rotas que gravam só depois de ok: true do banco", () => {
    const servidor = servidores.find((a) => a.nome === "portal-link.server.ts")!.codigo;
    expect(servidor).toMatch(/if \(valor\.ok === false\) return recusado/);
    expect(servidor).toMatch(/if \(valor\.ok !== true\) return portalIndisponivel\(\)/);
    // Os quatro caminhos que gravam ou assinam passam pela negativa antes do 200.
    expect([...servidor.matchAll(/const negativa = negativaDoBanco\(/g)]).toHaveLength(4);
  });

  it("a chave de serviço não entra no pacote do navegador", () => {
    for (const a of rotas) {
      const estaticos = [...a.codigo.matchAll(/^import\s[^;]*from\s+["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      expect(estaticos, a.nome).toEqual(["@tanstack/react-router"]);
      expect(a.codigo, a.nome).toMatch(/await import\("@\/lib\/api\/portal-link\.server"\)/);
    }
    for (const a of [paginaPublica, clienteDoLink, paginaLogada]) {
      expect(/client\.server|supabaseAdmin/.test(a.codigo), a.nome).toBe(false);
    }
  });
});

describe("a demonstração acabou", () => {
  it("o servidor de demonstração e o segredo padrão sumiram do código", () => {
    expect(existsSync(join(RAIZ, "src/lib/public-access.server.ts"))).toBe(false);
    for (const caminho of arquivosFonte(join(RAIZ, "src"))) {
      const codigo = readFileSync(caminho, "utf8");
      expect(codigo.includes("bex-print-local-public-link-secret"), caminho).toBe(false);
      expect(codigo.includes("createDemoPublicPortalToken"), caminho).toBe(false);
      expect(/process\.env\.(PUBLIC_LINK_SECRET|SESSION_SECRET)/.test(codigo), caminho).toBe(false);
    }
  });

  it("nenhum registro fictício e nenhum 'recebemos' sem gravação", () => {
    for (const a of [paginaPublica, clienteDoLink]) {
      expect(a.codigo, a.nome).not.toMatch(
        /orc-245|Marcos Silva|getPublicPortalRecord|publicPortalRecords/,
      );
      expect(a.codigo, a.nome).not.toMatch(/Recebemos sua solicitação/);
    }
  });

  it("link sem registro real recebe a frase combinada, e nada mais", () => {
    expect(paginaPublica.codigo).toMatch(/MENSAGEM_LINK_INVALIDO/);
    expect(paginaPublica.codigo).toMatch(/tokenBemFormado\(token\)/);
  });
});

describe("/portal-cliente lê só o que é do cliente", () => {
  it("não lê view financeira, snapshot de resultado nem tabela de OS", () => {
    const c = paginaLogada.codigo;
    expect(c).not.toMatch(
      /ordens_servico_financeiro|ordens_servico_comercial|os_resultado_snapshots/,
    );
    expect(c).not.toMatch(/receita_liquida|Receita líquida|custo|margem/i);
    expect(c).not.toMatch(/\.from\(\s*["']ordens_servico/);
    expect(c).toMatch(/\("portal_meu_painel"/);
  });

  it("o envio de arquivo é de verdade: sobe e registra", () => {
    const c = paginaLogada.codigo;
    expect(c).not.toMatch(/virá em breve/);
    expect(c).toMatch(/\.upload\(caminho, dados\.arquivo/);
    expect(c).toMatch(/\("portal_registrar_envio"/);
  });
});

/** Linhas de SQL sem os comentários de linha. */
function semComentariosSql(sql: string): string {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}

describe("o banco do portal (retrato em 20261002101001)", () => {
  const sql = semComentariosSql(readFileSync(MIGRACAO, "utf8"));
  const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)/g)].map(
    (m) => m[1],
  );

  it("as duas tabelas nascem com RLS e sem acesso de anon", () => {
    for (const t of ["portal_cliente_links", "portal_comprovantes"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).toMatch(
      /token_hash text NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    );
  });

  it("toda função nova nasce fechada e só abre para quem deve", () => {
    const novas = funcoes.filter((f) => f !== "registrar_decisao_aprovacao");
    expect(novas.length).toBeGreaterThanOrEqual(28);
    for (const f of novas) {
      expect(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`,
        ).test(sql),
        f,
      ).toBe(true);
    }
    expect(/GRANT[^;]*\bTO\b[^;]*\b(anon|PUBLIC)\b/i.test(sql)).toBe(false);
    const grants = [
      ...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\) TO (\w+);/g),
    ];
    for (const [, f, papel] of grants) {
      if (f.startsWith("portal_link_")) expect(papel, f).toBe("service_role");
      else expect(papel, f).toBe("authenticated");
    }
    // As peças de dentro não abrem para ninguém.
    for (const interna of [
      "portal_painel_do_cliente",
      "portal_gravar_envio",
      "portal_gravar_mensagem",
      "portal_situacao_do_link",
      "decidir_arte_por_token",
      "portal_decidir_arte_do_cliente",
      "portal_objeto_do_cliente",
    ]) {
      expect(
        grants.some(([, f]) => f === interna),
        interna,
      ).toBe(false);
    }
  });

  it("a porta antiga da aprovação passa pelo mesmo miolo do portal", () => {
    expect(sql).toMatch(
      /return public\.decidir_arte_por_token\(v_token_id, p_decisao, p_comentario, 'link', null\);/,
    );
    expect(sql).toMatch(
      /v_res := public\.decidir_arte_por_token\(v_token, p_decisao, p_comentario, p_canal, p_usuario_id\);/,
    );
  });
});
