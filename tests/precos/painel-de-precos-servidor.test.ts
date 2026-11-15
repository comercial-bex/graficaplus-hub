import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As funções de servidor da tela de preços por produto, com dublê do Supabase: quem não vê custo é recusado,
 * só admin ou gerente pede preço, o pedido vai SÓ pela função preco_proposta_criar (nunca por UPDATE em produtos)
 * e a falta da função no banco vira frase humana.
 */

const d = vi.hoisted(() => ({
  verCusto: true,
  papeis: new Set<string>(["gestor"]),
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  escritas: 0,
  erroRpc: null as null | { message: string },
  produtos: [] as unknown[],
  cheios: [] as unknown[],
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
    from: (tabela: string) => {
      const q: Record<string, unknown> = {};
      q.select = () =>
        tabela === "produto_custo_cheio" ? Promise.resolve({ data: d.cheios, error: null }) : q;
      q.eq = () => q;
      q.order = () => Promise.resolve({ data: d.produtos, error: null });
      q.update = () => {
        d.escritas += 1;
        return q;
      };
      q.insert = q.update;
      return q;
    },
  },
}));

import { lerPrecosPorProduto, proporPreco } from "../../src/lib/api/precos-por-produto.functions";

const contexto = () => ({
  userId: "u1",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      d.chamadas.push({ fn, args });
      if (fn === "pode_ver_custo") return Promise.resolve({ data: d.verCusto, error: null });
      if (fn === "has_role")
        return Promise.resolve({ data: d.papeis.has(args._role as string), error: null });
      return Promise.resolve({ data: "11111111-1111-4111-8111-111111111111", error: d.erroRpc });
    },
  },
});

const ler = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (lerPrecosPorProduto as any)({ context: contexto() }) as ReturnType<typeof lerPrecosPorProduto>;
const propor = (preco = 70.4, motivo = "") =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proporPreco as any)({
    data: { produtoId: "00000000-0000-4000-8000-000000000001", preco, motivo },
    context: contexto(),
  });

beforeEach(() => {
  d.verCusto = true;
  d.papeis = new Set(["gestor"]);
  d.chamadas = [];
  d.escritas = 0;
  d.erroRpc = null;
  d.produtos = [
    {
      id: "a",
      nome: "Banner",
      familia: "Banners",
      unidade: "m2",
      custo_medio: "30",
      preco_base: "45.5",
      margem_minima: "40",
      preco_parceiro: "40",
    },
    {
      id: "b",
      nome: "Impressão 3D",
      familia: null,
      unidade: "un",
      custo_medio: null,
      preco_base: null,
      margem_minima: "30",
      preco_parceiro: null,
    },
  ];
  d.cheios = [{ produto_id: "a", custo_cheio: "38.2" }];
});

describe("ler os preços", () => {
  it("devolve números, não texto, e junta o custo cheio", async () => {
    const r = await ler();
    expect(r.podePropor).toBe(true);
    expect(r.linhas[0]).toEqual({
      id: "a",
      nome: "Banner",
      familia: "Banners",
      unidade: "m2",
      custo: 30,
      custo_cheio: 38.2,
      preco: 45.5,
      margem_minima: 40,
      preco_parceiro: 40,
    });
    expect(r.linhas[1].custo).toBeNull();
    expect(r.linhas[1].preco).toBeNull();
    expect(r.linhas[1].custo_cheio).toBeNull();
  });
  it("quem não vê custo é recusado antes de ler", async () => {
    d.verCusto = false;
    await expect(ler()).rejects.toThrow("não vê custo");
  });
  it("quem vê custo mas não é admin nem gerente lê, sem poder propor", async () => {
    d.papeis = new Set();
    expect((await ler()).podePropor).toBe(false);
  });
});

describe("pedir preço", () => {
  it("chama só preco_proposta_criar com a assinatura combinada e nunca escreve em produtos", async () => {
    const r = await propor(70.4, "Custo subiu");
    expect(r).toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111" });
    const criar = d.chamadas.filter((c) => c.fn === "preco_proposta_criar");
    expect(criar).toHaveLength(1);
    expect(criar[0].args).toEqual({
      p_produto_id: "00000000-0000-4000-8000-000000000001",
      p_preco: 70.4,
      p_motivo: "Custo subiu",
    });
    expect(d.escritas).toBe(0);
  });
  it("sem motivo manda um motivo padrão, porque a função exige texto", async () => {
    await propor(70.4, "");
    const criar = d.chamadas.find((c) => c.fn === "preco_proposta_criar");
    expect(String(criar?.args.p_motivo).length).toBeGreaterThan(3);
  });
  it("quem não é admin nem gerente não pede", async () => {
    d.papeis = new Set();
    await expect(propor()).rejects.toThrow("Só administrador ou gerente");
    expect(d.chamadas.some((c) => c.fn === "preco_proposta_criar")).toBe(false);
  });
  it("quem não vê custo não pede", async () => {
    d.verCusto = false;
    await expect(propor()).rejects.toThrow("não vê custo");
  });
  it("função ausente no banco vira mensagem humana", async () => {
    d.erroRpc = {
      message:
        "Could not find the function public.preco_proposta_criar(p_motivo, p_preco, p_produto_id) in the schema cache",
    };
    await expect(propor()).rejects.toThrow("Avise o suporte");
  });
  it("erro do banco passa como erro, nunca como sucesso", async () => {
    d.erroRpc = { message: "Já existe uma proposta pendente para este produto." };
    await expect(propor()).rejects.toThrow("Já existe uma proposta pendente");
  });
});
