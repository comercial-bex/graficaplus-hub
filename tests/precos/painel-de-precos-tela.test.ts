import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/** A tela de preços por produto renderiza no servidor, sem navegador e sem banco. */

vi.mock("@tanstack/react-start", async (original) => {
  const real = await original<typeof import("@tanstack/react-start")>();
  return { ...real, useServerFn: (f: unknown) => f };
});
// O endereço da tela (?busca=, vindo da Tabela de preços) sem roteador: cada teste escolhe.
const endereco = vi.hoisted(() => ({ search: {} as { busca?: string } }));
vi.mock("@tanstack/react-router", async (original) => {
  const real = await original<typeof import("@tanstack/react-router")>();
  return {
    ...real,
    createFileRoute: (caminho: never) => (opcoes: never) =>
      Object.assign(real.createFileRoute(caminho)(opcoes), {
        useSearch: () => endereco.search,
      }),
    Link: ({ to, children, ...resto }: { to: string; children?: unknown }) =>
      createElement("a", { href: to, ...resto }, children as never),
  };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { TooltipProvider } from "../../src/components/ui/tooltip";
import {
  ListaDeAvisos,
  ListaDePrecos,
  Previa,
} from "../../src/components/precos/painel-de-precos";
import { previaDoPreco } from "../../src/domain/precos/painel-de-precos";
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
  custo_ocupacao: null,
  tres_x_material: null,
  piso_custo_producao: null,
  preco_minimo_recomendado: null,
  trava_que_manda: null,
  ocupacao_alvo_pct: null,
  multiplicador_regra_de_tres: null,
  ...o,
});
const comMinimo = (o: Partial<CustoRealDoProduto> = {}) =>
  real({
    custo_producao: 22.45,
    custo_real: 24.34,
    custo_ocupacao: 5.27,
    tres_x_material: 35.76,
    piso_custo_producao: 42.98,
    preco_minimo_recomendado: 42.98,
    trava_que_manda: "piso_custo",
    ocupacao_alvo_pct: 50,
    multiplicador_regra_de_tres: 3,
    ...o,
  });
