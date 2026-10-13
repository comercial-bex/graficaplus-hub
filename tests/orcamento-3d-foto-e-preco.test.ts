import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { D } from "../src/domain/impressao3d/decimal";
import { fecharPreco } from "../src/domain/impressao3d/preco";
import {
  caminhoDoArquivo3d,
  descreverFilamento,
  slugFile,
} from "../src/domain/impressao3d/arquivos";

/**
 * Orçamento 3D, 13/10/2026 — o dono gerou o PDF do "BRINQUEDO" e:
 *   - a foto do modelo não estava lá (salva e nunca lida por ninguém);
 *   - o PDF dizia 2 × R$ 22,29 = R$ 44,57;
 *   - a calculadora mostrava custo, lucro e margem a quem a tela do orçamento
 *     salvo esconde esses números (o vendedor);
 *   - o Leonardo (vendedor) não conseguia salvar com print ou foto: o Storage
 *     só aceitava quem tem `arquivos.upload`.
 */

describe("o preço fecha na frente do cliente", () => {
  it("o total é o unitário arredondado vezes a quantidade", () => {
    // O cálculo real do orçamento de 13/10: custo R$ 22,2867, markup 2×, 2 peças.
    const r = fecharPreco(D("22.2867"), 2, 2);
    expect(r.unitario.toNumber()).toBe(22.29);
    expect(r.preco.toNumber()).toBe(44.58);
    expect(r.preco.toNumber()).toBe(r.unitario.toNumber() * 2);
    expect(r.lucro.toNumber()).toBeCloseTo(22.2933, 4);
  });

  it("uma peça: o preço é o arredondado de sempre", () => {
    const r = fecharPreco(D("60.58"), 2, 1);
    expect(r.preco.toNumber()).toBe(121.16);
    expect(r.margem.toNumber()).toBeCloseTo(0.5, 3);
  });

  it("50 chaveiros a R$ 6,90 dão R$ 345,00, nunca R$ 344,99", () => {
    const r = fecharPreco(D("172.48"), 2, 50);
    expect(r.unitario.toNumber()).toBe(6.9);
    expect(r.preco.toNumber()).toBe(345);
  });

  it("quantidade zero ou vazia conta como uma peça", () => {
    expect(fecharPreco(D("10"), 2, 0).preco.toNumber()).toBe(20);
  });
});

