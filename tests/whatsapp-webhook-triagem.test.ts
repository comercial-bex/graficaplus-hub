import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O webhook chama a triagem DEPOIS de gravar a mensagem e ANTES da assistente, e a triagem
 * nunca derruba o 200. Os eventos são os de tests/fixtures/zapi-eventos-06-10.json.
 *   mensagem de pessoa        triagem e assistente, nessa ordem, com os ids da mensagem gravada
 *   triagem que lança         200, o erro vai na resposta e a assistente ainda é chamada
 *   eco, modelo e repetida    nenhuma das duas é chamada
 */

const SEGREDO = "segredo-do-webhook-de-teste";

const banco = vi.hoisted(() => ({
  gravada: { duplicada: false, mensagem_id: "msg-1", conversa_id: "conv-1" } as Record<
    string,
    unknown
  >,
}));
const ordem = vi.hoisted(() => ({
  chamadas: [] as string[],
  triagem: null as null | ((...a: unknown[]) => unknown),
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const cadeia = (tabela: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    let verbo = "select";
    for (const m of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "neq",
      "in",
      "is",
      "gte",
      "lte",
      "lt",
      "gt",
      "or",
      "not",
      "limit",
      "maybeSingle",
      "single",
      "order",
    ]) {
      c[m] = () => {
        if (m === "insert" || m === "update" || m === "delete") verbo = m;
        return c;
      };
    }
    c.then = (resolve: (v: unknown) => unknown) => {
      const data =
        tabela === "whatsapp_instancias"
          ? {
              id: "inst-1",
              webhook_secret_hash: (globalThis as { __hash?: string }).__hash,
              ativa: true,
            }
          : tabela === "whatsapp_webhook_eventos" && verbo === "insert"
            ? { id: "evt-1" }
            : null;
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return c;
  };
  return {
    supabaseAdmin: {
      from: (t: string) => cadeia(t),
      rpc: () => Promise.resolve({ data: banco.gravada, error: null }),
      storage: {
        from: () => ({
          list: async () => ({ data: [], error: null }),
          upload: async () => ({ data: null, error: null }),
        }),
      },
    },
  };
});
vi.mock("@/lib/api/whatsapp-triagem.server", () => ({
  triagemSemDerrubar: async (...a: unknown[]) => {
    ordem.chamadas.push(`triagem:${JSON.stringify(a)}`);
    if (ordem.triagem) return ordem.triagem(...a);
    return { acao: "nada", motivo: "desligada" };
  },
}));
vi.mock("@/lib/api/whatsapp-assistente.server", () => ({
  assistenteSemDerrubar: async (...a: unknown[]) => {
    ordem.chamadas.push(`assistente:${JSON.stringify(a)}`);
    return { acao: "nada", motivo: "ia_desligada" };
  },
}));
vi.mock("@/lib/api/whatsapp-fotos.server", () => ({ fotoPeloWebhook: async () => null }));

import { eventoDeGrupo, processarWebhookZapi } from "../src/lib/api/whatsapp-webhook.server";

const EVENTOS = JSON.parse(
  readFileSync("tests/fixtures/zapi-eventos-06-10.json", "utf8"),
) as Record<string, Record<string, unknown>>;
const { hydratedTemplate: _modelo, ...base } = EVENTOS.modelo_claro;
void _modelo;

beforeEach(async () => {
  (globalThis as { __hash?: string }).__hash = await hashDoSegredo(SEGREDO);
  ordem.chamadas.length = 0;
  ordem.triagem = null;
  banco.gravada = { duplicada: false, mensagem_id: "msg-1", conversa_id: "conv-1" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function receber(payload: unknown): Promise<Response> {
  return processarWebhookZapi(
    new Request(`https://print.exemplo/api/whatsapp/webhook?token=${encodeURIComponent(SEGREDO)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

const pessoa = (texto = "oi") => ({
  ...base,
  messageId: `id-${texto}-${Math.random()}`,
  fromMe: false,
  fromApi: false,
  text: { message: texto },
});

describe("a triagem entra no webhook antes da assistente", () => {
  it("mensagem de pessoa: triagem primeiro, depois a assistente, com os ids da mensagem gravada", async () => {
    const r = await receber(pessoa());
    expect(r.status).toBe(200);
    expect(ordem.chamadas).toHaveLength(2);
    expect(ordem.chamadas[0]).toBe('triagem:["conv-1","msg-1",{"ehGrupo":false}]');
    expect(ordem.chamadas[1]).toBe('assistente:["conv-1","msg-1"]');
    expect(await r.json()).toMatchObject({
      triagem: { acao: "nada", motivo: "desligada" },
      assistente: { acao: "nada" },
    });
  });

  it("triagem que lança: o 200 continua, o erro vai na resposta e a assistente ainda roda", async () => {
    ordem.triagem = () => {
      throw new Error("banco fora");
    };
    const r = await receber(pessoa());
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.triagem).toMatchObject({ acao: "erro" });
    expect(ordem.chamadas.some((c) => c.startsWith("assistente:"))).toBe(true);
  });

  it("mensagem repetida: nem triagem nem assistente", async () => {
    banco.gravada = { duplicada: true };
    const r = await receber(pessoa());
    expect(r.status).toBe(200);
    expect(ordem.chamadas).toEqual([]);
  });

  it("eco do celular da empresa e mensagem de modelo: nem triagem nem assistente", async () => {
    await receber({ ...base, fromMe: true, fromApi: false, text: { message: "chegou?" } });
    await receber(EVENTOS.modelo_claro);
    expect(ordem.chamadas).toEqual([]);
  });

  it("a ordem no código: a triagem vem antes da assistente, as duas dentro de try/catch", () => {
    const src = readFileSync("src/lib/api/whatsapp-webhook.server.ts", "utf8");
    const t = src.indexOf("triagemSemDerrubar(");
    const a = src.indexOf("assistenteSemDerrubar(");
    expect(t).toBeGreaterThan(0);
    expect(a).toBeGreaterThan(t);
    const trecho = src.slice(src.lastIndexOf("try {", t), t);
    expect(trecho).toContain("whatsapp-triagem.server");
  });
});

describe("grupo", () => {
  it("o telefone de grupo é reconhecido pelos dois sufixos", () => {
    const ev = (telefone: string) =>
      ({ tipo: "mensagem", telefone }) as unknown as Parameters<typeof eventoDeGrupo>[0];
    expect(eventoDeGrupo(ev("120363000000000000-group"))).toBe(true);
    expect(eventoDeGrupo(ev("120363000000@g.us"))).toBe(true);
    expect(eventoDeGrupo(ev("5596991112233"))).toBe(false);
    expect(
      eventoDeGrupo({ tipo: "conexao", instanceId: "x", conectado: true, momento: null }),
    ).toBe(false);
  });
});
