import { describe, expect, it } from "vitest";
import {
  centavosParaTexto,
  fraseViva,
  limitesDaReguas,
  motivosDoCustoIncompleto,
  prenderNaReguas,
  prepararSimulador,
  simularNoPreco,
  textoDaMarca,
  textoDeValorDoControle,
  textoParaCentavos,
  zonaDoPreco,
  fraseDoLucro,
  resumoDaBarra,
  TEXTO_DO_LUCRO_SOBRE_O_PRECO,
  type Simulacao,
  type SimuladorPronto,
} from "../../src/domain/precos/simulador-de-preco";
import { lerReais, type LinhaDePreco } from "../../src/domain/precos/painel-de-precos";
import { lerCustoReal, type CustoRealDoProduto } from "../../src/domain/precos/custo-real";

/** Simulador de preço: contas puras em centavos, sem tela e sem banco. */

const SEM_PONTUACAO = /[()—–→←]/;

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

const pronto = (o: Partial<LinhaDePreco> = {}): SimuladorPronto => {
  const p = prepararSimulador(linha(o));
  if (p.estado !== "pronto") throw new Error(`esperava pronto, veio ${p.motivo}`);
  return p;
};
const sim = (p: SimuladorPronto, c: number): Simulacao => {
  const s = simularNoPreco(p, c);
  if (s.estado !== "ok") throw new Error(`esperava ok, veio ${s.motivo}`);
  return s;
};
const somaDasFatias = (s: Simulacao) => s.fatias.reduce((t, f) => t + f.centavos, 0);

describe("soma das fatias", () => {
  it("é exatamente o preço em dezenas de preços, inclusive centavos quebrados", () => {
    const p = pronto();
    const precos: number[] = [];
    for (let c = 1; c <= 20_000; c += 137) precos.push(c);
    for (const c of [1, 7, 99, 1001, 3086, 3087, 4050, 6999, 7000, 7001, 12345, 13999, 14000])
      precos.push(c);
    expect(precos.length).toBeGreaterThan(100);
    for (const c of precos) expect(somaDasFatias(sim(p, c)), `preço ${c}`).toBe(c);
  });
  it("também fecha sem taxas lidas, com imposto e cartão juntos", () => {
    const p = pronto({ taxas: null });
    expect(p.taxasLidas).toBe(false);
    for (let c = 50; c < 15_000; c += 311) {
      const s = sim(p, c);
      expect(somaDasFatias(s)).toBe(c);
      expect(s.fatias.some((f) => f.codigo === "imposto_e_cartao")).toBe(true);
      expect(s.fatias.some((f) => f.codigo === "imposto")).toBe(false);
    }
  });
  it("as cinco fatias de custo somam o custo de produção, dentro de um centavo", () => {
    const p = pronto();
    const custos = p.custos.reduce((t, c) => t + c.centavos, 0);
    expect(Math.abs(custos - 2847)).toBeLessThanOrEqual(1);
    expect(p.custos.map((c) => c.codigo)).toEqual([
      "material",
      "maquina",
      "mao_de_obra",
      "rateio",
      "perdas",
    ]);
  });
  it("perdas é o resíduo: custo de produção menos o resto", () => {
    const p = pronto();
    // 28,47 menos 12, 5, 4 e 3 mais 1,50 de ocupação dá 2,97.
    expect(p.custos.find((c) => c.codigo === "perdas")?.centavos).toBe(297);
    expect(p.custos.find((c) => c.codigo === "rateio")?.centavos).toBe(450);
  });
  it("composição velha, com resíduo negativo, escala as fatias e avisa", () => {
    const p = pronto({ composicao: { material: 20, maquina: 8, maoDeObra: 6, indireto: 5 } });
    expect(p.avisos.map((a) => a.codigo)).toContain("composicao_desatualizada");
    expect(p.custos.find((c) => c.codigo === "perdas")?.centavos).toBe(0);
    const custos = p.custos.reduce((t, c) => t + c.centavos, 0);
    expect(Math.abs(custos - 2847)).toBeLessThanOrEqual(1);
    for (const c of p.custos) expect(c.centavos).toBeGreaterThanOrEqual(0);
    expect(somaDasFatias(sim(p, 7000))).toBe(7000);
  });
  it("sem ocupação lida, a ocupação cai em perdas e o aviso diz isso", () => {
    const p = pronto({ real: real({ custo_ocupacao: null }) });
    expect(p.avisos.map((a) => a.codigo)).toContain("sem_ocupacao");
    expect(p.custos.find((c) => c.codigo === "perdas")?.centavos).toBe(447);
  });
});

