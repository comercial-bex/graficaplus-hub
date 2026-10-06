import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "LINK DO CLIENTE" E "WHATSAPP" EM /orcamentos/$id NUNCA FUNCIONARAM.
 *
 * A função de servidor lia `orcamentos.token_publico` com a sessão de quem
 * clicou. O papel authenticated não tem SELECT nessa coluna (o token é a
 * credencial do cliente), e o banco recusava a consulta inteira — 42501 para
 * todo mundo, admin inclusive. A função trocava o erro por "Orçamento não
 * encontrado". Em 05/10/2026, 0 de 18 orçamentos tinham link.
 *
 * Agora o token sai de `orcamento_link_publico`, função do banco que confere
 * `orcamentos.send`. O handler é exercido com o cliente do banco trocado por um
 * dublê que anota o que foi pedido.
 */

const dubles = vi.hoisted(() => ({
  handlers: [] as ((args: unknown) => Promise<unknown>)[],
  tabelasLidas: [] as string[],
  rpcs: [] as { nome: string; params: unknown }[],
  resposta: { data: null as unknown, error: null as unknown },
}));

// createServerFn devolve o próprio handler: o teste chama a função como o
// servidor chamaria, com `data` e o `context` do middleware de login.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const construtor: any = {
      middleware: () => construtor,
      inputValidator: () => construtor,
      handler: (fn: (args: unknown) => Promise<unknown>) => {
        dubles.handlers.push(fn);
        return fn;
      },
    };
    return construtor;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { gerarLinkPublicoOrcamento } from "../src/lib/api/orcamento-publico.functions";

const ORC = "7976ca75-fe2a-4c19-9acf-a24672fdb298";

const contexto = () => ({
  userId: "1c72900c-a334-4caa-bd3e-6159ac68fa2f",
  supabase: {
    from: (tabela: string) => {
      dubles.tabelasLidas.push(tabela);
      // A tabela, lida direto com a sessão do usuário, recusa a coluna do token.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => b,
        single: () =>
          Promise.resolve({
            data: null,
            error: { code: "42501", message: "permission denied for table orcamentos" },
          }),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for table orcamentos" } }).then(ok),
      };
      return b;
    },
    rpc: (nome: string, params: unknown) => {
      dubles.rpcs.push({ nome, params });
      return Promise.resolve(dubles.resposta);
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chamar = () => (gerarLinkPublicoOrcamento as any)({ data: { orcamentoId: ORC }, context: contexto() });

beforeEach(() => {
  dubles.tabelasLidas.length = 0;
  dubles.rpcs.length = 0;
  dubles.resposta = { data: null, error: null };
});

describe("gerarLinkPublicoOrcamento", () => {
  it("pega o token pela função do banco, sem ler a coluna protegida da tabela", async () => {
    dubles.resposta = { data: "4a7c5b1e-0d1f-4c55-9a51-0c7f3e9b2d10", error: null };
    await expect(chamar()).resolves.toEqual({ token: "4a7c5b1e-0d1f-4c55-9a51-0c7f3e9b2d10" });
    expect(dubles.rpcs).toEqual([{ nome: "orcamento_link_publico", params: { p_orcamento_id: ORC } }]);
    expect(dubles.tabelasLidas).toEqual([]);
  });

  it("sem permissão, a mensagem diz a causa real — não 'orçamento não encontrado'", async () => {
    dubles.resposta = {
      data: null,
      error: {
        code: "42501",
        message: "Seu perfil não pode mandar orçamento para o cliente: falta a permissão orcamentos.send.",
      },
    };
    await expect(chamar()).rejects.toThrow(/falta a permissão orcamentos\.send/);
  });

  it("orçamento que não existe diz isso", async () => {
    dubles.resposta = { data: null, error: { code: "P0002", message: "Orçamento não encontrado." } };
    await expect(chamar()).rejects.toThrow("Orçamento não encontrado.");
  });

  it("resposta sem token é erro, não link quebrado para o cliente", async () => {
    dubles.resposta = { data: null, error: null };
    await expect(chamar()).rejects.toThrow(/não devolveu o link/);
  });
});
