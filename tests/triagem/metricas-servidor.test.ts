import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A função de servidor das métricas (B10) chamada como o servidor chamaria, com dublê do cliente do Supabase:
 * a permissão é conferida, erro de leitura vira erro (nunca lista vazia), contagem em texto vira número e o ramo
 * desconhecido cai em "cliente".
 */

const dubles = vi.hoisted(() => ({
  permissoes: new Set<string>(["configuracoes.manage"]),
  respostas: {} as Record<string, { data: unknown; error: null | { message: string; code?: string } }>,
  filtros: [] as { view: string; col: string; valor: unknown }[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = { middleware: () => c, inputValidator: () => c, handler: (fn: unknown) => fn };
    return c;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (view: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.gte = (col: string, valor: unknown) => {
        dubles.filtros.push({ view, col, valor });
        return q;
      };
      q.order = () => q;
      q.limit = () => Promise.resolve(dubles.respostas[view] ?? { data: [], error: null });
      return q;
    },
  },
}));

import { lerMetricasDaTriagem } from "../../src/lib/api/whatsapp-triagem.functions";

const contexto = (temPermissao: (p: string) => boolean = (p) => dubles.permissoes.has(p)) => ({
  context: {
    userId: "u1",
    supabase: {
      rpc: (_fn: string, args: { _permission: string }) =>
        Promise.resolve({ data: temPermissao(args._permission), error: null }),
    },
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chamar = (c = contexto()) => (lerMetricasDaTriagem as any)(c) as ReturnType<typeof lerMetricasDaTriagem>;

beforeEach(() => {
  dubles.permissoes = new Set(["configuracoes.manage"]);
  dubles.respostas = {};
  dubles.filtros = [];
});

describe("lerMetricasDaTriagem", () => {
  it("sem nenhuma das duas permissões, recusa", async () => {
    dubles.permissoes = new Set();
    await expect(chamar()).rejects.toThrow(/não tem a permissão/);
  });

  it("aceita quem tem só whatsapp.manage", async () => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    await expect(chamar()).resolves.toEqual({ dias: [], janela: [] });
  });

  it("numero(): texto e número viram número, o resto vira 0 sem sumir a linha", async () => {
    dubles.respostas.triagem_metricas_dia = {
      error: null,
      data: [
        {
          dia: "2026-11-13",
          ramo: "cliente",
          triadas: "7", // bigint volta como texto
          concluidas: 3,
          abandonadas: null,
          entregues_equipe: "abc",
          soma_segundos_ate_concluir: "360",
        },
      ],
    };
    const r = await chamar();
    expect(r.dias).toHaveLength(1);
    expect(r.dias[0]).toMatchObject({
      dia: "2026-11-13",
      triadas: 7,
      concluidas: 3,
      abandonadas: 0,
      entregues_equipe: 0,
      soma_segundos_ate_concluir: 360,
      puladas: 0, // coluna ausente
    });
    expect(Object.keys(r.dias[0]).length).toBe(16);
  });

  it("ramo: só 'parceiro' é parceiro, qualquer outra coisa é cliente", async () => {
    dubles.respostas.triagem_metricas_30_dias = {
      error: null,
      data: [{ ramo: "parceiro", triadas: 1 }, { ramo: "outro", triadas: 2 }, { ramo: null, triadas: 3 }, { ramo: "cliente", triadas: 4 }],
    };
    const r = await chamar();
    expect(r.janela.map((l) => l.ramo)).toEqual(["parceiro", "cliente", "cliente", "cliente"]);
    expect(r.janela.map((l) => l.triadas)).toEqual([1, 2, 3, 4]);
  });

  it("mediana: nula continua nula, texto vira número, e a pausa por humano vem da view de 30 dias", async () => {
    dubles.respostas.triagem_metricas_30_dias = {
      error: null,
      data: [
        { ramo: "cliente", mediana_segundos_ate_concluir: null, triagens_com_pausa_humano: "5" },
        { ramo: "parceiro", mediana_segundos_ate_concluir: "200" },
      ],
    };
    const r = await chamar();
    expect(r.janela[0].mediana_segundos_ate_concluir).toBeNull();
    expect(r.janela[0].triagens_com_pausa_humano).toBe(5);
    expect(r.janela[1].mediana_segundos_ate_concluir).toBe(200);
    expect(r.janela[1].triagens_com_pausa_humano).toBe(0);
  });

  it("filtra os dias pela janela de 30 dias de Macapá", async () => {
    await chamar();
    const f = dubles.filtros.find((x) => x.view === "triagem_metricas_dia")!;
    expect(f.col).toBe("dia");
    expect(String(f.valor)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("erro de leitura vira erro, nunca lista vazia", async () => {
    dubles.respostas.triagem_metricas_30_dias = { data: null, error: { message: "boom" } };
    await expect(chamar()).rejects.toThrow("boom");
  });

  it("view que não existe diz que a migração não foi aplicada", async () => {
    dubles.respostas.triagem_metricas_dia = {
      data: null,
      error: { message: 'relation "public.triagem_metricas_dia" does not exist', code: "42P01" },
    };
    await expect(chamar()).rejects.toThrow(/ainda não foram instaladas no banco/);
  });
});