describe("imposto, cartão e lucro", () => {
  it("imposto é o preço vezes 4 por cento e cartão é o preço vezes metade de 7,5", () => {
    const s = sim(pronto(), 10_000);
    expect(s.fatias.find((f) => f.codigo === "imposto")?.centavos).toBe(400);
    expect(s.fatias.find((f) => f.codigo === "cartao")?.centavos).toBe(375);
  });
  it("mudam com o preço simulado, não são fixos", () => {
    const p = pronto();
    const a = sim(p, 5000).fatias.find((f) => f.codigo === "imposto")?.centavos;
    const b = sim(p, 10_000).fatias.find((f) => f.codigo === "imposto")?.centavos;
    expect(a).toBe(200);
    expect(b).toBe(400);
  });
  it("o lucro no custo real fica dentro de um real de centavos de zero para várias taxas", () => {
    const taxas = [
      { impostoVendaPct: 0, taxaCartaoPct: 0 },
      { impostoVendaPct: 4, taxaCartaoPct: 7.5 },
      { impostoVendaPct: 8.5, taxaCartaoPct: 4 },
      { impostoVendaPct: 12, taxaCartaoPct: 10 },
    ];
    for (const t of taxas) {
      const tx = (t.impostoVendaPct + t.taxaCartaoPct / 2) / 100;
      const custoReal = Math.round((28.47 / (1 - tx)) * 100) / 100;
      const p = pronto({ taxas: t, real: real({ custo_real: custoReal }) });
      const s = sim(p, Math.round(custoReal * 100));
      expect(Math.abs(s.lucroCentavos), JSON.stringify(t)).toBeLessThanOrEqual(2);
    }
  });
  it("lucro em reais e em por cento é lucro sobre o preço", () => {
    const s = sim(pronto(), 10_000);
    // 100,00 menos 28,47 menos 4,00 menos 3,75
    expect(s.lucroCentavos).toBe(10_000 - 2847 - 400 - 375 + (somaDasFatias(s) - 10_000));
    expect(s.lucroPct).toBeCloseTo((s.lucroCentavos / 10_000) * 100, 10);
  });
  it("lucro sobre o preço difere da margem líquida da lista, e o texto explica", () => {
    const p = pronto();
    const s = sim(p, 7000);
    const margemDaLista = ((7000 - p.custoRealCentavos) / 7000) * 100;
    expect(Math.abs(s.lucroPct - margemDaLista)).toBeGreaterThan(0.5);
    expect(s.lucroPct).toBeLessThan(margemDaLista);
    expect(TEXTO_DO_LUCRO_SOBRE_O_PRECO).toContain("sem imposto e cartão");
  });
  it("abaixo do custo o lucro é negativo e a fatia vira prejuízo", () => {
    const s = sim(pronto(), 2000);
    expect(s.lucroCentavos).toBeLessThan(0);
    expect(s.lucroPct).toBeLessThan(0);
    expect(s.fatias.at(-1)?.codigo).toBe("prejuizo");
    expect(s.faixa).toBe("abaixo_do_custo");
    expect(somaDasFatias(s)).toBe(2000);
    // As saídas passam do preço: a barra é a das saídas e o preço fica marcado dentro dela.
    expect(s.posicaoDoPrecoNaBarra).toBeLessThan(100);
    const larguras = s.fatias.reduce((t, f) => t + f.larguraNaBarra, 0);
    expect(larguras).toBeCloseTo(100, 6);
  });
  it("com lucro a barra fecha em cem por cento e o preço fica no fim", () => {
    const s = sim(pronto(), 7000);
    expect(s.fatias.at(-1)?.codigo).toBe("lucro");
    expect(s.posicaoDoPrecoNaBarra).toBe(100);
    expect(s.fatias.reduce((t, f) => t + f.larguraNaBarra, 0)).toBeCloseTo(100, 6);
  });
  it("vezes o custo é preço sobre custo real", () => {
    const p = pronto();
    expect(sim(p, 3086).vezesOCusto).toBeCloseTo(1, 10);
    expect(sim(p, 9258).vezesOCusto).toBeCloseTo(3, 10);
  });
});

