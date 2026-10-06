import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { CABECALHO_DO_TOKEN } from "../src/domain/tv/pareamento";

/**
 * A TRAVA DAS ROTAS DA TV.
 *
 * As rotas `/api/tv/*` são as únicas portas do sistema que respondem a quem
 * não tem login E usam a chave de serviço — que ignora RLS e GRANT de coluna.
 * `tests/permissoes-rotas.test.ts` só varre `_authenticated`; estas escapam
 * dele por construção. Sem trava própria, a garantia de "nada de dinheiro na
 * parede" e "falha não vira vazio" dependeria de alguém reler o arquivo.
 *
 * Cada teste abaixo é um defeito que já existe em outro canto deste projeto:
 *   select("*") com chave de serviço     orcamento-publico.functions.ts
 *   const { data } = await (sem error)   kanban.tsx, maquinas.tsx, auth-context
 *   segredo aceito pela URL              o webhook do Z-API (lá é imposição
 *                                        do provedor; aqui não há desculpa)
 *
 * O teste lê o CÓDIGO, sem os comentários: a explicação de um defeito num
 * comentário não pode reprovar o arquivo que o evita.
 */

const RAIZ = resolve(__dirname, "..");
const DIR_ROTAS = join(RAIZ, "src/routes");
const DIR_API = join(RAIZ, "src/lib/api");
const MIGRACAO = join(RAIZ, "supabase/migrations/20261001130000_tv_dispositivos_e_pareamento.sql");
const MIGRACAO_PIN = join(RAIZ, "supabase/migrations/20261005213700_tv_entrar_com_pin.sql");
const MIGRACOES = [MIGRACAO, MIGRACAO_PIN];
const TELA_LOGADA = join(RAIZ, "src/routes/_authenticated/telas.tsx");

