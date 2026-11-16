import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** O simulador renderiza no servidor, sem navegador e sem banco. */

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

import { SimuladorDePreco } from "../../src/components/precos/simulador-de-preco";
import { ListaDePrecos } from "../../src/components/precos/painel-de-precos";
import { lerCustoReal, type CustoRealDoProduto } from "../../src/domain/precos/custo-real";
import type { LinhaDePreco } from "../../src/domain/precos/painel-de-precos";

const real = (o: Partial<CustoRealDoProduto> = {}): CustoRealDoProduto => ({
  ...lerCustoReal({}),
  custo_producao: 28.47,
  custo_real: 30.86,
  custo_ocupacao: 1.5,
  tres_x_material: 36,
  multiplicador_regra_de_tres: 3,
  preco_minimo_recomendado: 40.5,
  trava_que_manda: "piso_custo",
  ...o,
});
const linha = (o: Partial<LinhaDePreco> = {}): LinhaDePreco => ({
  id: "p1",
  nome: "Lona 440g",
  familia: "Lonas",
  unidade: "m2",
  custo: 12,
  custo_cheio: 24,
  preco: 70,
  margem_minima: 30,
  preco_parceiro: 55,
  real: real(),
  taxas: { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
  composicao: { material: 12, maquina: 5, maoDeObra: 4, indireto: 3 },
  menor_concorrente: 62,
  ...o,
});
const texto = (l: LinhaDePreco, t: string, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(SimuladorDePreco, {
      linha: l,
      e: { texto: t, setTexto: () => {} },
      podePropor: true,
      botao: createElement("button", { "data-testid": "botao-propor" }, "Propor este preço"),
      ...extra,
    }),
  );
const SEM_PONTUACAO = /[()—–→←]/;
/** Só o texto visível, sem atributos nem marcação. */
const visivel = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("controle de arrastar", () => {
  it("é um slider com nome, texto de valor e limites em centavos", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-label="Preço simulado de Lona 440g, em reais"');
    expect(html).toMatch(/aria-valuetext="R\$[^"]*70,00, acima do mínimo recomendado"/);
    expect(html).toContain('aria-valuemin="3080"');
    expect(html).toContain('aria-valuemax="14000"');
  });
  it("o botão de arrastar tem 44 px e o controle tem 44 px de altura", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain("h-11 w-11");
    expect(html).toMatch(/data-testid="regua-do-simulador"/);
    expect(html).toContain("h-11 w-full touch-none");
  });
  it("explica o teclado em palavras e liga a dica ao controle", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain(
      "Use as setas para mudar R$ 0,10 e Page Up ou Page Down para mudar R$ 1,00",
    );
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });
  it("com texto vazio ou sem sentido, mostra o preço de hoje e não inventa valor", () => {
    for (const t of ["", "abc"]) {
      const html = texto(linha(), t);
      expect(html).toMatch(/data-estado="ok"/);
      expect(html).toContain('data-faixa="acima"');
      expect(html).not.toContain("NaN");
    }
  });
  it("tem o campo de preço ligado ao mesmo texto", () => {
    const html = texto(linha(), "70,40");
    expect(html).toMatch(/data-testid="campo-do-simulador"[^>]*|value="70,40"/);
    expect(html).toContain('value="70,40"');
  });
});

describe("zonas em palavras", () => {
  it("a legenda tem as três zonas escritas, não só cor", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain("Vermelho: abaixo do custo real, cada venda dá prejuízo");
    expect(html).toContain("Amarelo: abaixo do mínimo recomendado");
    expect(html).toContain("Verde: do mínimo recomendado para cima");
  });
  it("a zona atual vem em palavras para cada faixa", () => {
    expect(visivel(texto(linha(), "20,00"))).toContain("Abaixo do custo, cada venda dá prejuízo");
    expect(visivel(texto(linha(), "35,00"))).toContain("Abaixo do mínimo recomendado");
    expect(visivel(texto(linha(), "70,00"))).toContain("Acima do mínimo recomendado");
    expect(texto(linha(), "20,00")).toContain('data-faixa="abaixo_do_custo"');
    expect(texto(linha(), "35,00")).toContain('data-faixa="abaixo_do_minimo"');
  });
  it("a régua desenha as três zonas com as cores validadas", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain('data-zona="abaixo"');
    expect(html).toContain('data-zona="perto"');
    expect(html).toContain('data-zona="acima"');
    expect(html).toContain("bg-[#b42318]");
    expect(html).toContain("bg-[#8a5a00]");
    expect(html).toContain("bg-[#146c43]");
  });
});