describe("frase viva", () => {
  it("a cada R$ 1,00 a mais sobram 1 menos a taxa, com a taxa lida", () => {
    const p = pronto();
    const f = fraseViva(p, sim(p, 7000));
    expect(f).toMatch(/A cada R\$\s?1,00 a mais no preço sobram R\$\s?0,92 de lucro\./);
    expect(f).not.toMatch(SEM_PONTUACAO);
  });
  it("a inclinação é a mesma em toda a régua", () => {
    const p = pronto();
    expect(sim(p, 4000).ganhoPorReal).toBe(sim(p, 12_000).ganhoPorReal);
    expect(sim(p, 4000).ganhoPorReal).toBeCloseTo(0.9225, 10);
  });
  it("conta o lucro contra o preço de hoje, com ganho ou perda", () => {
    const p = pronto();
    expect(fraseViva(p, sim(p, 8000))).toContain("ganhando");
    expect(fraseViva(p, sim(p, 6000))).toContain("perdendo");
    expect(fraseViva(p, sim(p, 7000))).not.toContain("Contra o preço de hoje");
  });
  it("abaixo do custo fala em prejuízo, sem sinal solto", () => {
    const p = pronto();
    const f = fraseViva(p, sim(p, 2000));
    expect(f).toContain("prejuízo de");
    expect(f).not.toMatch(/-\s?R\$/);
    expect(fraseDoLucro(sim(p, 2000))).toMatch(/^Prejuízo de/);
  });
  it("sem taxas lidas diz que não deu para separar imposto e cartão", () => {
    const p = pronto({ taxas: null });
    expect(fraseViva(p, sim(p, 7000))).toContain("Não deu para separar imposto e cartão");
  });
  it("nenhuma frase tem parênteses, travessão ou seta", () => {
    const p = pronto();
    for (const c of [1500, 3086, 4050, 7000, 13_000]) {
      const s = sim(p, c);
      for (const t of [
        fraseViva(p, s),
        fraseDoLucro(s),
        resumoDaBarra(s),
        textoDeValorDoControle(c, s.faixa),
      ])
        expect(t).not.toMatch(SEM_PONTUACAO);
    }
    for (const a of p.avisos) expect(a.frase).not.toMatch(SEM_PONTUACAO);
  });
});

describe("zonas", () => {
  const custo = 3086;
  const minimo = 4050;
  it("vermelho abaixo do custo, amarelo abaixo do mínimo, verde acima", () => {
    expect(zonaDoPreco(custo - 1, custo, minimo)).toBe("abaixo_do_custo");
    expect(zonaDoPreco(custo, custo, minimo)).toBe("abaixo_do_minimo");
    expect(zonaDoPreco(minimo - 1, custo, minimo)).toBe("abaixo_do_minimo");
    expect(zonaDoPreco(minimo, custo, minimo)).toBe("no_minimo");
    expect(zonaDoPreco(Math.floor(minimo * 1.02), custo, minimo)).toBe("no_minimo");
    expect(zonaDoPreco(Math.floor(minimo * 1.02) + 1, custo, minimo)).toBe("acima");
  });
  it("sem mínimo, ou com mínimo menor que o custo real, não há amarelo", () => {
    expect(zonaDoPreco(custo, custo, null)).toBe("acima");
    expect(zonaDoPreco(custo - 1, custo, null)).toBe("abaixo_do_custo");
    expect(zonaDoPreco(custo, custo, custo - 500)).toBe("acima");
    expect(zonaDoPreco(custo, custo, custo)).toBe("acima");
  });
  it("sem mínimo calculado vem o aviso", () => {
    const p = pronto({
      taxas: null,
      real: real({
        preco_minimo_recomendado: null,
        tres_x_material: null,
        multiplicador_regra_de_tres: null,
      }),
    });
    expect(p.minimoCentavos).toBeNull();
    expect(p.avisos.map((a) => a.codigo)).toContain("sem_minimo");
  });
  it("a simulação carrega a faixa certa", () => {
    const p = pronto();
    expect(sim(p, 3000).faixa).toBe("abaixo_do_custo");
    expect(sim(p, 3500).faixa).toBe("abaixo_do_minimo");
    expect(sim(p, 7000).faixa).toBe("acima");
  });
});

