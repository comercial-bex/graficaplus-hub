import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CABECALHO_DO_DESPACHANTE,
  DESPACHANTE_DESLIGADO,
} from "../src/domain/whatsapp/despachante";

/**
 * O DESPACHANTE DO SERVIDOR — POST /api/whatsapp/despachar — exercido de
 * verdade, com o banco trocado por um dublê e o ambiente mexido pelo teste.
 *
 * O que se segura:
 *   503 "despachante do servidor desligado"  sem DESPACHANTE_TOKEN e sem o
 *                                            token no Vault do banco (e o
 *                                            navegador segue valendo)
 *   401                                      token ausente ou errado
 *   passa                                    token certo: a rodada começa
 * O token vale pela variável do servidor (prioridade) ou pelo Vault do banco,
 * conferido por whatsapp_despachante_token_situacao (08/10/2026).
 * E que nenhuma resposta nem log leva o token.
 */

const banco = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { tabela: string; metodo: string; args?: unknown }[],
    respostas: new Map<string, unknown>(),
    responder(tabela: string, resposta: unknown) {
      estado.respostas.set(tabela, resposta);
    },
    from(tabela: string) {
      const cadeia: Record<string, unknown> = {};
      for (const m of [
        "select",
        "insert",
        "update",
        "eq",
        "lt",
        "lte",
        "or",
        "order",
        "limit",
        "maybeSingle",
        "in",
        "single",
      ]) {
        cadeia[m] = () => {
          estado.chamadas.push({ tabela, metodo: m });
          return cadeia;
        };
      }
      cadeia.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(estado.respostas.get(tabela) ?? { data: null, error: null }).then(
          resolve,
          reject,
        );
      return cadeia;
    },
    rpc(nome: string, args?: unknown) {
      estado.chamadas.push({ tabela: `rpc:${nome}`, metodo: "rpc", args });
      return Promise.resolve(estado.respostas.get(`rpc:${nome}`) ?? { data: null, error: null });
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => banco.from(tabela),
    rpc: (nome: string, args?: unknown) => banco.rpc(nome, args),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "sem sessão" } }) },
  },
}));

import {
  despacharPeloServidor,
  processarFilaZapi,
  saudeDoDespachante,
} from "../src/lib/api/whatsapp-enviar.server";

const TOKEN = "um-token-que-so-o-teste-conhece-1234567890";

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.respostas.clear();
  vi.unstubAllEnvs();
  vi.stubEnv("DESPACHANTE_TOKEN", "");
  vi.stubEnv("ZAPI_TOKEN", "");
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erros.mockRestore();
  vi.unstubAllEnvs();
});

function pedir(token?: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set(CABECALHO_DO_DESPACHANTE, token);
  return despacharPeloServidor(
    new Request("https://print.exemplo/api/whatsapp/despachar", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
}

const SITUACAO = "rpc:whatsapp_despachante_token_situacao";

describe("POST /api/whatsapp/despachar", () => {
  it("sem DESPACHANTE_TOKEN e sem token no Vault: 503 desligado — só pergunta ao banco", async () => {
    banco.responder(SITUACAO, { data: "sem_segredo", error: null });
    const r = await pedir(TOKEN);
    expect(r.status).toBe(503);
    const corpo = await r.json();
    expect(corpo.erro).toBe(DESPACHANTE_DESLIGADO);
    expect(corpo.comoResolver).toContain("Vault");
    expect(banco.chamadas.map((c) => c.tabela)).toEqual([SITUACAO]);
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
  });

  it("sem DESPACHANTE_TOKEN, com o token do Vault: o banco confere e a rodada começa", async () => {
    banco.responder(SITUACAO, { data: "confere", error: null });
    const r = await pedir(TOKEN);
    // Sem ZAPI_TOKEN a rodada para no 503 do Z-API — passou da porta.
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toContain("ZAPI_TOKEN");
    // O token vai para o banco conferir, e só para lá.
    expect(banco.chamadas[0]).toEqual({ tabela: SITUACAO, metodo: "rpc", args: { p_token: TOKEN } });
    expect(JSON.stringify(erros.mock.calls)).not.toContain(TOKEN);
  });

  it("sem DESPACHANTE_TOKEN: token errado ou ausente é 401", async () => {
    banco.responder(SITUACAO, { data: "nao_confere", error: null });
    expect((await pedir("outro-token")).status).toBe(401);
    banco.responder(SITUACAO, { data: "configurado", error: null });
    expect((await pedir(undefined)).status).toBe(401);
    expect((await pedir("")).status).toBe(401);
  });

  it("sem DESPACHANTE_TOKEN e o banco não respondeu: 503, sem abrir a porta", async () => {
    banco.responder(SITUACAO, { data: null, error: { message: "fora do ar" } });
    const r = await pedir(TOKEN);
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toContain("conferir o token");
  });

  it("resposta estranha do banco não vale como 'confere'", async () => {
    banco.responder(SITUACAO, { data: true, error: null });
    expect((await pedir(TOKEN)).status).toBe(503);
  });

  it("token ausente ou errado: 401, sem tocar no banco", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    vi.stubEnv("ZAPI_TOKEN", "zapi");
    for (const errado of [undefined, "", "outro-token", TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const r = await pedir(errado);
      expect(r.status, String(errado)).toBe(401);
      expect(JSON.stringify(await r.json())).not.toContain(TOKEN);
    }
    expect(banco.chamadas).toEqual([]);
  });

  it("o token viaja só no cabeçalho: na URL não vale", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    vi.stubEnv("ZAPI_TOKEN", "zapi");
    const r = await despacharPeloServidor(
      new Request(
        `https://print.exemplo/api/whatsapp/despachar?${CABECALHO_DO_DESPACHANTE}=${TOKEN}&token=${TOKEN}`,
        {
          method: "POST",
        },
      ),
    );
    expect(r.status).toBe(401);
    expect(banco.chamadas).toEqual([]);
  });

  it("token certo: passa pela porta e a rodada começa (sem ZAPI_TOKEN, para no 503 do Z-API — não no 401)", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    const r = await pedir(TOKEN);
    expect(r.status).toBe(503);
    const corpo = await r.json();
    expect(corpo.erro).toContain("ZAPI_TOKEN");
    expect(corpo.erro).not.toBe(DESPACHANTE_DESLIGADO);
  });

  it("token certo com Z-API configurado: lê a instância — a rodada é a mesma do /enviar", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    vi.stubEnv("ZAPI_TOKEN", "zapi");
    banco.responder("whatsapp_instancias", { data: null, error: null });
    const r = await pedir(TOKEN);
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toContain("nenhuma instância");
    expect(banco.chamadas.map((c) => c.tabela)).toContain("whatsapp_instancias");
    // Nada do token foi dito ao console.
    expect(JSON.stringify(erros.mock.calls)).not.toContain(TOKEN);
  });

  it("GET diz se está ligado e de onde vem o token, sem mostrá-lo", async () => {
    banco.responder(SITUACAO, { data: "sem_segredo", error: null });
    expect(await (await saudeDoDespachante()).json()).toMatchObject({ ok: true, ligado: false, token: null });
    banco.responder(SITUACAO, { data: "configurado", error: null });
    expect(await (await saudeDoDespachante()).json()).toMatchObject({ ligado: true, token: "Vault do banco" });
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    const corpo = await (await saudeDoDespachante()).json();
    expect(corpo).toMatchObject({ ligado: true, token: "variável do servidor" });
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
  });
});