const sp = (t: string) => t.replace(/\u00a0/g, " ");

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
      "Preço mínimo recomendado",
      "Margem líquida",
      "Vezes o custo",
      "Três vezes o custo real",
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
      "Três vezes o custo real",
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
    for (const r of [
      "custo real",
      "preço mínimo recomendado",
      "margem líquida",
      "vezes o custo",
      "regra de três",
    ])
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
    expect(h).toContain("A máquina faz 14 metros quadrados por hora. O custo é calculado com 10, por margem de segurança. A agenda e a capacidade seguem os 14.");
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
    avisoDoMinimo: null,
    parametrosDoMinimo: { ocupacaoAlvoPct: null, multiplicador: null },
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

  it("vinda da Tabela de preços (?busca=), a busca já chega preenchida e filtra a lista", () => {
    endereco.search = { busca: "Placa PS" };
    try {
      const h = pagina(painel());
      expect(h).toMatch(/type="search"[^>]*value="Placa PS"/);
      expect(h).toContain("Placa PS");
      expect(h).not.toContain("Banner Lona");
    } finally {
      endereco.search = {};
    }
  });

  it("o endereço só aceita busca de texto, aparada e curta", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validar = (Route as any).options.validateSearch as (s: Record<string, unknown>) => {
      busca?: string;
    };
    expect(validar({ busca: "Lona" })).toEqual({ busca: "Lona" });
    expect(validar({ busca: "  " })).toEqual({});
    expect(validar({ busca: 42 })).toEqual({});
    expect(validar({})).toEqual({});
    expect(validar({ busca: "x".repeat(500) }).busca).toHaveLength(120);
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
    for (const t of ["Abaixo do custo", "Abaixo de três vezes o custo real", "Perto de três vezes o custo real", "Acima:"])
      expect(h, t).toContain(t);
    expect(h).toContain("A referência de três vezes o custo real serve só para comparar");
  });

  it("explica que a plotter faz 14 e o sistema calcula com 10", () => {
    expect(pagina(painel())).toContain(
      "A máquina faz 14 metros quadrados por hora. O custo é calculado com 10, por margem de segurança. A agenda e a capacidade seguem os 14.",
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

describe("a coluna Preço mínimo recomendado", () => {
  const com = (preco: number, real = comMinimo()): LinhaDePreco => ({
    ...base,
    nome: "Lona 280g",
    preco,
    real,
    taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
  });
  const listaCom = (ls: LinhaDePreco[]) =>
    sp(
      renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client: qc() },
          createElement(
            TooltipProvider,
            null,
            createElement(ListaDePrecos, { linhas: ls, propor: async () => {}, podePropor: true }),
          ),
        ),
      ),
    );

  it("mostra o mínimo, a diferença contra o balcão em palavras e a faixa, na tabela e no cartão", () => {
    const h = listaCom([com(40), com(43), com(60)]);
    expect((h.match(/data-testid="preco-minimo"/g) ?? []).length).toBe(6);
    expect(h).toContain("R$ 42,98");
    expect(h).toContain("R$ 2,98 abaixo do mínimo");
    expect(h).toContain("R$ 17,02 acima do mínimo");
    for (const faixa of ["abaixo", "no_minimo", "acima"])
      expect(h, faixa).toContain(`data-faixa-do-minimo="${faixa}"`);
    for (const rotulo of ["Abaixo do mínimo", "No mínimo", "Acima do mínimo"])
      expect(h, rotulo).toContain(rotulo);
    expect(h).toContain("<svg");
  });

  it("cada produto tem o botão de como chegou ao mínimo, de 44 px e com nome acessível", () => {
    const h = listaCom([com(40)]);
    expect(h).toContain('data-testid="como-chegou-ao-minimo"');
    expect(h).toContain('aria-label="Como chegou ao preço mínimo de Lona 280g"');
    expect(h).toContain("min-h-11 items-center gap-1.5");
  });

  it("produto sem mínimo diz isso em palavras e não mostra faixa", () => {
    const h = listaCom([{ ...base, real: null, preco: 50 }]);
    expect(h).toContain("Sem mínimo calculado");
    expect(h).toContain('data-faixa-do-minimo="sem_dado"');
  });

  it("no cartão do celular o rótulo vem logo depois do preço de balcão", () => {
    const h = listaCom([com(40)]);
    const cartao = h.slice(h.indexOf('data-testid="cartao-de-preco"'));
    const a = cartao.indexOf(">Preço de balcão</dt>");
    const b = cartao.indexOf(">Preço mínimo recomendado</dt>");
    const c = cartao.indexOf(">Margem líquida</dt>");
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("letra de 16 px, sem parênteses, travessão ou seta", () => {
    const h = listaCom([com(40), com(60)]);
    expect(h).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
    const texto = h.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
    expect(texto).not.toMatch(/[()—–→←]/);
  });
});

describe("a prévia da linha com o mínimo recomendado", () => {
  const l: LinhaDePreco = {
    ...base,
    preco: 55,
    real: comMinimo(),
    taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
  };
  const previa = (texto: string, linha: LinhaDePreco = l) => {
    const p = previaDoPreco(linha, texto);
    return sp(
      renderToStaticMarkup(
        createElement(Previa, {
          linha,
          e: {
            texto,
            setTexto: () => {},
            motivo: "",
            setMotivo: () => {},
            enviando: false,
            enviada: false,
            erro: null,
            previa: p,
            digitou: true,
            motivoOk: true,
            podeEnviar: p.podePedir,
            enviar: async () => {},
          },
        }),
      ),
    );
  };

  it("diz que o preço digitado está abaixo do mínimo, além do piso", () => {
    const h = previa("40");
    expect(h).toContain('data-testid="previa-do-minimo"');
    expect(h).toContain('data-faixa-do-minimo="abaixo"');
    expect(h).toContain("Mínimo recomendado R$ 42,98. O preço digitado está R$ 2,98 abaixo do mínimo.");
    expect(h).toContain("Piso");
  });
  it("diz que está acima do mínimo", () => {
    const h = previa("60");
    expect(h).toContain('data-faixa-do-minimo="acima"');
    expect(h).toContain("R$ 17,02 acima do mínimo");
  });
  it("abaixo do mínimo não pede motivo: só abaixo do piso pede", () => {
    // Custo de 10 e margem mínima de 40 dão piso de 16,67: 40 está abaixo do mínimo recomendado e acima do piso.
    const h = previa("40", { ...l, custo: 10 });
    expect(h).toContain('data-faixa-do-minimo="abaixo"');
    expect(h).not.toContain("Motivo do pedido");
    // Abaixo do piso o motivo continua obrigatório, como antes.
    expect(previa("40")).toContain("Motivo do pedido");
  });
  it("sem parênteses, travessão ou seta", () => {
    const texto = previa("40").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
    expect(texto).not.toMatch(/[()—–→←]/);
  });
});

describe("a página com o preço mínimo recomendado", () => {
  const abaixoDoMinimo: LinhaDePreco = {
    ...base,
    id: "00000000-0000-4000-8000-0000000000aa",
    nome: "Lona abaixo",
    preco: 40,
    real: comMinimo(),
    taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
  };
  const painel = (p: Partial<PainelPorProduto> = {}): PainelPorProduto => ({
    linhas: [abaixoDoMinimo, { ...linhas[1], real: comMinimo(), preco: 90 }],
    podePropor: true,
    avisoDoCustoReal: null,
    avisoDoMinimo: null,
    parametrosDoMinimo: { ocupacaoAlvoPct: 50, multiplicador: 3 },
    pendencias: [],
    ...p,
  });

  it("o filtro por problema ganha Abaixo do mínimo recomendado, com a contagem", () => {
    const h = pagina(painel());
    expect(h).toContain('data-testid="numero-abaixo_do_minimo"');
    expect(h).toContain("Abaixo do mínimo recomendado");
    expect(h).toMatch(/data-testid="numero-abaixo_do_minimo"[^>]*><span[^>]*>1<\/span>/);
  });

  it("o texto de 16 px explica a fórmula e a ocupação com o número de hoje", () => {
    const h = pagina(painel());
    expect(h).toContain('data-testid="texto-do-preco-minimo"');
    expect(h).toContain("Como sai o preço mínimo recomendado");
    expect(h).toContain("maior entre dois valores");
    expect(h).toContain(
      "Nem a plotter, nem o impressor, nem o aluguel trabalham cem por cento do tempo que a gráfica paga",
    );
    expect(h).toContain("pela ocupação alvo, hoje 50 por cento");
    expect(h).toContain("A energia e as perdas não sobem");
    expect(h).toContain('href="/custos-producao"');
    const trecho = h.slice(h.indexOf('data-testid="texto-do-preco-minimo"'));
    const ate = trecho.slice(0, trecho.indexOf("</section>"));
    expect(ate).not.toMatch(/[\s"]text-(xs|sm)[\s"]/);
  });

  it("a legenda diz as três faixas do mínimo em palavras", () => {
    const h = pagina(painel());
    for (const t of [
      "Abaixo do mínimo: o balcão está abaixo do preço mínimo recomendado",
      "No mínimo: o balcão está até 2 por cento acima",
      "Acima do mínimo: o balcão passa do mínimo recomendado",
    ])
      expect(h, t).toContain(t);
  });

  it("sem as colunas no banco, mostra a frase humana e esconde o número que diria zero à toa", () => {
    const h = pagina(
      painel({
        avisoDoMinimo: "O preço mínimo recomendado ainda não está ligado no banco. Avise o suporte.",
        parametrosDoMinimo: { ocupacaoAlvoPct: null, multiplicador: null },
      }),
    );
    expect(h).toContain('data-testid="aviso-do-minimo"');
    expect(h).toContain("Avise o suporte");
    expect(h).not.toContain('data-testid="numero-abaixo_do_minimo"');
    expect(h).not.toContain("pela ocupação alvo, hoje");
  });

  it("o mapa de margem e a lista seguem funcionando junto", () => {
    const h = pagina(painel());
    expect(h).toContain(">Mapa de margem<");
    expect(h).toContain('data-testid="linha-de-preco"');
    expect(h).toContain("2 produtos na lista.");
  });

  it("nenhum texto da tela usa parênteses, travessão ou seta", () => {
    const h = pagina(painel());
    const texto = h.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
    expect(texto).not.toMatch(/[()—–→←]/);
  });

  it("Propor preço continua só criando proposta: a página não grava preço", () => {
    const h = pagina(painel());
    expect(h).toContain("O preço só muda depois que alguém aprova em preços pendentes");
    expect(h).toContain("Propor preço");
  });
});