describe("limites do controle", () => {
  it("vão do custo real, arredondado para baixo, ao dobro do balcão, em múltiplos de dez centavos", () => {
    const l = limitesDaReguas(linha());
    expect(l).toEqual({ minCentavos: 3080, maxCentavos: 14_000, passo: 10 });
  });
  it("são múltiplos de 10, o mínimo não passa do custo real e o máximo não fica abaixo de 2 vezes o balcão", () => {
    for (const [custoReal, balcao] of [
      [30.86, 70],
      [0.07, 0.99],
      [12.34, 45.55],
      [99.99, 123.45],
      [5, 5.01],
    ] as const) {
      const l = limitesDaReguas(linha({ real: real({ custo_real: custoReal }), preco: balcao }));
      expect(l).not.toBeNull();
      if (!l) continue;
      expect(l.minCentavos % 10).toBe(0);
      expect(l.maxCentavos % 10).toBe(0);
      expect(l.minCentavos).toBeLessThanOrEqual(Math.round(custoReal * 100));
      expect(l.maxCentavos).toBeGreaterThanOrEqual(Math.round(balcao * 200));
      expect(l.maxCentavos).toBeGreaterThan(l.minCentavos);
      expect(l.passo).toBe(10);
    }
  });
  it("sem preço de balcão usa o dobro do maior entre mínimo e regra de três", () => {
    const l = limitesDaReguas(linha({ preco: null }));
    // Regra de três de 30,86 é 92,58, maior que o mínimo de 40,50.
    expect(l?.maxCentavos).toBe(Math.ceil((92.58 * 2 * 100) / 10) * 10);
  });
  it("a régua tem sempre pelo menos um real de largura", () => {
    const l = limitesDaReguas(linha({ preco: 5, real: real({ custo_real: 30.86 }) }));
    expect(l && l.maxCentavos - l.minCentavos).toBeGreaterThanOrEqual(100);
  });
  it("sem custo real não há régua", () => {
    expect(limitesDaReguas(linha({ real: null }))).toBeNull();
    expect(limitesDaReguas(linha({ real: real({ custo_real: null }) }))).toBeNull();
    expect(limitesDaReguas(linha({ real: real({ custo_real: 0 }) }))).toBeNull();
  });
  it("prender na régua respeita limites e passo, e nunca devolve NaN", () => {
    const l = { minCentavos: 3080, maxCentavos: 14_000, passo: 10 };
    expect(prenderNaReguas(0, l)).toBe(3080);
    expect(prenderNaReguas(99_999, l)).toBe(14_000);
    expect(prenderNaReguas(7045, l)).toBe(7050);
    expect(prenderNaReguas(Number.NaN, l)).toBe(3080);
    expect(prenderNaReguas(Number.POSITIVE_INFINITY, l)).toBe(3080);
    expect(prenderNaReguas(Number.NEGATIVE_INFINITY, l)).toBe(3080);
  });
});

describe("marcas", () => {
  it("lista mínimo, regra de três, hoje, parceiro e concorrente, com posição na régua", () => {
    const p = pronto();
    expect(p.marcas.map((m) => m.codigo)).toEqual([
      "minimo",
      "regra_de_tres",
      "hoje",
      "parceiro",
      "concorrente",
    ]);
    const hoje = p.marcas.find((m) => m.codigo === "hoje");
    expect(hoje?.centavos).toBe(7000);
    expect(hoje?.dentro).toBe(true);
    expect(hoje?.pos).toBeCloseTo(((7000 - 3080) / (14_000 - 3080)) * 100, 10);
  });
  it("marca fora da régua não cabe e o texto diz isso", () => {
    const p = pronto({ preco_parceiro: 10, menor_concorrente: 500 });
    const parceiro = p.marcas.find((m) => m.codigo === "parceiro");
    const concorrente = p.marcas.find((m) => m.codigo === "concorrente");
    expect(parceiro?.dentro).toBe(false);
    expect(concorrente?.dentro).toBe(false);
    expect(textoDaMarca(parceiro!, p.limites)).toContain("fora da régua, abaixo do custo real");
    expect(textoDaMarca(concorrente!, p.limites)).toContain(
      "fora da régua, acima do dobro do balcão",
    );
    expect(textoDaMarca(p.marcas[0], p.limites)).not.toContain("fora da régua");
  });
  it("sem menor concorrente a marca não existe", () => {
    const p = pronto({ menor_concorrente: null });
    expect(p.marcas.some((m) => m.codigo === "concorrente")).toBe(false);
    const q = pronto({ menor_concorrente: undefined });
    expect(q.marcas.some((m) => m.codigo === "concorrente")).toBe(false);
  });
  it("sem parceiro a marca não existe", () => {
    expect(pronto({ preco_parceiro: null }).marcas.some((m) => m.codigo === "parceiro")).toBe(
      false,
    );
  });
});

