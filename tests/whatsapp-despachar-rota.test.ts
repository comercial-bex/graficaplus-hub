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
 *   503 "despachante do servidor desligado"  sem DESPACHANTE_TOKEN no servidor
 *                                            (e o navegador segue valendo)
 *   401                                      token ausente ou errado
 *   passa                                    token certo: a rodada começa
 * E que nenhuma resposta nem log leva o token.
 */

const banco = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { tabela: string; metodo: string }[],
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
    rpc(nome: string) {
      estado.chamadas.push({ tabela: `rpc:${nome}`, metodo: "rpc" });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => banco.from(tabela),
    rpc: (nome: string) => banco.rpc(nome),
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

describe("POST /api/whatsapp/despachar", () => {
  it("sem DESPACHANTE_TOKEN no servidor: 503 desligado, sem tocar no banco — mesmo com token no cabeçalho", async () => {
    const r = await pedir(TOKEN);
    expect(r.status).toBe(503);
    const corpo = await r.json();
    expect(corpo.erro).toBe(DESPACHANTE_DESLIGADO);
    expect(corpo.comoResolver).toContain("DESPACHANTE_TOKEN");
    expect(banco.chamadas).toEqual([]);
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
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

  it("GET diz se está ligado, sem mostrar o token", async () => {
    expect(await saudeDoDespachante().json()).toMatchObject({ ok: true, ligado: false });
    vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
    const corpo = await saudeDoDespachante().json();
    expect(corpo.ligado).toBe(true);
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