describe("POST /api/whatsapp/enviar continua exigindo sessão", () => {
  it("sem Authorization: 401", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    const r = await processarFilaZapi(
      new Request("https://print.exemplo/api/whatsapp/enviar", { method: "POST" }),
    );
    expect(r.status).toBe(401);
    // O token do despachante não abre esta porta.
    const comToken = await processarFilaZapi(
      new Request("https://print.exemplo/api/whatsapp/enviar", {
        method: "POST",
        headers: { [CABECALHO_DO_DESPACHANTE]: TOKEN },
      }),
    );
    expect(comToken.status).toBe(401);
  });
});

describe("a rota e o arquivo de servidor", () => {
  const rota = readFileSync("src/routes/api.whatsapp.despachar.ts", "utf8");
  const servidor = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");

  it("a rota importa o .server dentro do handler — a chave de serviço não entra no pacote do navegador", () => {
    const estaticos = [...rota.matchAll(/^import\s[^;]*from\s+["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(estaticos).toEqual(["@tanstack/react-router"]);
    expect(rota).toMatch(/await import\("@\/lib\/api\/whatsapp-enviar\.server"\)/);
    expect(rota).toMatch(/despacharPeloServidor\(request\)/);
    expect(rota).toMatch(/saudeDoDespachante\(\)/);
  });

  it("a comparação do token é em tempo constante, pelo hash dos dois lados", () => {
    expect(servidor).toMatch(
      /hashesIguais\(await hashDoSegredo\(recebido\), await hashDoSegredo\(esperado\)\)/,
    );
    // E o token nunca vai para log nem para a resposta.
    expect(servidor).not.toMatch(/console\.\w+\([^)]*\b(recebido|esperado)\b/);
  });

  it("o token do Vault é gerado no banco, conferido por função só do service_role", () => {
    const sql = readFileSync("supabase/migrations/20261008020000_despachante_token_no_banco.sql", "utf8");
    expect(sql).toMatch(/vault\.create_secret\(\s*encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.whatsapp_despachante_token_situacao\(text\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.whatsapp_despachante_token_situacao\(text\) TO service_role;/);
    // A função diz a situação e nunca devolve o valor.
    expect(sql).not.toMatch(/RETURN v_segredo/);
    expect(sql).toMatch(/cron\.schedule\(\s*'whatsapp-despachar',\s*'\*\/2 \* \* \* \*'/);
    expect(sql).not.toMatch(/x-despachante-token',\s*'[^(]/);
  });

  it("a migração agenda o job só com o segredo no Vault, lendo-o na hora de rodar", () => {
    const sql = readFileSync("supabase/migrations/20261007150000_whatsapp_onda_1.sql", "utf8");
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_cron;/);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_net;/);
    expect(sql).toMatch(/vault\.decrypted_secrets WHERE name = 'despachante_token'/);
    expect(sql).toMatch(/cron\.schedule\(\s*'whatsapp-despachar',\s*'\*\/2 \* \* \* \*'/);
    expect(sql).toMatch(/'https:\/\/bexprint\.com\.br\/api\/whatsapp\/despachar'/);
    expect(sql).toMatch(new RegExp(`'${CABECALHO_DO_DESPACHANTE}'`));
    // O valor do token não está no repositório em forma nenhuma.
    expect(sql).not.toMatch(/x-despachante-token',\s*'[^(]/);
  });
});