describe("sem dado", () => {
  it("sem custo real", () => {
    for (const l of [linha({ real: null }), linha({ real: real({ custo_real: null }) })]) {
      const p = prepararSimulador(l);
      expect(p.estado).toBe("sem_dado");
      if (p.estado === "sem_dado") {
        expect(p.motivo).toBe("sem_custo_real");
        expect(p.frase).toContain("Sem custo real");
      }
    }
  });
  it("sem custo de produção", () => {
    const p = prepararSimulador(linha({ real: real({ custo_producao: null }) }));
    expect(p.estado === "sem_dado" && p.motivo).toBe("sem_custo_de_producao");
  });
  it("sem composição, ou com composição quebrada", () => {
    for (const composicao of [
      null,
      undefined,
      { material: Number.NaN, maquina: 1, maoDeObra: 1, indireto: 1 },
      { material: -1, maquina: 1, maoDeObra: 1, indireto: 1 },
    ]) {
      const p = prepararSimulador(linha({ composicao }));
      expect(p.estado === "sem_dado" && p.motivo).toBe("sem_composicao");
    }
  });
  it("composição toda zerada com resíduo negativo não tem como escalar", () => {
    const p = prepararSimulador(
      linha({
        composicao: { material: 0, maquina: 0, maoDeObra: 0, indireto: 0 },
        real: real({ custo_ocupacao: 0 }),
      }),
    );
    // Resíduo positivo: tudo cai em perdas e a barra existe.
    expect(p.estado).toBe("pronto");
  });
  it("preço simulado inválido vira sem dado, nunca NaN", () => {
    const p = pronto();
    for (const c of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = simularNoPreco(p, c);
      expect(s.estado).toBe("sem_dado");
    }
  });
  it("nenhuma frase de sem dado tem parênteses, travessão ou seta", () => {
    for (const l of [
      linha({ real: null }),
      linha({ composicao: null }),
      linha({ real: real({ custo_producao: null }) }),
    ]) {
      const p = prepararSimulador(l);
      if (p.estado === "sem_dado") expect(p.frase).not.toMatch(SEM_PONTUACAO);
    }
  });
});

describe("selo de custo incompleto", () => {
  it("um motivo para cada marca", () => {
    expect(motivosDoCustoIncompleto(real({ sem_tinta: true }))).toEqual([
      "A tinta ainda não entrou no custo.",
    ]);
    expect(motivosDoCustoIncompleto(real({ material_sem_custo: true }))).toEqual([
      "Há material da ficha sem custo cadastrado.",
    ]);
    expect(motivosDoCustoIncompleto(real({ sem_mao_de_obra: true }))).toEqual([
      "A mão de obra ainda não entrou no custo.",
    ]);
    const geral = motivosDoCustoIncompleto(real({ custo_incompleto: true }));
    expect(geral).toHaveLength(1);
    expect(geral[0]).toContain("manutenção, a limpeza ou o cabeçote da plotter");
  });
  it("nenhum quando está tudo certo, ou sem custo real", () => {
    expect(motivosDoCustoIncompleto(real())).toEqual([]);
    expect(motivosDoCustoIncompleto(null)).toEqual([]);
    expect(motivosDoCustoIncompleto(undefined)).toEqual([]);
  });
  it("junta vários motivos", () => {
    expect(
      motivosDoCustoIncompleto(
        real({ sem_tinta: true, sem_mao_de_obra: true, custo_incompleto: true }),
      ),
    ).toHaveLength(2);
  });
  it("nenhum motivo tem parênteses, travessão ou seta", () => {
    for (const m of motivosDoCustoIncompleto(
      real({ sem_tinta: true, material_sem_custo: true, sem_mao_de_obra: true }),
    ))
      expect(m).not.toMatch(SEM_PONTUACAO);
  });
});