describe("marcas", () => {
  it("lista as cinco marcas em texto, com botão de 44 px para as que cabem", () => {
    const html = texto(linha(), "70,00");
    for (const m of ["minimo", "regra_de_tres", "hoje", "parceiro", "concorrente"])
      expect(html).toContain(`data-marca-lista="${m}"`);
    const v = visivel(html);
    expect(v).toMatch(/Mínimo recomendado, R\$\s?40,50/);
    expect(v).toMatch(/Regra de três, R\$\s?92,58/);
    expect(v).toMatch(/Preço de hoje, R\$\s?70,00/);
    expect(v).toMatch(/Parceiro, R\$\s?55,00/);
    expect(v).toMatch(/Menor concorrente, R\$\s?62,00/);
    expect(html).toContain("min-h-11");
  });
  it("sem concorrente diz Sem concorrente anotado e não desenha a marca", () => {
    const html = texto(linha({ menor_concorrente: null }), "70,00");
    expect(visivel(html)).toContain("Sem concorrente anotado");
    expect(html).not.toContain('data-marca="concorrente"');
    expect(html).not.toContain('data-marca-lista="concorrente"');
  });
  it("marca fora da régua não é desenhada e o texto diz que está fora", () => {
    const html = texto(linha({ preco_parceiro: 10 }), "70,00");
    expect(html).not.toContain('data-marca="parceiro"');
    expect(visivel(html)).toContain("fora da régua");
  });
});

describe("barra empilhada", () => {
  it("é uma imagem com texto completo de cada fatia, valor e por cento", () => {
    const html = texto(linha(), "100,00");
    const rotulo = /role="img" aria-label="([^"]+)"/.exec(html)?.[1] ?? "";
    for (const f of [
      "Material",
      "Máquina",
      "Mão de obra",
      "Rateio e ocupação",
      "Perdas, falha e consumo da plotter",
      "Imposto",
      "Cartão, metade das vendas",
      "Lucro",
    ])
      expect(rotulo).toContain(f);
    expect(rotulo).toContain("por cento");
    expect(rotulo).not.toMatch(SEM_PONTUACAO);
  });
  it("tem as oito fatias na barra e na legenda", () => {
    const html = texto(linha(), "100,00");
    for (const f of [
      "material",
      "maquina",
      "mao_de_obra",
      "rateio",
      "perdas",
      "imposto",
      "cartao",
      "lucro",
    ]) {
      expect(html).toContain(`data-fatia="${f}"`);
      expect(html).toContain(`data-fatia-legenda="${f}"`);
    }
  });
  it("abaixo do custo a fatia é prejuízo e o texto explica o traço", () => {
    const html = texto(linha(), "20,00");
    expect(html).toContain('data-fatia="prejuizo"'.replace("data-fatia", "data-fatia-legenda"));
    expect(html).not.toContain('data-fatia="lucro"');
    expect(html).toContain("marca-do-preco-na-barra");
    expect(visivel(html)).toContain("Prejuízo de");
    expect(visivel(html)).toContain("Tudo o que passa dele é prejuízo");
  });
  it("sem taxas lidas mostra Imposto e cartão numa fatia e avisa", () => {
    const html = texto(linha({ taxas: null }), "70,00");
    expect(html).toContain('data-fatia="imposto_e_cartao"');
    expect(html).not.toContain('data-fatia="cartao"');
    expect(html).toContain('data-aviso-simulador="sem_taxas"');
  });
});

describe("lucro, frase viva e selo", () => {
  it("mostra lucro em reais e por cento, a frase viva e a explicação da diferença", () => {
    const v = visivel(texto(linha(), "70,00"));
    expect(v).toMatch(/Lucro de R\$\s?\d+,\d\d por unidade, [\d,]+ por cento do preço/);
    expect(v).toMatch(/A cada R\$\s?1,00 a mais no preço sobram R\$\s?0,92 de lucro/);
    expect(v).toContain("A margem líquida da lista divide pelo preço sem imposto e cartão");
  });
  it("a frase viva muda ao arrastar, contra o preço de hoje", () => {
    expect(visivel(texto(linha(), "80,00"))).toContain("ganhando");
    expect(visivel(texto(linha(), "60,00"))).toContain("perdendo");
  });
  it("o selo Custo incompleto aparece com o motivo, para cada marca", () => {
    for (const [o, frase] of [
      [{ sem_tinta: true }, "A tinta ainda não entrou no custo."],
      [{ material_sem_custo: true }, "Há material da ficha sem custo cadastrado."],
      [{ sem_mao_de_obra: true }, "A mão de obra ainda não entrou no custo."],
      [{ custo_incompleto: true }, "Algum custo fixo ainda não foi confirmado"],
    ] as const) {
      const html = texto(linha({ real: real(o) }), "70,00");
      expect(html).toContain('data-testid="selo-custo-incompleto"');
      expect(visivel(html)).toContain("Custo incompleto");
      expect(visivel(html)).toContain(frase);
    }
  });
  it("sem marca de custo incompleto não há selo", () => {
    expect(texto(linha(), "70,00")).not.toContain("selo-custo-incompleto");
  });
  it("todo o texto visível, em qualquer faixa, não tem parênteses, travessão nem seta", () => {
    for (const t of ["20,00", "35,00", "42,00", "70,00", "139,00"]) {
      for (const l of [
        linha(),
        linha({ taxas: null }),
        linha({ real: real({ sem_tinta: true, custo_incompleto: true }) }),
      ])
        expect(visivel(texto(l, t)), t).not.toMatch(SEM_PONTUACAO);
    }
  });
});