/** Tira comentários de linha e de bloco, respeitando o que está entre aspas. */
export function semComentarios(fonte: string): string {
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

/** Troca o conteúdo de toda string por nada: sobra só o que é identificador. */
function semTextos(codigo: string): string {
  return codigo.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

type Arquivo = { nome: string; codigo: string };

function ler(dir: string, filtro: RegExp): Arquivo[] {
  return readdirSync(dir)
    .filter((nome) => filtro.test(nome))
    .sort()
    .map((nome) => ({ nome, codigo: semComentarios(readFileSync(join(dir, nome), "utf8")) }));
}

const rotas = ler(DIR_ROTAS, /^api\.tv\..+\.ts$/);
const servidores = ler(DIR_API, /^tv-.+\.server\.ts$/);
// A tela pública da TV (outra trilha) guarda e manda o token: vale para ela a
// mesma regra de não pôr o token em URL nem em log. Só entra se já existir.
const telasPublicas = ler(DIR_ROTAS, /^tv\..+\.tsx$/);
const todos = [...rotas, ...servidores];

/** Os argumentos de cada `console.x(...)`, com parênteses casados. */
function chamadasDeConsole(codigo: string): string[] {
  const achadas: string[] = [];
  const re = /console\.\w+\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    let nivel = 1;
    let i = m.index + m[0].length;
    const inicio = i;
    while (i < codigo.length && nivel > 0) {
      if (codigo[i] === "(") nivel++;
      else if (codigo[i] === ")") nivel--;
      i++;
    }
    achadas.push(codigo.slice(inicio, i - 1));
  }
  return achadas;
}

describe("o extrator enxerga o que precisa", () => {
  it("acha as três rotas e os arquivos de servidor — não pode passar por não achar nada", () => {
    expect(rotas.map((a) => a.nome)).toEqual(["api.tv.painel.ts", "api.tv.parear.ts", "api.tv.pin.ts"]);
    expect(servidores.map((a) => a.nome)).toEqual(
      expect.arrayContaining(["tv-comum.server.ts", "tv-painel.server.ts", "tv-pin.server.ts"]),
    );
  });

  it("tira comentário sem comer string com barras", () => {
    const fonte =
      'const a = "https://x"; // select("*")\n/* const { data } = await x */ const b = 1;';
    const limpo = semComentarios(fonte);
    expect(limpo).toContain('"https://x"');
    expect(limpo).not.toContain("select");
    expect(limpo).not.toContain("data");
    expect(limpo).toContain("const b = 1;");
  });

  it("os detectores acusam o defeito quando ele existe", () => {
    // Trava que nunca dispara é pior que trava nenhuma.
    expect(/\.select\(\s*(["'`]\s*\*\s*["'`])?\s*\)/.test('x.from("t").select("*")')).toBe(true);
    expect(desestruturacoesSemErro("const { data } = await db.rpc('x');")).toHaveLength(1);
    expect(desestruturacoesSemErro("const { data: d } = await db.rpc('x');")).toHaveLength(1);
    expect(desestruturacoesSemErro("const { data, error } = await db.rpc('x');")).toHaveLength(0);
    expect(tokenNoConsole('console.log("token", token)')).toBe(true);
    expect(tokenNoConsole("console.error(`falhou ${hashDoToken}`)")).toBe(true);
    expect(tokenNoConsole('console.error("[tv] token recusado", error.code)')).toBe(false);
    expect(tokenNoConsole("console.log(pin)")).toBe(true);
  });
});

function desestruturacoesSemErro(codigo: string): string[] {
  return [...codigo.matchAll(/\{([^{}]*)\}\s*=\s*await\b/g)]
    .map((m) => m[1])
    .filter((campos) => /\bdata\b/.test(campos) && !/\berror\b/.test(campos));
}

/** Verdadeiro se algum `console.x(...)` recebe credencial como VALOR (fora de texto fixo). */
function tokenNoConsole(codigo: string): boolean {
  return chamadasDeConsole(codigo).some((args) => {
    // Em template literal, o que está dentro de ${} é valor: preserva.
    const interpolado = [...args.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(" ");
    return /token|retirada|segredo|hash|secret|\bpin\b/i.test(`${semTextos(args)} ${interpolado}`);
  });
}

describe("rotas da TV: nada sai do banco sem lista fechada", () => {
  it("nenhum select('*') nem select() sem colunas", () => {
    const culpados = todos.filter((a) => /\.select\(\s*(["'`]\s*\*\s*["'`])?\s*\)/.test(a.codigo));
    expect(culpados.map((a) => a.nome)).toEqual([]);
  });

  it("nenhuma tabela é lida ou escrita direto: o banco só é tocado por função", () => {
    // Com a chave de serviço, `.from("maquinas")` traz custo_hora e
    // `.from("ordens_servico")` traz valor_total. Função devolve chave por chave.
    const culpados = todos.filter((a) => /\.from\s*\(|\.storage\b/.test(a.codigo));
    expect(culpados.map((a) => a.nome)).toEqual([]);
  });

  it("só chama funções tv_*", () => {
    const nomes = todos.flatMap((a) =>
      [...a.codigo.matchAll(/\.rpc\s*(?:as any\s*\))?\s*\(\s*["'`]([a-z0-9_]+)["'`]/g)].map(
        (m) => m[1],
      ),
    );
    expect(nomes.length).toBeGreaterThanOrEqual(4);
    expect(nomes.filter((n) => !n.startsWith("tv_"))).toEqual([]);
  });
});

describe("rotas da TV: falha não vira vazio", () => {
  it("nenhum `{ data } = await` sem ler o error", () => {
    const culpados = todos.flatMap((a) =>
      desestruturacoesSemErro(a.codigo).map((c) => `${a.nome}: {${c}}`),
    );
    expect(culpados).toEqual([]);
  });

  it("toda chamada ao banco passa por lerDoBanco, com o mesmo nome dentro e fora", () => {
    for (const a of servidores) {
      const chamadas = [...a.codigo.matchAll(/\.rpc\b/g)].length;
      const embrulhadas = [
        ...a.codigo.matchAll(
          /lerDoBanco\(\s*"(tv_[a-z_]+)"\s*,\s*\(\)\s*=>\s*\(supabaseAdmin\.rpc as any\)\(\s*"(tv_[a-z_]+)"/g,
        ),
      ];
      expect(embrulhadas.length, `${a.nome}: há .rpc fora de lerDoBanco`).toBe(chamadas);
      for (const [, fora, dentro] of embrulhadas) expect(fora, a.nome).toBe(dentro);
    }
  });

  it("lerDoBanco devolve falha para erro, para nulo e para exceção", () => {
    const comum = servidores.find((a) => a.nome === "tv-comum.server.ts");
    expect(comum, "tv-comum.server.ts sumiu").toBeDefined();
    const corpo = comum!.codigo;
    expect(corpo).toMatch(/const \{ data, error \} = await chamada\(\)/);
    expect(corpo).toMatch(/if \(error\)[\s\S]*?return \{ ok: false \}/);
    expect(corpo).toMatch(/data === null[\s\S]*?return \{ ok: false \}/);
    expect(corpo).toMatch(/catch[\s\S]*?return \{ ok: false \}/);
  });

  it("o painel só responde 200 com o que a função do banco devolveu", () => {
    const painel = servidores.find((a) => a.nome === "tv-painel.server.ts")!.codigo;
    const duzentos = [...painel.matchAll(/respostaTv\(\s*200\s*,\s*([^)]*)\)/g)].map((m) =>
      m[1].trim(),
    );
    // Um único 200, e ele repassa o jsonb: nada de [] ou {} montado à mão.
    expect(duzentos).toEqual(["painel.valor"]);
    expect(painel).toMatch(/if \(!painel\.ok\) return bancoIndisponivel\(\)/);
    expect(painel).toMatch(/if \(!conferido\.ok\) return bancoIndisponivel\(\)/);
    expect(painel).toMatch(/tv_nao_pareada/);
    expect(painel).toMatch(/tv_revogada/);
  });

  it("toda resposta sai com cache-control: no-store", () => {
    const comum = servidores.find((a) => a.nome === "tv-comum.server.ts")!.codigo;
    expect(comum).toMatch(/"cache-control":\s*"no-store"/);
    // Ninguém monta Response por fora do respostaTv.
    const porFora = servidores.filter(
      (a) => a.nome !== "tv-comum.server.ts" && /new Response\(/.test(a.codigo),
    );
    expect(porFora.map((a) => a.nome)).toEqual([]);
  });
});

describe("rotas da TV: o token não vaza", () => {
  it("o token viaja no cabeçalho x-tv-token, nunca na URL", () => {
    expect(CABECALHO_DO_TOKEN).toBe("x-tv-token");
    const painel = servidores.find((a) => a.nome === "tv-painel.server.ts")!.codigo;
    expect(painel).toMatch(/request\.headers\.get\(CABECALHO_DO_TOKEN\)/);
    for (const a of [...todos, ...telasPublicas]) {
      expect(/[?&]token=/i.test(a.codigo), `${a.nome}: token na query string`).toBe(false);
      expect(
        /searchParams\.(get|set|append)\(\s*["'`][^"'`]*token/i.test(a.codigo),
        `${a.nome}: token lido ou posto na query string`,
      ).toBe(false);
    }
    // O servidor nem olha a URL do pedido: não há o que ler nela.
    for (const a of todos) {
      expect(/request\.url|searchParams/.test(a.codigo), `${a.nome}: lê a URL do pedido`).toBe(
        false,
      );
    }
  });

  it("nenhum console recebe token, segredo de retirada ou hash", () => {
    const culpados = [...todos, ...telasPublicas].filter((a) => tokenNoConsole(a.codigo));
    expect(culpados.map((a) => a.nome)).toEqual([]);
  });

  it("o banco recebe hash, nunca o valor em claro", () => {
    // Todo parâmetro que carrega credencial termina em _hash; o que vai nele
    // é uma variável que saiu de hashDoSegredo.
    const painel = servidores.find((a) => a.nome === "tv-painel.server.ts")!.codigo;
    const pin = servidores.find((a) => a.nome === "tv-pin.server.ts")!.codigo;
    const comum = servidores.find((a) => a.nome === "tv-comum.server.ts")!.codigo;
    const params = [...`${painel}\n${pin}`.matchAll(/\b(p_\w+)\s*:\s*([\w.]+)/g)].map(
      (m) => [m[1], m[2]],
    );
    const credenciais = params.filter(([p]) => p.endsWith("_hash"));
    expect(credenciais.length).toBeGreaterThanOrEqual(3);
    for (const [param, valor] of credenciais) expect(valor, param).toMatch(/^hashD[ao]/);
    expect(params.filter(([, v]) => /^(token|retirada)$/.test(v))).toEqual([]);
    expect(painel).toMatch(/hashDoToken = await hashDoSegredo\(token\)/);
    expect(pin).toMatch(/hashDoToken = await hashDoSegredo\(token\)/);
    // O endereço de quem pede também só vai como hash — uma função só, para as duas portas.
    expect(comum).toMatch(/return hashDoSegredo\(`bexprint-tv-origem:\$\{limpo\}`\)/);
    expect(pin).toMatch(/p_origem_hash: hashDaOrigem\b/);
    // O PIN é a única credencial que vai como veio: quem confere contra o
    // bcrypt é o banco. E só para a função que confere.
    expect(params.filter(([p]) => p === "p_pin")).toEqual([["p_pin", "pin"]]);
  });

  it("a entrada por PIN nunca devolve o token: quem tem o crachá é a TV, desde antes", () => {
    const pin = servidores.find((a) => a.nome === "tv-pin.server.ts")!.codigo;
    const respostas = [...pin.matchAll(/respostaTv\(\s*\d+\s*,\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(respostas.length).toBeGreaterThanOrEqual(6);
    expect(respostas.filter((r) => /\btoken\b/.test(r) && !/token_/.test(r))).toEqual([]);
    expect(respostas.filter((r) => /\bpin\b\s*[,:}]|\bpin\s*$/.test(r))).toEqual([]);
  });

  it("a porta do código está fechada: /api/tv/parear só responde 410, sem banco", () => {
    // Desde 06/10/2026 a TV entra só pelo PIN. A rota antiga ficou de pé só
    // para dar um "não" claro à TV com a tela velha aberta.
    const rota = rotas.find((a) => a.nome === "api.tv.parear.ts")!.codigo;
    expect(rota).toMatch(/pareamentoEncerrado\(\)/);
    expect(rota).not.toMatch(/tv-parear\.server|supabase|rpc\(/);
    const comum = servidores.find((a) => a.nome === "tv-comum.server.ts")!.codigo;
    expect(comum).toMatch(/respostaTv\(410, \{\s*erro: "so_pin"/);
  });

  it("a chave de serviço não entra no pacote do navegador", () => {
    // Rota importa o .server dentro do handler; import no topo arrastaria o
    // supabaseAdmin para o bundle do cliente.
    for (const a of rotas) {
      const estaticos = [...a.codigo.matchAll(/^import\s[^;]*from\s+["']([^"']+)["']/gm)].map(
        (m) => m[1],
      );
      expect(estaticos, a.nome).toEqual(["@tanstack/react-router"]);
      expect(a.codigo, a.nome).toMatch(/await import\("@\/lib\/api\/tv-[a-z]+\.server"\)/);
    }
  });
});

describe("o contrato com as funções tv_* do banco", () => {
  /** Assinaturas lidas das migrações, que são o retrato do banco vivo (a mais nova vence). */
  function assinaturas(arquivos: string[] = MIGRACOES): Record<string, string[]> {
    const mapa: Record<string, string[]> = {};
    for (const arquivo of arquivos) {
      const sql = readFileSync(arquivo, "utf8");
      for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(tv_[a-z_]+)\(([^)]*)\)/g)) {
        mapa[m[1]] = m[2]
          .split(",")
          .map((p) => p.trim().split(/\s+/)[0])
          .filter(Boolean);
      }
    }
    return mapa;
  }

  function chamadas(codigo: string): { rpc: string; params: string[] }[] {
    return [
      ...codigo.matchAll(
        /\.rpc\s*(?:as any\s*\))?\s*\(\s*["'`](tv_[a-z_]+)["'`]\s*(?:,\s*\{([^{}]*)\})?/g,
      ),
    ].map((m) => ({
      rpc: m[1],
      params: [...(m[2] ?? "").matchAll(/(?:^|,)\s*([a-zA-Z_]\w*)\s*:/g)].map((k) => k[1]),
    }));
  }

  it("a migração do PIN declara as suas quatro funções", () => {
    expect(existsSync(MIGRACAO_PIN)).toBe(true);
    expect(Object.keys(assinaturas([MIGRACAO_PIN])).sort()).toEqual([
      "tv_definir_pin",
      "tv_entrar_com_pin",
      "tv_estado_do_pin",
      "tv_listar_dispositivos",
    ]);
  });

  it("a migração do pareamento declara as oito funções", () => {
    expect(existsSync(MIGRACAO)).toBe(true);
    expect(Object.keys(assinaturas([MIGRACAO])).sort()).toEqual([
      "tv_aprovar_pareamento",
      "tv_conferir_dispositivo",
      "tv_criar_pareamento",
      "tv_criar_pareamento_da_origem",
      "tv_limpar_pedidos",
      "tv_listar_dispositivos",
      "tv_retirar_pareamento",
      "tv_revogar_dispositivo",
    ]);
  });

  /**
   * `tv_criar_pareamento` (2 argumentos) é peça de dentro: quem a chama é a
   * `tv_criar_pareamento_da_origem`, no banco. Chamada direto do servidor ela
   * cria o pedido SEM o freio por origem — a segunda porta para o mesmo fato.
   */
  const SO_O_BANCO_CHAMA = ["tv_criar_pareamento"];
  // O pareamento por código saiu em 06/10/2026: a TV entra só pelo PIN
  // (decisão do dono). As funções seguem no banco — objeto do banco só se apaga
  // com o OK do dono —, mas nada no sistema pode voltar a chamá-las.
  const APOSENTADAS = [
    "tv_aprovar_pareamento",
    "tv_criar_pareamento_da_origem",
    "tv_limpar_pedidos",
    "tv_retirar_pareamento",
  ];

  it("ninguém chama o pareamento por código aposentado, nem a função de dentro", () => {
    const tela = semComentarios(readFileSync(TELA_LOGADA, "utf8"));
    const nomes = [...servidores.map((a) => a.codigo), tela].flatMap((codigo) =>
      chamadas(codigo).map((c) => c.rpc),
    );
    for (const f of [...SO_O_BANCO_CHAMA, ...APOSENTADAS]) expect(nomes).not.toContain(f);
    // E a entrada que sobrou é a do PIN, que também conta a origem.
    expect(nomes).toContain("tv_entrar_com_pin");
  });

  it("servidor e tela chamam cada função com exatamente os parâmetros que ela tem", () => {
    // Nome de parâmetro errado não é erro de compilação (`rpc as any`) nem de
    // banco: o PostgREST responde "Could not find the function" e o botão
    // simplesmente não funciona. Nenhuma tv_* tem parâmetro opcional.
    const esperado = assinaturas();
    const fontes = [
      ...servidores,
      { nome: "telas.tsx", codigo: semComentarios(readFileSync(TELA_LOGADA, "utf8")) },
    ];
    const feitas = fontes.flatMap((a) =>
      chamadas(a.codigo).map((c) => ({ ...c, arquivo: a.nome })),
    );
    // tv_painel_maquinas é de outra migração (sem parâmetros): fica fora desta conta.
    const conferiveis = feitas.filter((c) => c.rpc in esperado);
    expect(conferiveis.map((c) => c.rpc).sort()).toEqual(
      Object.keys(esperado)
        .filter((f) => !SO_O_BANCO_CHAMA.includes(f) && !APOSENTADAS.includes(f))
        .sort(),
    );
    for (const c of conferiveis) {
      expect([...c.params].sort(), `${c.arquivo}: ${c.rpc}`).toEqual([...esperado[c.rpc]].sort());
    }
    const painel = feitas.filter((c) => c.rpc === "tv_painel_maquinas");
    expect(painel).toHaveLength(1);
    expect(painel[0].params).toEqual([]);
  });

  it("as tabelas da TV nascem com RLS e sem nenhuma policy", () => {
    const tabelas: [string, string[]][] = [
      [MIGRACAO, ["tv_dispositivos", "tv_pareamentos", "tv_pareamento_tentativas"]],
      [MIGRACAO_PIN, ["tv_pin", "tv_pin_tentativas"]],
    ];
    for (const [arquivo, nomes] of tabelas) {
      const sql = readFileSync(arquivo, "utf8");
      for (const tabela of nomes) {
        expect(sql).toContain(`ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY;`);
        expect(sql).toContain(
          `REVOKE ALL ON TABLE public.${tabela} FROM PUBLIC, anon, authenticated;`,
        );
      }
      expect(/CREATE POLICY/i.test(semComentariosSql(sql)), arquivo).toBe(false);
    }
  });

  it("nenhuma função da TV fica aberta ao anônimo", () => {
    for (const arquivo of MIGRACOES) {
      const sql = semComentariosSql(readFileSync(arquivo, "utf8"));
      const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(tv_[a-z_]+)\(/g)].map(
        (m) => m[1],
      );
      expect(funcoes.length, arquivo).toBeGreaterThan(0);
      for (const f of funcoes) {
        expect(
          new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon`).test(sql),
          f,
        ).toBe(true);
      }
      expect(/GRANT[^;]*\bTO\b[^;]*\b(anon|PUBLIC)\b/i.test(sql), arquivo).toBe(false);
    }
  });

  it("o PIN só existe no banco como bcrypt, e nenhum PIN mora no repositório", () => {
    const sql = readFileSync(MIGRACAO_PIN, "utf8");
    expect(sql).toMatch(/extensions\.crypt\(v_pin, extensions\.gen_salt\('bf', 8\)\)/);
    expect(sql).toMatch(/CONSTRAINT tv_pin_hash_bcrypt CHECK/);
    // A migração cria a linha DESLIGADA: o PIN inicial foi gravado no banco vivo.
    expect(semComentariosSql(sql)).not.toMatch(/crypt\('\d{4,8}'/);
    expect(semComentariosSql(sql)).toMatch(/INSERT INTO public\.tv_pin \(id\) VALUES \(true\);/);
  });
});

function semComentariosSql(sql: string): string {
  return sql
    .split("\n")
    .filter((linha) => !linha.trimStart().startsWith("--"))
    .join("\n");
}