describe("texto e centavos", () => {
  it("ida e volta com lerReais", () => {
    for (const c of [1, 10, 99, 100, 7045, 7000, 123_456]) {
      const t = centavosParaTexto(c);
      expect(textoParaCentavos(t)).toBe(c);
      expect(lerReais(t)).toBeCloseTo(c / 100, 10);
    }
    expect(centavosParaTexto(7045)).toBe("70,45");
    expect(centavosParaTexto(5)).toBe("0,05");
  });
  it("texto vazio ou sem sentido vira nulo", () => {
    for (const t of ["", "abc", "-5", "0", "1,234,5"]) expect(textoParaCentavos(t)).toBeNull();
  });
  it("centavosParaTexto nunca devolve NaN", () => {
    for (const c of [Number.NaN, Number.POSITIVE_INFINITY, -50])
      expect(centavosParaTexto(c)).not.toContain("NaN");
  });
  it("o valor do controle diz o preço e a zona em palavras", () => {
    expect(textoDeValorDoControle(7000, "acima")).toMatch(
      /R\$\s?70,00, acima do mínimo recomendado/,
    );
    expect(textoDeValorDoControle(3000, "abaixo_do_custo")).toContain("abaixo do custo");
  });
});

describe("propriedade: arrastar nunca devolve NaN", () => {
  it("em toda a régua, passo a passo, de todos os produtos de teste", () => {
    const linhas = [
      linha(),
      linha({ taxas: null }),
      linha({ preco: null }),
      linha({
        real: real({ custo_real: 1.07, custo_producao: 0.9 }),
        composicao: { material: 0.3, maquina: 0.2, maoDeObra: 0.1, indireto: 0.1 },
        preco: 3,
      }),
      linha({
        real: real({ custo_real: 480.33, custo_producao: 440, custo_ocupacao: 10 }),
        composicao: { material: 300, maquina: 50, maoDeObra: 30, indireto: 20 },
        preco: 900,
      }),
      linha({ taxas: { impostoVendaPct: 0, taxaCartaoPct: 0 } }),
      linha({ taxas: { impostoVendaPct: 50, taxaCartaoPct: 80 } }),
    ];
    for (const l of linhas) {
      const p = prepararSimulador(l);
      expect(p.estado).toBe("pronto");
      if (p.estado !== "pronto") continue;
      const passo = Math.max(
        10,
        Math.floor((p.limites.maxCentavos - p.limites.minCentavos) / 400) * 10,
      );
      for (let c = p.limites.minCentavos; c <= p.limites.maxCentavos; c += passo) {
        const s = sim(p, c);
        const numeros = [
          s.precoCentavos,
          s.lucroCentavos,
          s.lucroPct,
          s.vezesOCusto,
          s.ganhoPorReal,
          s.posicaoDoPrecoNaBarra,
          ...s.fatias.flatMap((f) => [f.centavos, f.pctDoPreco, f.larguraNaBarra]),
        ];
        for (const n of numeros) expect(Number.isFinite(n), `preço ${c}`).toBe(true);
        expect(somaDasFatias(s)).toBe(c);
        expect(fraseViva(p, s)).not.toContain("NaN");
        expect(resumoDaBarra(s)).not.toContain("NaN");
        expect(prenderNaReguas(c, p.limites)).toBeGreaterThanOrEqual(p.limites.minCentavos);
      }
    }
  });
  it("preços sorteados, inclusive fora da régua, mantêm soma e números finitos", () => {
    const p = pronto();
    let semente = 12345;
    const proximo = () => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente;
    };
    for (let i = 0; i < 500; i++) {
      const c = 1 + (proximo() % 50_000);
      const s = sim(p, c);
      expect(somaDasFatias(s)).toBe(c);
      expect(Number.isFinite(s.lucroPct)).toBe(true);
    }
  });
});

describe("faixa e lucro nunca se contradizem", () => {
  it("em cada centavo em volta do custo real, vermelho só quando o lucro é negativo", () => {
    for (const custoReal of [50, 50.004, 30.86, 49.99, 70.01]) {
      const p = pronto({
        real: real({
          custo_real: custoReal,
          custo_producao: custoReal * 0.9225,
          preco_minimo_recomendado: custoReal * 1.3,
        }),
        composicao: {
          material: custoReal * 0.4,
          maquina: custoReal * 0.2,
          maoDeObra: custoReal * 0.1,
          indireto: custoReal * 0.1,
        },
      });
      const c0 = Math.round(custoReal * 100);
      for (let c = c0 - 8; c <= c0 + 8; c++) {
        const s = sim(p, c);
        expect(s.faixa === "abaixo_do_custo").toBe(s.lucroCentavos < 0);
      }
    }
  });
});