describe("botão de propor", () => {
  it("aparece com Propor este preço quando quem vê pode propor", () => {
    const html = texto(linha(), "70,00");
    expect(html).toContain('data-testid="botao-propor"');
    expect(html).toContain("Propor este preço");
    expect(visivel(html)).toContain("Arrastar não grava o preço");
  });
  it("some quando quem vê não pode propor, e diz que só simula", () => {
    const html = texto(linha(), "70,00", { podePropor: false });
    expect(html).not.toContain('data-testid="botao-propor"');
    expect(visivel(html)).toContain("Aqui você só simula");
  });
  it("abaixo do custo avisa em palavras que o gerente decide", () => {
    expect(visivel(texto(linha(), "20,00"))).toContain("Este preço fica abaixo do custo real");
  });
});

describe("sem dado", () => {
  it("sem custo real mostra a frase, o link e esconde a régua", () => {
    const html = texto(linha({ real: null }), "70,00");
    expect(html).toContain('data-estado="sem_dado"');
    expect(visivel(html)).toContain("Sem custo real, não dá para simular");
    expect(html).toContain('href="/custos-producao"');
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain('data-testid="botao-propor"');
  });
  it("sem composição esconde a barra", () => {
    const html = texto(linha({ composicao: null }), "70,00");
    expect(html).toContain('data-estado="sem_dado"');
    expect(html).not.toContain('role="slider"');
  });
  it("sem dado e com sem_tinta ainda mostra o selo", () => {
    const html = texto(linha({ real: real({ sem_tinta: true, custo_real: null }) }), "70,00");
    expect(html).toContain("selo-custo-incompleto");
  });
});

describe("encaixe na lista", () => {
  const props = { propor: async () => {}, podePropor: true };
  it("cada produto tem o botão Simular preço, com 44 px e aria-expanded, e o simulador começa fechado", () => {
    const html = renderToStaticMarkup(
      createElement(ListaDePrecos, { linhas: [linha()], ...props }),
    );
    expect(html).toContain("Simular preço");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="simulador-p1-tabela"');
    expect(html).toContain('aria-controls="simulador-p1-cartao"');
    expect(html).toContain('aria-label="Simular preço de Lona 440g"');
    expect(html).not.toContain('data-testid="simulador-de-preco"');
    expect(html).not.toContain('role="slider"');
  });
  it("os ids de controle de tabela e cartão não se repetem", () => {
    const html = renderToStaticMarkup(
      createElement(ListaDePrecos, { linhas: [linha(), linha({ id: "p2" })], ...props }),
    );
    const ids = [...html.matchAll(/aria-controls="(simulador-[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });
  it("quem não pode propor também pode abrir o simulador", () => {
    const html = renderToStaticMarkup(
      createElement(ListaDePrecos, {
        linhas: [linha()],
        propor: async () => {},
        podePropor: false,
      }),
    );
    expect(html).toContain("Simular preço");
  });
});

describe("achados da revisão", () => {
  it("texto digitado sem valor avisa no campo e diz em que preço a simulação ficou", () => {
    for (const t of ["", "70,", "70,456", "abc"]) {
      const html = texto(linha(), t);
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('data-testid="campo-invalido"');
      expect(visivel(html)).toContain("a simulação fica em R$ 70,00");
    }
    const bom = texto(linha(), "70,45");
    expect(bom).toContain('aria-invalid="false"');
    expect(bom).not.toContain("campo-invalido");
  });
  it("valor fora da grade de R$ 0,10: o valor lido e o texto lido são o mesmo do controle", () => {
    const html = texto(linha(), "70,45");
    expect(html).toMatch(/aria-valuetext="R\$[^"]*70,50,/);
  });
  it("cada marca da régua leva um número visível, o mesmo da lista", () => {
    const html = texto(linha(), "70,00");
    for (const c of ["minimo", "regra_de_tres", "hoje", "parceiro", "concorrente"]) {
      const naRegua = html.match(new RegExp(`data-marca="${c}"[^>]*>\\s*<span[^>]*>(\\d)</span>`));
      const naLista = html.match(
        new RegExp(`data-marca-lista="${c}"><button[^>]*><span[^>]*>(\\d)</span>`),
      );
      expect(naRegua?.[1]).toBeTruthy();
      expect(naRegua?.[1]).toBe(naLista?.[1]);
    }
  });
  it("fatias largas levam o número dentro e a lista repete o número", () => {
    const html = texto(linha(), "70,00");
    expect(html).toMatch(/data-fatia="lucro"[^>]*><span[^>]*>8<\/span>/);
    expect(html).toMatch(/data-fatia-legenda="lucro"[^]*?>8<\/span>/);
  });
  it("a região viva é só a frase do lucro", () => {
    const html = texto(linha(), "70,00");
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-live="polite"[^>]*>Lucro de/);
  });
});
