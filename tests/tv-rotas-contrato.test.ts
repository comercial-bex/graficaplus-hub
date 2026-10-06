import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gerarSegredo, hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O CONTRATO das rotas da TV, exercido de verdade — com o banco trocado por um
 * dublê que responde o que o teste mandar.
 *
 * `tv-rotas-sem-vazamento` lê o texto dos arquivos; este roda as funções. O que
 * ele segura é o que a tela da TV (outra trilha) vai tratar em cada resposta:
 *   401 = "TV desconectada", 503 = "servidor sem resposta", 200 = dado bom.
 * Se um 503 virar 200 com lista vazia, a parede mostra a oficina parada — e é
 * exatamente o defeito que esta tela nasceu para não ter.
 */

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };
type Chamada = { nome: string; params: Record<string, unknown> | undefined };

const banco = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    fila: new Map<string, unknown[]>(),
    responder(nome: string, ...respostas: unknown[]) {
      estado.fila.set(nome, respostas);
    },
    rpc(nome: string, params?: Record<string, unknown>) {
      estado.chamadas.push({ nome, params });
      const fila = estado.fila.get(nome);
      if (!fila || fila.length === 0) throw new Error(`dublê sem resposta para ${nome}`);
      const proxima = fila.length > 1 ? fila.shift() : fila[0];
      if (proxima instanceof Error) throw proxima;
      return Promise.resolve(proxima);
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (nome: string, params?: Record<string, unknown>) => banco.rpc(nome, params),
  },
}));

import { responderPainel } from "../src/lib/api/tv-painel.server";
import { pareamentoEncerrado } from "../src/lib/api/tv-comum.server";

const ok = (data: unknown): Resposta => ({ data, error: null });
const falha = (): Resposta => ({
  data: null,
  error: { code: "57014", message: "canceling statement" },
});
const chamadasDe = (nome: string): Chamada[] => banco.chamadas.filter((c) => c.nome === nome);

const PAINEL = {
  versao: 1,
  gerado_em: "2026-10-01T18:00:00Z",
  intervalo_s: 60,
  maquinas: [{ nome: "Plotter i1600", estado: "rodando", os_numero: 90 }],
};

let erros: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.fila.clear();
  // As falhas simuladas registram no console.error; o teste confere o que foi dito.
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erros.mockRestore();
});

function pedirPainel(
  token?: string | null,
  url = "https://print.exemplo/api/tv/painel",
): Promise<Response> {
  const headers = new Headers();
  if (token !== undefined && token !== null) headers.set("x-tv-token", token);
  return responderPainel(new Request(url, { headers }));
}

/** Tudo que foi dito ao console e tudo que foi mandado ao banco, num texto só. */
function tudoQueSaiu(): string {
  return JSON.stringify([erros.mock.calls, banco.chamadas]);
}

describe("GET /api/tv/painel", () => {
  it("sem crachá: 401 tv_nao_pareada, sem nem ir ao banco", async () => {
    for (const token of [undefined, "", "1234", "a".repeat(44), `${"a".repeat(42)}=`]) {
      const r = await pedirPainel(token);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ erro: "tv_nao_pareada" });
    }
    expect(banco.chamadas).toHaveLength(0);
  });

  it("token na URL não vale: só o cabeçalho é lido", async () => {
    const token = gerarSegredo();
    const r = await pedirPainel(
      undefined,
      `https://print.exemplo/api/tv/painel?token=${token}&x-tv-token=${token}`,
    );
    expect(r.status).toBe(401);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("crachá desconhecido: 401 tv_nao_pareada e o painel não é consultado", async () => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "desconhecida" }));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "tv_nao_pareada" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it("crachá revogado: 401 tv_revogada e o painel não é consultado", async () => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "revogada" }));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "tv_revogada" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it("crachá bom: 200 com o jsonb da função, sem mexer, e sem cache", async () => {
    const token = gerarSegredo();
    banco.responder("tv_conferir_dispositivo", ok({ estado: "ativa", nome: "TV da Oficina" }));
    banco.responder("tv_painel_maquinas", ok(PAINEL));
    const r = await pedirPainel(token);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(PAINEL);

    // O banco recebe o SHA-256 do crachá, nunca o crachá.
    const [conferencia] = chamadasDe("tv_conferir_dispositivo");
    expect(conferencia.params).toEqual({ p_token_hash: await hashDoSegredo(token) });
    expect(chamadasDe("tv_painel_maquinas")[0].params).toBeUndefined();
    expect(tudoQueSaiu()).not.toContain(token);
  });

  it.each([
    ["conferência com erro do banco", () => banco.responder("tv_conferir_dispositivo", falha())],
    ["conferência que devolve nulo", () => banco.responder("tv_conferir_dispositivo", ok(null))],
    [
      "conferência com estado que o servidor não conhece",
      () => banco.responder("tv_conferir_dispositivo", ok({ estado: "talvez" })),
    ],
    [
      "conferência que estoura",
      () => banco.responder("tv_conferir_dispositivo", new Error("fetch failed")),
    ],
  ])("%s: 503, nunca 401 (a TV apagaria um crachá bom)", async (_nome, preparar) => {
    preparar();
    banco.responder("tv_painel_maquinas", ok(PAINEL));
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: "banco_indisponivel" });
    expect(chamadasDe("tv_painel_maquinas")).toHaveLength(0);
  });

  it.each([
    ["função do painel com erro (ainda não existe, timeout…)", falha()],
    ["função do painel devolvendo nulo", ok(null)],
    ["função do painel devolvendo lista em vez de objeto", ok([])],
    ["função do painel devolvendo texto", ok("")],
    ["função do painel estourando", new Error("fetch failed")],
  ])("%s: 503, NUNCA 200 com vazio", async (_nome, resposta) => {
    banco.responder("tv_conferir_dispositivo", ok({ estado: "ativa", nome: "TV" }));
    banco.responder("tv_painel_maquinas", resposta);
    const r = await pedirPainel(gerarSegredo());
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ erro: "banco_indisponivel" });
  });

  it("a falha é registrada sem token e sem hash", async () => {
    const token = gerarSegredo();
    banco.responder("tv_conferir_dispositivo", falha());
    await pedirPainel(token);
    expect(erros).toHaveBeenCalled();
    const dito = JSON.stringify(erros.mock.calls);
    expect(dito).not.toContain(token);
    expect(dito).not.toContain(await hashDoSegredo(token));
    expect(dito).toContain("tv_conferir_dispositivo");
  });
});

describe("/api/tv/parear — encerrada (a TV entra só pelo PIN desde 06/10/2026)", () => {
  it("410 com o motivo, sem cache e sem ir ao banco", async () => {
    const r = pareamentoEncerrado();
    expect(r.status).toBe(410);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({
      erro: "so_pin",
      mensagem: "A TV da oficina entra só pelo PIN. Recarregue a página da TV.",
    });
    expect(banco.chamadas).toHaveLength(0);
  });
});
