import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Preço de cliente final × parceiro no orçamento (22/10/2026). Ensaio com
 * rollback antes de aplicar: banner 2×1 m foi de R$ 220 (tabela) para R$ 80
 * (parceiro, R$ 40/m²) e voltou a R$ 220; item livre não mudou; perfil sem
 * orcamentos.update barrado; 0 aviso. O ensaio também pegou que recriar uma view
 * descarta security_invoker/security_barrier — a migração as repõe.
 */

const h = vi.hoisted(() => ({
  entrar: vi.fn(),
  rpc: vi.fn(),
  parceiroAtivo: false,
  claims: { email: "jhessy@bexprint.com.br" } as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: {
    server: () => ({}),
    options: {},
  },
}));
vi.mock("@tanstack/react-start", () => {
  const cadeia: any = {
    middleware: () => cadeia,
    inputValidator: (v: (d: unknown) => unknown) => {
      cadeia._v = v;
      return cadeia;
    },
    handler: (fn: any) => async (entrada: { data: unknown }) =>
      fn({ data: cadeia._v(entrada.data), context: { userId: "u1", claims: h.claims } }),
  };
  return { createServerFn: () => cadeia };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword: h.entrar, signOut: async () => undefined } }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));

import { confirmarPrecoDoOrcamento } from "../src/lib/api/orcamento-preco.functions";

const ORC = "996f3d96-b34b-49fa-9be6-4f94c43129c7";

describe("confirmar o preço de parceiro exige a senha de quem pediu", () => {
  beforeEach(() => {
    h.entrar.mockReset();
    h.rpc.mockReset();
    h.parceiroAtivo = false;
    h.rpc.mockImplementation(async (nome: string) =>
      nome === "orcamento_de_parceiro_ativo"
        ? { data: h.parceiroAtivo, error: null }
        : { data: { modo: "parceiro", itens_repreciados: 1, itens_sem_preco: 0 }, error: null },
    );
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "chave";
    h.claims.email = "jhessy@bexprint.com.br";
  });

  it("senha certa: confere, repreça e devolve a contagem", async () => {
    h.entrar.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const r = await (confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "parceiro", senha: "certa" } });
    expect(h.entrar).toHaveBeenCalledWith({ email: "jhessy@bexprint.com.br", password: "certa" });
    expect(h.rpc).toHaveBeenCalledWith("orcamento_aplicar_preco", { p_orcamento: ORC, p_modo: "parceiro", p_usuario: "u1" });
    expect(r.itens_repreciados).toBe(1);
  });

  it("cliente com cadastro de parceiro ativo: preço do programa entra sem senha", async () => {
    h.parceiroAtivo = true;
    const r = await (confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "parceiro" } });
    expect(h.entrar).not.toHaveBeenCalled();
    expect(r.itens_repreciados).toBe(1);
  });

  it("senha errada: nada é gravado", async () => {
    h.entrar.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login credentials" } });
    await expect((confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "parceiro", senha: "errada" } })).rejects.toThrow("Senha incorreta.");
    expect(h.rpc).not.toHaveBeenCalledWith("orcamento_aplicar_preco", expect.anything());
  });

  it("a senha de OUTRA pessoa não vale (a sessão confirmada precisa ser a de quem pediu)", async () => {
    h.entrar.mockResolvedValue({ data: { user: { id: "outra" } }, error: null });
    await expect((confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "parceiro", senha: "x" } })).rejects.toThrow("Senha incorreta.");
    expect(h.rpc).not.toHaveBeenCalledWith("orcamento_aplicar_preco", expect.anything());
  });

  it("parceiro sem senha: barrado antes de qualquer consulta", async () => {
    await expect((confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "parceiro" } })).rejects.toThrow("Digite a sua senha");
    expect(h.entrar).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalledWith("orcamento_aplicar_preco", expect.anything());
  });

  it("voltar ao cliente final não pede senha (o preço sobe, não desce)", async () => {
    h.rpc.mockResolvedValue({ data: { modo: "cliente_final", itens_repreciados: 1, itens_sem_preco: 0 }, error: null });
    await (confirmarPrecoDoOrcamento as any)({ data: { orcamentoId: ORC, modo: "cliente_final" } });
    expect(h.entrar).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith("orcamento_aplicar_preco", expect.objectContaining({ p_modo: "cliente_final" }));
  });
});

const SQL = readFileSync("supabase/migrations/20261022150000_preco_cliente_final_x_parceiro.sql", "utf8");
const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
const COMP = readFileSync("src/components/orcamento/preco-do-orcamento.tsx", "utf8");

describe("o banco", () => {
  it("o modo só se grava pelo servidor: a função é service_role e a coluna não ganha UPDATE", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.orcamento_aplicar_preco(uuid, text, uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.orcamento_aplicar_preco(uuid, text, uuid) TO service_role;");
    expect(SQL).toContain("GRANT SELECT (preco_modo, preco_parceiro_confirmado_por, preco_parceiro_confirmado_em)");
    expect(SQL).not.toMatch(/GRANT UPDATE \(preco_modo/);
  });

  it("repõe as opções das views recriadas (CREATE OR REPLACE VIEW as descarta)", () => {
    expect(SQL).toContain("ALTER VIEW public.produtos_comercial SET (security_invoker = false, security_barrier = true);");
    expect(SQL).toContain("ALTER VIEW public.produtos_financeiro SET (security_invoker = true);");
  });

  it("só repreça orçamento em rascunho ou enviado, sem OS; confere a permissão", () => {
    expect(SQL).toContain("v_orc.os_id IS NOT NULL OR v_orc.status::text NOT IN ('rascunho', 'enviado')");
    expect(SQL).toContain("public.has_permission(p_usuario, 'orcamentos.update')");
  });

  it("item sem produto ou sem preço de parceiro não muda — e é contado", () => {
    expect(SQL).toContain("IF v_preco IS NULL THEN v_sem_preco := v_sem_preco + 1; CONTINUE; END IF;");
    expect(SQL).toContain("'itens_sem_preco'");
  });

  it("o banner ganha o preço de parceiro e o duplicado sai do catálogo sem ser apagado", () => {
    expect(SQL).toContain("SET preco_parceiro = 40");
    expect(SQL).toContain("SET ativo = false");
    expect(SQL).not.toMatch(/\bDELETE\b/i);
  });
});

describe("a tela", () => {
  it("o seletor aparece só para quem vê preço e trava fora do que ainda se edita", () => {
    expect(TELA).toContain("{canSeePrices && (");
    expect(TELA).toContain("podeEditar={podeEditarItens}");
  });

  it("item novo entra com o preço do modo; sem preço de parceiro, avisa", () => {
    expect(TELA).toContain('const emParceiro = acordo.data?.preco_modo === "parceiro";');
    expect(TELA).toContain("não tem preço de parceiro: entrou com o preço de tabela.");
  });

  it("o diálogo pede a senha e não a guarda em lugar nenhum", () => {
    expect(COMP).toContain('type="password"');
    expect(COMP).toContain('autoComplete="current-password"');
    expect(COMP).not.toMatch(/localStorage|sessionStorage|console\./);
    expect(COMP).toContain("if (trabalhando) return;");
  });
});
