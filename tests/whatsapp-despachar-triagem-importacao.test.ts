import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O módulo da triagem não carrega (importação dinâmica falha): a linha de triagem ESPERA (adia) e a fila segue.
 * Antes, a exceção subia da rodada inteira e o aviso de pedido e a resposta da IA ficavam parados junto.
 */

const banco = vi.hoisted(() => {
  const e = {
    linhas: [] as unknown[],
    fila: [] as { id: string; status: string }[],
    from(tabela: string) {
      let verbo = "select";
      const filtros: Record<string, unknown> = {};
      const c: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "neq", "in", "is", "gte", "lte", "lt", "gt", "or", "not", "limit", "maybeSingle", "single", "order"]) {
        c[m] = (...args: unknown[]) => {
          if (m === "insert" || m === "update" || m === "delete") verbo = m;
          if (m === "eq") filtros[String(args[0])] = args[1];
          return c;
        };
      }
      c.then = (resolve: (v: unknown) => unknown) => {
        let r: unknown = { data: [], error: null };
        if (tabela === "whatsapp_instancias") r = { data: { id: "inst-1", zapi_instance_id: "INST", conectado: true }, error: null };
        else if (tabela === "whatsapp_fila_envio") {
          if (verbo === "update") r = { data: [{ id: "x" }], error: null };
          else r = { data: filtros.status === "pendente" ? e.linhas : [], error: null };
        } else if (tabela === "whatsapp_mensagens" && verbo === "update") r = { data: [{ id: "x" }], error: null };
        else if (tabela === "whatsapp_conversas") r = { data: { telefone: "96991112233", fila: null }, error: null };
        else if (tabela === "whatsapp_logs") r = { data: null, error: null };
        return Promise.resolve(r).then(resolve);
      };
      return c;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return e;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => banco.from(t),
    rpc: () => banco.rpc(),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "sem sessão" } }) },
  },
}));
// o módulo da triagem não carrega: a importação dinâmica rejeita
vi.mock("@/lib/api/whatsapp-triagem.server", () => {
  throw new Error("módulo quebrado");
});

import { rodadaDoServidor } from "../src/lib/api/whatsapp-enviar.server";

let corpos: Record<string, unknown>[];
let fetchOriginal: typeof fetch;

beforeEach(() => {
  vi.stubEnv("ZAPI_TOKEN", "token-zapi");
  vi.stubEnv("ZAPI_CLIENT_TOKEN", "client-token");
  corpos = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    corpos.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ messageId: "zap-1", id: "zap-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("importação da triagem falhando na rodada", () => {
  it("a linha de triagem espera e a resposta da IA da mesma rodada sai", async () => {
    banco.linhas = [
      {
        id: "f-1",
        conversa_id: "c-1",
        mensagem_id: "m-1",
        payload: { tipo: "texto", texto: "Pergunta da triagem", atraso_s: 5, triagem_id: "t-1", passo: "nome" },
        tentativas: 0,
        created_by: null,
        idempotency_key: "triagem:t-1:nome:1",
      },
      {
        id: "f-2",
        conversa_id: "c-1",
        mensagem_id: "m-2",
        payload: { tipo: "texto", texto: "Resposta da assistente" },
        tentativas: 0,
        created_by: null,
        idempotency_key: "ia:m-2",
      },
    ];
    // sem varrer: a importação da varredura é outro caminho, já protegido
    const r = await rodadaDoServidor({ varrer: false });
    const corpo = await r.json();
    expect(corpos).toEqual([{ phone: "5596991112233", message: "Resposta da assistente" }]);
    expect(corpo.enviadas).toBe(1);
    // a triagem não foi cancelada nem reservada: a linha segue pendente para a próxima rodada
    expect(corpo.erros_de_gravacao ?? []).toHaveLength(1);
  });

  it("a varredura também não derruba a rodada quando o módulo não carrega", async () => {
    banco.linhas = [];
    const r = await rodadaDoServidor();
    const corpo = await r.json();
    expect(r.status).toBe(200);
    expect(corpo.triagem).toEqual({ erro: true });
  });
});
