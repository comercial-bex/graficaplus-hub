import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As funções de servidor da tela de preços pendentes, chamadas como o servidor chamaria, com dublê do Supabase:
 * quem não vê custo é recusado antes de ler; só admin ou gerente decide; a decisão vai pelas funções do banco
 * com a sessão de quem pediu; erro do banco vira erro, nunca lista vazia.
 */

const d = vi.hoisted(() => ({
  verCusto: true,
  papeis: new Set<string>(["admin"]),
  chamadas: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  linhas: [] as unknown[],
  erroDaLeitura: null as null | { message: string },
  erroRpc: null as null | { message: string },
  m2: [{ preco_base: "45.00" }, { preco_base: "70.00" }] as unknown[],
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
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => Promise.resolve({ data: d.m2, error: null });
      return q;
    },
  },
}));

import {
  aprovarPrecoProposto,
  lerPrecosPendentes,
  recusarPrecoProposto,
} from "../../src/lib/api/precos-pendentes.functions";

const contexto = () => ({
  userId: "u1",
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      d.chamadas.push({ fn, args });
      if (fn === "pode_ver_custo") return Promise.resolve({ data: d.verCusto, error: null });
      if (fn === "has_role") return Promise.resolve({ data: d.papeis.has(args._role as string), error: null });
      return Promise.resolve({ data: { ok: true }, error: d.erroRpc });
    },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => Promise.resolve({ data: d.linhas, error: d.erroDaLeitura });
      return q;
    },
  },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ler = () => (lerPrecosPendentes as any)({ context: contexto() }) as ReturnType<typeof lerPrecosPendentes>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aprovar = (id = "id1") => (aprovarPrecoProposto as any)({ data: { id }, context: contexto() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recusar = (nota = "Não vale") => (recusarPrecoProposto as any)({ data: { id: "id1", nota }, context: contexto() });

beforeEach(() => {
  d.verCusto = true;
  d.papeis = new Set(["admin"]);
  d.chamadas = [];
  d.erroDaLeitura = null;
  d.erroRpc = null;
  d.linhas = [
    { id: "a", produto_id: "p", produto_nome: "Necessaire", unidade: "un", preco_atual: "40", preco_proposto: "49.9", custo: "30", piso: "42.86", margem_minima: "30", margem_atual: "25", margem_proposta: "39.88", motivo: "x", origem: "referencia_m2", created_at: "2026-11-15" },
  ];
});

describe("leitura", () => {
  it("quem não vê custo é recusado antes de ler", async () => {
    d.verCusto = false;
    await expect(ler()).rejects.toThrow(/não vê custo/);
    expect(d.chamadas.map((c) => c.fn)).toEqual(["pode_ver_custo"]);
  });
  it("devolve números de verdade, a média e a referência de 70", async () => {
    const r = await ler();
    expect(r.propostas[0].preco_proposto).toBe(49.9);
    expect(r.propostas[0].origem).toBe("referencia_m2");
    expect(r.mediaM2).toEqual({ media: 57.5, quantidade: 2 });
    expect(r.referencia).toBe(70);
    expect(r.podeDecidir).toBe(true);
  });
  it("quem vê custo mas não é admin nem gerente lê e não decide", async () => {
    d.papeis = new Set();
    const r = await ler();
    expect(r.podeDecidir).toBe(false);
  });
  it("erro de leitura vira erro, nunca lista vazia", async () => {
    d.erroDaLeitura = { message: "falhou" };
    await expect(ler()).rejects.toThrow("falhou");
  });
});

describe("decisão", () => {
  it("aprovar chama a função do banco com a sessão de quem pediu", async () => {
    await aprovar("id9");
    const c = d.chamadas.find((x) => x.fn === "preco_proposta_aprovar");
    expect(c?.args).toEqual({ p_id: "id9" });
  });
  it("gerente também aprova", async () => {
    d.papeis = new Set(["gestor"]);
    await expect(aprovar()).resolves.toEqual({ ok: true });
  });
  it("financeiro sem papel de gestão não aprova nem recusa, e nada vai ao banco", async () => {
    d.papeis = new Set();
    await expect(aprovar()).rejects.toThrow(/administrador ou gerente/);
    await expect(recusar()).rejects.toThrow(/administrador ou gerente/);
    expect(d.chamadas.some((c) => c.fn.startsWith("preco_proposta_"))).toBe(false);
  });
  it("quem não vê custo não decide", async () => {
    d.verCusto = false;
    await expect(aprovar()).rejects.toThrow(/não vê custo/);
  });
  it("recusar leva a nota", async () => {
    await recusar("Preço fixo de parceiro");
    expect(d.chamadas.find((x) => x.fn === "preco_proposta_recusar")?.args).toEqual({ p_id: "id1", p_nota: "Preço fixo de parceiro" });
  });
  it("erro do banco volta como erro", async () => {
    d.erroRpc = { message: "O preço do produto mudou depois da proposta." };
    await expect(aprovar()).rejects.toThrow(/mudou/);
  });
});