describe("onde moram a foto e o print", () => {
  const SQL = readFileSync("supabase/migrations/20261013210000_orcamento_3d_foto_do_modelo.sql", "utf8");

  it("o caminho tem o formato que as regras do Storage conferem", () => {
    const foto = caminhoDoArquivo3d("modelo", "Captura de Tela 2026-10-13 às 15.08.45.png", 1791915252700);
    const print = caminhoDoArquivo3d("slicer", "print.PNG", 1791915252700);
    expect(foto).toBe("orcamentos-3d/1791915252700_modelo_Captura-de-Tela-2026-10-13-as-15.08.45.png");
    expect(print).toBe("orcamentos-3d/1791915252700_slicer_print.png");
    expect(foto).toMatch(/^orcamentos-3d\/[0-9]+_modelo_/);
    expect(print).toMatch(/^orcamentos-3d\/[0-9]+_slicer_/);
    expect(SQL).toContain("name ~ '^orcamentos-3d/[0-9]+_(modelo|slicer)_'");
    expect(SQL).toContain("name ~ '^orcamentos-3d/[0-9]+_modelo_'");
    expect(SQL).toContain("name ~ '^orcamentos-3d/[0-9]+_slicer_'");
    expect(slugFile("")).toBe("arquivo");
  });

  it("envia quem cria orçamento 3D; a foto abre para quem lê o 3D; o print, para quem vê custo ou cria", () => {
    expect(SQL).toMatch(/FOR INSERT TO authenticated[\s\S]*impressao3d\.quote\.create[\s\S]*impressao3d\.quote\.update/);
    expect(SQL).toMatch(/_modelo_'\s*\n\s*AND public\.has_permission\(\(SELECT auth\.uid\(\)\), 'impressao3d\.read'\)/);
    expect(SQL).toMatch(/_slicer_'\s*\n\s*AND \(public\.has_permission\(\(SELECT auth\.uid\(\)\), 'impressao3d\.cost\.read'\)/);
  });

  it("a conversão em OS leva a foto como arquivo de referência", () => {
    expect(SQL).toContain("INSERT INTO public.arquivos (os_id, os_item_id, cliente_id, nome, caminho, bucket, tipo,");
    expect(SQL).toContain("''arquivos-clientes'', ''referencia''");
    expect(SQL).toContain("RAISE EXCEPTION 'converter_orcamento_3d_em_os: o trecho do item da OS não está como esperado");
  });

  it("o material sai como o cliente entende, sem a marca do fornecedor", () => {
    expect(descreverFilamento({ tipo: "PLA", cor: "Natural" })).toBe("PLA · cor Natural");
    expect(descreverFilamento({ tipo: "PETG", cor: null })).toBe("PETG");
    expect(descreverFilamento({ tipo: " ", cor: "" })).toBeNull();
    expect(descreverFilamento(null)).toBeNull();
    expect(SQL).toContain("ADD COLUMN IF NOT EXISTS material_descricao text");
  });
});

/* -------------------------------------------------------------------------- */
/* A calculadora renderizada de verdade: o vendedor não vê custo               */
/* -------------------------------------------------------------------------- */

const permissoes = vi.hoisted(() => ({ atuais: new Set<string>() }));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (opcoes: Record<string, unknown>) => ({ ...opcoes }),
  Link: ({ children }: { children?: ReactNode }) => createElement("a", null, children),
  useNavigate: () => () => undefined,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ hasPermission: (p: string) => permissoes.atuais.has(p) }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("a renderização não consulta o banco");
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  },
}));
vi.mock("@/components/bex/Dica", () => ({
  DicaIcone: () => null,
  Dica: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/domain/impressao3d/ocr", () => ({
  runSlicerOcr: async () => ({}),
  parseTempoLivre: () => null,
  formatMinutos: (m: number) => `${m} min`,
}));

import { Route as Calculadora } from "../src/routes/_authenticated/orcamento-3d-novo";

function renderizarCalculadora(): string {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tela = (Calculadora as any).component as () => ReactNode;
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: cliente }, createElement(Tela)));
}

describe("calculadora 3D: custo só para quem pode ver custo", () => {
  beforeEach(() => {
    permissoes.atuais = new Set();
  });

  it("o vendedor cota pelo preço: sem custo, lucro, margem, decomposição nem parâmetros", () => {
    permissoes.atuais = new Set(["impressao3d.read", "impressao3d.quote.create"]);
    const html = renderizarCalculadora();
    expect(html).toContain("Preço");
    expect(html).toContain("Seguem as Configurações 3D da gráfica");
    for (const proibido of [
      "De onde vem o custo",
      "Lucro",
      "de margem",
      "Custo-hora máquina",
      "Markup (×)",
      "Atacado",
      "Piso",
      "· markup",
      "/kg",
      "/h ·",
    ]) {
      expect(html, proibido).not.toContain(proibido);
    }
  });

  it("quem vê custo continua com tudo", () => {
    permissoes.atuais = new Set(["impressao3d.read", "impressao3d.quote.create", "impressao3d.cost.read"]);
    const html = renderizarCalculadora();
    for (const esperado of ["De onde vem o custo", "Lucro", "de margem", "Custo-hora máquina", "Markup (×)", "Piso · 10% de margem"]) {
      expect(html, esperado).toContain(esperado);
    }
  });

  it("exemplos dizem que são exemplos — '6.52' parecia peso preenchido", () => {
    permissoes.atuais = new Set(["impressao3d.read", "impressao3d.quote.create"]);
    const html = renderizarCalculadora();
    expect(html).toContain('placeholder="ex.: 6,52"');
    expect(html).toContain('placeholder="ex.: 0,2"');
    expect(html).toContain('placeholder="ex.: 15"');
    expect(html).not.toContain('placeholder="6.52"');
  });
});
