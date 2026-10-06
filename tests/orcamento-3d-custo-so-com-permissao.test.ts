import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * /orcamento-3d/$id: QUEM NÃO PODE VER CUSTO NÃO PODE VER NÚMERO INVENTADO.
 *
 * Operador e vendedor abrem a tela (impressao3d.read), mas o cálculo de custo
 * pede impressao3d.cost.read. O banco recusava a consulta, a tela jogava o
 * erro fora e desenhava o "Detalhamento de custo" com tudo R$ 0.00, margem
 * líquida 0.0% e lucro R$ 0.00 — ao lado do preço real de R$ 121.15. Para
 * quem pode ver, uma consulta caída também virava zero.
 *
 * A tela é renderizada de verdade (HTML do servidor), com o cache do React
 * Query preenchido como se o banco tivesse respondido.
 */

const ID = "2057dab5-4914-40f7-958d-909532173adb";

const permissoes = vi.hoisted(() => ({ atuais: new Set<string>() }));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (opcoes: Record<string, unknown>) => ({
    ...opcoes,
    useParams: () => ({ id: "2057dab5-4914-40f7-958d-909532173adb" }),
  }),
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useNavigate: () => () => undefined,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ hasPermission: (p: string) => permissoes.atuais.has(p) }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("a renderização não consulta o banco: o cache já tem a resposta");
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
}));

// Fora do assunto e pesados (tooltip do Radix, gerador de PDF).
vi.mock("@/components/bex/Dica", () => ({ DicaIcone: () => null, Dica: ({ children }: { children?: ReactNode }) => children }));
vi.mock("@/lib/pdf/PDFPreviewDialog", () => ({ PDFPreviewDialog: () => null }));

import { Route } from "../src/routes/_authenticated/orcamento-3d.$id";

const ORCAMENTO = {
  id: ID,
  titulo: "Urna e Gatinho Anjo",
  quantidade: 1,
  preco_comercial: 121.15,
  status: "rascunho",
  cliente_id: "c1",
  os_id: null,
  clientes: { nome: "Cliente" },
};

const CALCULO = {
  versao: 1,
  custo_material: 20.1,
  custo_maquina: 10,
  custo_energia: 1.2,
  custo_mao_obra: 20,
  custo_acabamento: 4,
  custo_risco: 3,
  custo_indireto: 2.28,
  custo_operacional: 60.58,
  margem: 0.5,
  lucro: 60.57,
  markup: 2,
  valor_unitario: 121.15,
  inputs_json: { impressora: "Bambu Lab A1", filamento: "PLA" },
};

let cliente: QueryClient;

beforeEach(() => {
  permissoes.atuais = new Set();
  // retryOnMount: false mantém no cache o erro que o teste plantou, em vez de
  // a tela "tentar de novo" e mostrar carregando.
  cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } },
  });
  cliente.setQueryData(["orcamento-3d", ID], ORCAMENTO);
});

function renderizar(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tela = (Route as any).component as () => ReactNode;
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: cliente }, createElement(Tela)));
}

function plantarErroNoCalculo() {
  const erro = new Error("canceling statement due to statement timeout");
  cliente.getQueryCache().build(
    cliente,
    { queryKey: ["orcamento-3d-calc", ID] },
    {
      data: undefined,
      dataUpdateCount: 0,
      dataUpdatedAt: 0,
      error: erro,
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchFailureCount: 1,
      fetchFailureReason: erro,
      fetchMeta: null,
      isInvalidated: false,
      status: "error",
      fetchStatus: "idle",
    },
  );
}

describe("operador e vendedor (sem impressao3d.cost.read)", () => {
  beforeEach(() => {
    permissoes.atuais = new Set(["impressao3d.read"]);
  });

  it("veem o preço e a frase do porquê — nenhum custo, margem ou lucro, nem zerados", () => {
    // O que a consulta recusada deixava para a tela antiga: nada.
    cliente.setQueryData(["orcamento-3d-calc", ID], null);
    const html = renderizar();
    expect(html).toContain("R$ 121.15");
    expect(html).toContain("visíveis só para quem tem permissão de ver custo");
    for (const proibido of ["Detalhamento de custo", "Custo operacional", "Margem líquida", "Lucro", "R$ 0.00"]) {
      expect(html, proibido).not.toContain(proibido);
    }
  });

  it("mesmo com o cálculo no cache, a tela não o mostra", () => {
    cliente.setQueryData(["orcamento-3d-calc", ID], CALCULO);
    const html = renderizar();
    expect(html).not.toContain("R$ 60.58");
    expect(html).not.toContain("Margem líquida");
    expect(html).not.toContain("Bambu Lab A1");
  });
});

describe("admin, gestor e financeiro (com impressao3d.cost.read)", () => {
  beforeEach(() => {
    permissoes.atuais = new Set(["impressao3d.read", "impressao3d.cost.read"]);
  });

  it("veem o detalhamento de custo de verdade", () => {
    cliente.setQueryData(["orcamento-3d-calc", ID], CALCULO);
    const html = renderizar();
    expect(html).toContain("Detalhamento de custo");
    expect(html).toContain("R$ 60.58");
    expect(html).toContain("50.0%");
    expect(html).toContain("Bambu Lab A1");
  });

  it("consulta caída aparece como falha, nunca como R$ 0,00", () => {
    plantarErroNoCalculo();
    const html = renderizar();
    expect(html).toContain("Não foi possível carregar o cálculo de custo.");
    expect(html).not.toContain("R$ 0.00");
    expect(html).not.toContain("Margem líquida");
  });

  it("orçamento sem cálculo gravado diz isso, em vez de mostrar zeros", () => {
    cliente.setQueryData(["orcamento-3d-calc", ID], null);
    const html = renderizar();
    expect(html).toContain("não tem cálculo de custo gravado");
    expect(html).not.toContain("R$ 0.00");
  });
});
