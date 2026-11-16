import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/** A tela de preços por produto renderiza no servidor, sem navegador e sem banco. */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
vi.mock("@tanstack/react-router", async (original) => {
  const real = await original<typeof import("@tanstack/react-router")>();
  return {
    ...real,
    Link: ({ to, children, ...resto }: { to: string; children?: unknown }) =>
      createElement("a", { href: to, ...resto }, children as never),
  };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { ListaDePrecos } from "../../src/components/precos/painel-de-precos";
import { Route } from "../../src/routes/_authenticated/precos";
import type { LinhaDePreco } from "../../src/domain/precos/painel-de-precos";
import type { PainelPorProduto } from "../../src/lib/api/precos-por-produto.functions";

const base: LinhaDePreco = {
  id: "00000000-0000-4000-8000-000000000001",
  nome: "Banner Lona",
  familia: "Banners",
  unidade: "m2",
  custo: 30,
  custo_cheio: 38,
  preco: 45,
  margem_minima: 40,
  preco_parceiro: 40,
};
const linhas: LinhaDePreco[] = [
  { ...base },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000002",
    nome: "Adesivo Vinil",
    familia: "Adesivos",
    preco: 90,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000003",
    nome: "Impressão 3D",
    familia: "Criação",
    custo: null,
    custo_cheio: null,
    preco: null,
    preco_parceiro: null,
  },
  {
    ...base,
    id: "00000000-0000-4000-8000-000000000004",
    nome: "Placa PS",
    familia: "Placas",
    preco: 52,
    preco_parceiro: 60,
  },
];

const qc = (painel?: PainelPorProduto) => {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (painel) c.setQueryData(["precos-por-produto"], painel);
  return c;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Pagina = (Route as any).options.component as () => ReturnType<typeof createElement>;
const pagina = (painel: PainelPorProduto) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc(painel) },
      createElement(TooltipProvider, null, createElement(Pagina)),
    ),
  );
const lista = (podePropor = true) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: qc() },
      createElement(
        TooltipProvider,
        null,
        createElement(ListaDePrecos, { linhas, propor: async () => {}, podePropor }),
      ),
    ),
  );

describe("a lista, em tabela e em cartões", () => {
  it("a tabela tem as colunas pedidas e some abaixo de 640 px, quando entram os cartões", () => {
    const h = lista();
    for (const c of [
      "Produto",
      "Unidade",
      "Custo",
      "Piso",
      "Preço do balcão",
      "Margem",
      "Parceiro",
      "Situação",
      "Pedido",
    ]) {
      expect(h, c).toContain(`>${c}`);
    }
    expect(h).toContain("hidden overflow-x-auto");
    expect(h).toContain("sm:block");
    expect(h).toContain("sm:hidden");
    expect((h.match(/data-testid="linha-de-preco"/g) ?? []).length).toBe(4);
    expect((h.match(/data-testid="cartao-de-preco"/g) ?? []).length).toBe(4);
  });

  it("diz o estado em palavras, com ícone, e não só na cor", () => {
    const h = lista();
    expect(h).toContain("Abaixo do piso");
    expect(h).toContain("Sem custo");
    expect(h).toContain("Margem boa");
    expect(h).toContain("Margem justa");
    expect(h).toContain("Margem de 33,3 por cento, abaixo do mínimo de 40");
    expect(h).toContain("<svg");
  });

  it("mostra custo de material e cheio, piso calculado e parceiro maior que o balcão", () => {
    const h = lista();
    expect(h).toContain("Material");
    expect(h).toContain("Cheio");
    expect(h).toContain("50,00");
    expect(h).toContain("Maior que o balcão");
    expect(h).toContain("metro quadrado");
  });

  it("o preço é um campo de 44 px com teclado numérico, e Propor preço começa desligado", () => {
    const h = lista();
    expect(h).toContain('inputMode="decimal"');
    expect(h).toContain("h-11");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Propor preço<\/button>/);
    expect(h).toContain("R$");
  });

  it("tem explicação curta de piso e margem, acessível por toque", () => {
    const h = lista();
    expect(h).toContain('aria-label="Explicar: piso"');
    expect(h).toContain('aria-label="Explicar: margem"');
  });

  it("quem não propõe vê tudo sem botão e com o campo desligado", () => {
    const h = lista(false);
    expect(h).not.toContain(">Propor preço<");
    expect(h).toMatch(/<input[^>]*disabled=""/);
  });

  it("nunca usa letra menor que 16 px nem texto-xs ou texto-sm", () => {
    // Variantes como file:text-sm (só campo de arquivo) não contam: o que vale é a classe solta.
    expect(lista()).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
  });
});

describe("a página", () => {
  const painel = (p: Partial<PainelPorProduto> = {}): PainelPorProduto => ({
    linhas,
    podePropor: true,
    ...p,
  });

  it("mostra os quatro números que filtram e o aviso de abaixo do piso", () => {
    const h = pagina(painel());
    expect(h).toContain("Preços por produto");
    expect(h).toContain('data-testid="numero-abaixo"');
    expect(h).toContain('data-testid="numero-sem_custo"');
    expect(h).toContain('data-testid="numero-sem_preco"');
    expect(h).toContain('data-testid="numero-parceiro_acima"');
    expect(h).toContain("Parceiro acima do balcão");
    expect(h).toContain("Este produto vende abaixo do piso.");
    expect(h).toContain("Ver só este");
    expect(h).toContain("4 produtos na lista.");
  });

  it("no plural, escreve a quantidade", () => {
    const dois = [linhas[0], { ...linhas[3], preco: 40 }];
    expect(pagina(painel({ linhas: dois }))).toContain("Estes 2 produtos vendem abaixo do piso.");
  });

  it("o destaque vem primeiro: abaixo do piso antes do que está certo", () => {
    const h = pagina(painel());
    expect(h.indexOf("Banner Lona")).toBeLessThan(h.indexOf("Adesivo Vinil"));
  });

  it("tem chips de família de 44 px, busca e ordem", () => {
    const h = pagina(painel());
    expect(h).toContain("Todas as famílias");
    for (const f of ["Adesivos", "Banners", "Criação", "Placas"])
      expect(h).toContain(`>${f}</button>`);
    expect(h).toContain("min-h-11");
    expect(h).toContain('type="search"');
    expect(h).toContain("Problemas primeiro");
  });

  it("explica que o preço não grava direto", () => {
    expect(pagina(painel())).toContain(
      "O preço só muda depois que alguém aprova em preços pendentes",
    );
  });

  it("quem só lê recebe o recado", () => {
    expect(pagina(painel({ podePropor: false }))).toContain(
      "Só administrador ou gerente pede mudança de preço",
    );
  });

  it("sem abaixo do piso, o aviso não aparece", () => {
    const h = pagina(painel({ linhas: [linhas[1]] }));
    expect(h).not.toContain('data-testid="aviso-abaixo-do-piso"');
  });

  it("nenhum texto da tela usa parênteses, travessão ou seta", () => {
    const h = pagina(painel());
    const texto = h.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
    expect(texto).not.toMatch(/[()—–→←]/);
  });

  it("a lista vazia tem frase própria", () => {
    expect(pagina(painel({ linhas: [] }))).toContain("Nenhum produto com esse filtro.");
  });
});
