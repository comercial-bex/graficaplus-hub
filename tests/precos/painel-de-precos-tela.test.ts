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
import { ListaDeAvisos, ListaDePrecos } from "../../src/components/precos/painel-de-precos";
import { avisosDoProduto } from "../../src/domain/precos/custo-real";
import { Route } from "../../src/routes/_authenticated/precos";
import type { LinhaDePreco } from "../../src/domain/precos/painel-de-precos";
import type { PainelPorProduto } from "../../src/lib/api/precos-por-produto.functions";
import type { CustoRealDoProduto } from "../../src/domain/precos/custo-real";

const real = (o: Partial<CustoRealDoProduto> = {}): CustoRealDoProduto => ({
  custo_producao: 28.47,
  custo_real: 33.9,
  margem_liquida_pct: 51.6,
  vezes_o_custo: 2.1,
  preco_regra_de_tres: 101.7,
  sem_tinta: false,
  material_sem_custo: false,
  sem_mao_de_obra: false,
  custo_incompleto: false,
  velocidade_usada_m2_h: null,
  velocidade_nominal_m2_h: null,
  tempo_presumido: false,
  parceiro_abaixo_do_piso: false,
  ...o,
});

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
  real: real({ custo_real: 40, custo_incompleto: true }),
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
    real: null,
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
      "Custo real",
      "Preço de balcão",
      "Margem líquida",
      "Vezes o custo",
      "Preço pela regra de três",
      "Diferença",
      "Parceiro",
      "Avisos",
      "Pedido",
    ]) {
      expect(h, c).toContain(`>${c}`);
    }
    expect(h).not.toContain(">Piso<");
    expect(h).toContain("hidden overflow-x-auto");
    expect(h).toContain("sm:block");
    expect(h).toContain("sm:hidden");
    expect((h.match(/data-testid="linha-de-preco"/g) ?? []).length).toBe(4);
    expect((h.match(/data-testid="cartao-de-preco"/g) ?? []).length).toBe(4);
  });

  it("o cartão do celular tem os rótulos na ordem combinada", () => {
    const h = lista();
    const cartao = h.slice(h.indexOf('data-testid="cartao-de-preco"'));
    const ordem = [
      "Custo real",
      "Preço de balcão",
      "Margem líquida",
      "Vezes o custo",
      "Preço pela regra de três",
      "Diferença",
      "Parceiro",
    ].map((r) => cartao.indexOf(`>${r}</dt>`));
    expect(ordem.every((i) => i > 0)).toBe(true);
    expect([...ordem].sort((x, y) => x - y)).toEqual(ordem);
  });

  it("diz a margem líquida e a faixa em palavras, com ícone, e não só na cor", () => {
    const h = lista();
    expect(h).toContain("Margem líquida de 11,1 por cento, abaixo do mínimo de 40");
    expect(h).toContain("Abaixo da regra de três");
    expect(h).toContain("abaixo da regra");
    expect(h).toContain("<svg");
  });

  it("mostra custo real, vezes, regra de três, selo de custo incompleto e parceiro maior que o balcão", () => {
    const h = lista();
    expect(h).toContain("R$");
    expect(h).toContain("120,00");
    expect(h).toContain("1,1 vezes");
    expect(h).toContain("Custo incompleto");
    expect(h).toContain("Maior que o balcão");
  });

  it("sem custo real, diz isso em palavras e mostra o custo de antes", () => {
    const h = lista();
    expect(h).toContain("Sem custo real");
    expect(h).toContain("Material");
    expect(h).toContain("Sem margem líquida, falta o custo real ou o preço");
  });

  it("o preço é um campo de 44 px com teclado numérico, e Propor preço começa desligado", () => {
    const h = lista();
    expect(h).toContain('inputMode="decimal"');
    expect(h).toContain("h-11");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Propor preço<\/button>/);
    expect(h).toContain("R$");
  });

  it("o botão de avisos tem 44 px, a contagem e nome acessível", () => {
    const h = lista();
    expect(h).toContain('data-testid="botao-de-avisos"');
    expect(h).toMatch(/aria-label="Avisos de Banner Lona, \d+ avisos?"/);
    expect(h).toContain("h-11 min-w-11");
  });

  it("tem explicação curta de custo real, margem líquida, vezes e regra de três, acessível por toque", () => {
    const h = lista();
    for (const r of ["custo real", "margem líquida", "vezes o custo", "regra de três"])
      expect(h).toContain(`aria-label="Explicar: ${r}"`);
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

describe("os avisos de um produto", () => {
  it("a lista mostra o grau escrito e a frase pronta", () => {
    const avisos = avisosDoProduto(
      { ...base, real: real({ sem_tinta: true, velocidade_usada_m2_h: 10, velocidade_nominal_m2_h: 14 }) },
      90,
    );
    const h = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos }));
    expect(h).toContain("Cuidado.");
    expect(h).toContain("Informação.");
    expect(h).toContain("A máquina faz 14 metros quadrados por hora e o sistema calcula com 10 por margem de segurança.");
    expect(h).not.toMatch(/[()—–→←]/);
  });
  it("sem aviso, diz que não há nada", () => {
    expect(renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: [] }))).toContain("Nada a avisar");
  });
});

describe("a página", () => {
  const painel = (p: Partial<PainelPorProduto> = {}): PainelPorProduto => ({
    linhas,
    podePropor: true,
    avisoDoCustoReal: null,
    pendencias: [],
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

  it("tem as abas Lista e Mapa de margem, com botões de 44 px", () => {
    const h = pagina(painel());
    expect(h).toContain(">Lista<");
    expect(h).toContain(">Mapa de margem<");
    expect(h).toMatch(/role="tab"[^>]*>Lista/);
    expect(h).toContain("min-h-11");
  });

  it("a legenda diz as quatro faixas da regra de três em palavras", () => {
    const h = pagina(painel());
    for (const t of ["Abaixo do custo", "Abaixo da regra de três", "Na regra de três", "Acima:"])
      expect(h, t).toContain(t);
    expect(h).toContain("A regra de três é só referência");
  });

  it("explica que a plotter faz 14 e o sistema calcula com 10", () => {
    expect(pagina(painel())).toContain(
      "A máquina faz 14 metros quadrados por hora e o sistema calcula com 10 por margem de segurança.",
    );
  });

  it("mostra a faixa de pendências de custo com o caminho para preencher", () => {
    const sem = pagina(painel());
    expect(sem).not.toContain('data-testid="aviso-de-pendencias-de-custo"');
    const h = pagina(
      painel({ pendencias: [{ codigo: "a", rotulo: "Aluguel", tipo: "custo_fixo" }, { codigo: "b", rotulo: "Tinta", tipo: "custo_fixo" }] }),
    );
    expect(h).toContain("Faltam 2 itens de custo para fechar.");
    expect(h).toContain('href="/custos-producao"');
  });

  it("a visão de custo real ausente aparece como frase humana", () => {
    const h = pagina(painel({ avisoDoCustoReal: "O custo real ainda não está ligado no banco. Avise o suporte." }));
    expect(h).toContain('data-testid="aviso-do-custo-real"');
    expect(h).toContain("Avise o suporte");
  });

  it("a lista vazia tem frase própria", () => {
    expect(pagina(painel({ linhas: [] }))).toContain("Nenhum produto com esse filtro.");
  });
});
