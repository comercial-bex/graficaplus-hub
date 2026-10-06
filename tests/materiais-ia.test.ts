import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Conferir com IA" no cadastro de material, com o Lovable AI Gateway trocado
 * por um dublê. O que se segura:
 *   - sem chave no servidor não há chamada (e a tela diz que a IA está
 *     desligada, nunca "nenhum duplicado");
 *   - 402 (saldo acabou) e 429 (muitas seguidas) viram o aviso certo;
 *   - o pedido usa o modelo leve, obriga a resposta estruturada e NÃO leva
 *     custo nem estoque;
 *   - a resposta é lida sem confiar (id inventado some);
 *   - só quem cadastra material (admin, gestor, estoque) usa — gasta saldo.
 */

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const construtor: any = {
      middleware: () => construtor,
      inputValidator: () => construtor,
      handler: (fn: (args: unknown) => Promise<unknown>) => fn,
    };
    return construtor;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { conferirComIa, conferirMaterialComIa } from "../src/lib/api/materiais-ia.functions";
import type { MaterialComparavel } from "../src/domain/materiais/parecidos";

const LISTA: MaterialComparavel[] = [
  { id: "a", nome: "Chapa PS 2mm", unidade: "m²", caracteristicas: "branca" },
  { id: "b", nome: "Lona 440g reforçada", unidade: "m²", caracteristicas: null },
  { id: "c", nome: "Tinta solvente (conjunto)", unidade: "ml", caracteristicas: null },
];

function respostaDaIa(argumentos: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(argumentos) } }] } }],
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

let chamadas: { url: string; init: RequestInit }[];
const buscarCom = (resposta: Response | Error) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    if (resposta instanceof Error) throw resposta;
    return resposta;
  }) as unknown as typeof fetch;

beforeEach(() => {
  chamadas = [];
});

describe("conferirComIa", () => {
  it("sem chave no servidor: 'sem_ia' e nenhuma chamada", async () => {
    const buscar = buscarCom(respostaDaIa({}));
    const r = await conferirComIa({ nome: "Poliestireno 2mm" }, async () => LISTA, undefined, buscar);
    expect(r).toEqual({ estado: "sem_ia" });
    expect(chamadas).toHaveLength(0);
  });

  it("nome curto não gasta chamada", async () => {
    const buscar = buscarCom(respostaDaIa({}));
    const r = await conferirComIa({ nome: "ps" }, async () => LISTA, "chave", buscar);
    expect(r.estado).toBe("falhou");
    expect(chamadas).toHaveLength(0);
  });

  it("acha o sinônimo e descarta id inventado", async () => {
    const buscar = buscarCom(
      respostaDaIa({
        duplicados: [
          { id: "a", motivo: "PS é poliestireno, mesma espessura", certeza: "alta" },
          { id: "zz", motivo: "inventado", certeza: "alta" },
        ],
        nome_sugerido: "Chapa PS 2mm",
      }),
    );
    const r = await conferirComIa(
      { nome: "Poliestireno 2mm", unidade: "m2", caracteristicas: "branco" },
      async () => LISTA,
      "chave-secreta",
      buscar,
    );
    expect(r).toEqual({
      estado: "ok",
      duplicados: [{ id: "a", nome: "Chapa PS 2mm", motivo: "PS é poliestireno, mesma espessura", certeza: "alta" }],
      nome_sugerido: "Chapa PS 2mm",
    });
  });

  it("o pedido: gateway do Lovable, modelo leve, resposta obrigatoriamente estruturada, sem custo", async () => {
    const buscar = buscarCom(respostaDaIa({ duplicados: [], nome_sugerido: "" }));
    await conferirComIa(
      { nome: "Lona 440", unidade: "m²" },
      async () => LISTA.map((m) => ({ ...m, custo_medio: 9.99, estoque: 120 }) as MaterialComparavel),
      "chave-secreta",
      buscar,
    );
    expect(chamadas).toHaveLength(1);
    const { url, init } = chamadas[0];
    expect(url).toBe("https://ai.gateway.lovable.dev/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer chave-secreta");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("google/gemini-2.5-flash-lite");
    expect(corpo.tool_choice).toEqual({ type: "function", function: { name: "registrar_conferencia" } });
    expect(corpo.tools[0].function.name).toBe("registrar_conferencia");
    const texto = JSON.stringify(corpo.messages);
    expect(texto).toContain("Lona 440g reforçada");
    expect(texto).not.toMatch(/custo|9\.99|estoque|120/);
    expect(texto).not.toContain("chave-secreta");
  });

  it("402, 429, erro do serviço e rede caída: nunca 'nenhum duplicado'", async () => {
    const casos: [Response | Error, string][] = [
      [new Response("{}", { status: 402 }), "sem_saldo"],
      [new Response("{}", { status: 429 }), "limite"],
      [new Response("{}", { status: 500 }), "falhou"],
      [new Error("rede caiu"), "falhou"],
      [new Response("não é json", { status: 200 }), "falhou"],
      [new Response(JSON.stringify({ choices: [{ message: { content: "texto solto" } }] }), { status: 200 }), "falhou"],
    ];
    for (const [resposta, estado] of casos) {
      const r = await conferirComIa({ nome: "Lona 440g" }, async () => LISTA, "chave", buscarCom(resposta));
      expect(r.estado, String(estado)).toBe(estado);
    }
  });

  it("sem nenhum material cadastrado: nem chama a IA", async () => {
    const buscar = buscarCom(respostaDaIa({}));
    const r = await conferirComIa({ nome: "Lona 440g" }, async () => [], "chave", buscar);
    expect(r).toEqual({ estado: "ok", duplicados: [], nome_sugerido: null });
    expect(chamadas).toHaveLength(0);
  });
});

describe("quem pode usar", () => {
  function contexto(papeis: string[]) {
    return {
      userId: "u1",
      supabase: {
        from: (tabela: string) => ({
          select: () => ({
            eq: async () => ({ data: papeis.map((role) => ({ role })), error: null }),
            order: () => ({ limit: async () => ({ data: LISTA, error: null }) }),
          }),
          tabela,
        }),
      },
    };
  }

  it("vendedor e operador são recusados antes de gastar saldo", async () => {
    const handler = conferirMaterialComIa as unknown as (a: unknown) => Promise<unknown>;
    for (const papeis of [["vendedor"], ["operador"], ["financeiro"], []]) {
      await expect(
        handler({ data: { nome: "Lona 440g" }, context: contexto(papeis) }),
      ).rejects.toThrow(/quem cadastra material/);
    }
  });

  it("gestor passa (sem chave no ambiente de teste: 'sem_ia')", async () => {
    const handler = conferirMaterialComIa as unknown as (a: unknown) => Promise<unknown>;
    const antes = process.env.LOVABLE_API_KEY;
    delete process.env.LOVABLE_API_KEY;
    try {
      await expect(
        handler({ data: { nome: "Lona 440g" }, context: contexto(["gestor"]) }),
      ).resolves.toEqual({ estado: "sem_ia" });
    } finally {
      if (antes !== undefined) process.env.LOVABLE_API_KEY = antes;
    }
  });
});
