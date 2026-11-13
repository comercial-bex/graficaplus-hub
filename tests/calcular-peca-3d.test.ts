import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  avisosDaCotacao,
  calcularPeca3D,
  cotacaoComCusto,
  cotacaoPublica,
  inputsDoItem3d,
  LIMITES_DA_PECA_3D,
  resultadosDoItem3d,
  type EntradasDaPeca3D,
  type ResultadoDaPeca3D,
} from "../src/domain/impressao3d/calcular-peca";
import { machineCost } from "../src/domain/impressao3d/cost-engine";
import { camposDaTela, contaInlineDeHoje } from "./apoio/impressao3d/conta-inline-de-hoje";
import { gravacaoDeHoje } from "./apoio/impressao3d/gravacao-de-hoje";

/**
 * A conta da peça 3D saiu da calculadora para `src/domain/impressao3d/calcular-peca.ts` (onda C da
 * privacidade do custo, 11/11/2026). 22 dos 24 cálculos gravados até hoje foram feitos por quem NÃO vê custo:
 * o preço dessas pessoas vai passar a sair do servidor, por este módulo. Se o módulo divergir da conta de hoje
 * em um centavo, o vendedor cota outro preço sem ninguém ter decidido isso.
 *
 * O ORÁCULO é a conta de hoje copiada da calculadora (`tests/apoio/impressao3d/conta-inline-de-hoje.ts`,
 * conferida instrução por instrução contra as linhas 428 a 509 do commit dcd82c90). O corpus de ouro
 * (`tests/apoio/impressao3d/corpus-3d-de-ouro.json`) tem os 24 cálculos reais e 14 casos escritos à mão.
 */

type Entradas = {
  quantidade: number;
  gramasModelo: number;
  pesoSuporteG: number;
  pesoPurgaG: number;
  pecasPorPlaca: number;
  tempoMinutos: number;
  custoPorGrama: number;
  custoHoraMaquina: number;
  potenciaW: number;
  tarifaKwh: number;
  moCustoHora: number;
  moHoras: number;
  pctAcabamento: number;
  pctFalha: number;
  embalagemIncluida: boolean;
  embalagemValor: number;
  markup: number;
};
type Decomposicao = Record<string, number>;
type Registro = {
  n: number;
  entradas: Entradas;
  precoEsperado: number;
  valorUnitarioEsperado: number;
  precoDeHoje: number;
  unitarioDeHoje: number;
  peloMinimoHoje: boolean;
  placasHoje: number;
  decomposicaoDeHoje: Decomposicao;
  gravado: Decomposicao;
  bateComHoje: boolean;
  motivoSeNaoBate: string | null;
};
type Sintetico = {
  id: string;
  entradas: Entradas;
  esperadoDoOraculo: {
    preco: number;
    unitario: number;
    peloMinimo: boolean;
    placas: number;
    pecasPorPlaca: number;
    quantidade: number;
    horasMaoDeObra: number;
    decomposicao: Decomposicao;
  };
};

const corpus = JSON.parse(
  readFileSync("tests/apoio/impressao3d/corpus-3d-de-ouro.json", "utf8"),
) as { registros: Registro[]; sinteticos: Sintetico[] };

const MARKUP_ATACADO = 1.5;

function oraculo(e: Entradas, markupAtacadoPadrao: number | null = MARKUP_ATACADO) {
  return contaInlineDeHoje({
    f: camposDaTela(e),
    tempoMinutos: e.tempoMinutos,
    custoPorGramaCalculado: e.custoPorGrama,
    embalagemIncluida: e.embalagemIncluida,
    markupAtacadoPadrao,
  });
}

function entradasDoModulo(e: Entradas, markupAtacado = MARKUP_ATACADO): EntradasDaPeca3D {
  return {
    gramasModelo: e.gramasModelo,
    pesoSuporteG: e.pesoSuporteG,
    pesoPurgaG: e.pesoPurgaG,
    tempoMinutos: e.tempoMinutos,
    quantidade: e.quantidade,
    pecasPorPlaca: e.pecasPorPlaca,
    moHoras: e.moHoras,
    embalagemIncluida: e.embalagemIncluida,
    custoPorGrama: e.custoPorGrama,
    custoHoraMaquina: e.custoHoraMaquina,
    potenciaW: e.potenciaW,
    tarifaKwh: e.tarifaKwh,
    moCustoHora: e.moCustoHora,
    embalagemValor: e.embalagemValor,
    pctAcabamento: e.pctAcabamento,
    pctFalha: e.pctFalha,
    markup: e.markup,
    markupAtacado,
  };
}

const DECIMAIS = [
  "material",
  "maquina",
  "energia",
  "maoDeObra",
  "acabamento",
  "risco",
  "indireto",
  "operacional",
  "preco",
  "unitario",
  "lucro",
  "margem",
  "atacado",
  "equilibrio",
] as const;
const ESCALARES = [
  "cpg",
  "custoHora",
  "peloMinimo",
  "horasMaoDeObra",
  "markupAtacado",
  "qtd",
  "pecasPlaca",
  "placas",
  "markup",
] as const;

type Comparavel = Pick<ResultadoDaPeca3D, (typeof DECIMAIS)[number] | (typeof ESCALARES)[number]>;

/** Todas as diferenças entre duas contas, componente por componente (Decimal pelo valor exato de 6 casas). */
function diferencas(a: Comparavel, b: Comparavel): string[] {
  const ruins: string[] = [];
  for (const k of DECIMAIS) {
    if (!a[k].eq(b[k])) ruins.push(`${k}: ${a[k].toString(6)} x ${b[k].toString(6)}`);
  }
  for (const k of ESCALARES) if (a[k] !== b[k]) ruins.push(`${k}: ${a[k]} x ${b[k]}`);
  return ruins;
}

function mulberry32(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entradas sorteadas no desenho do laboratório do c0 (semente fixa: o mesmo conjunto em toda execução). */
function sorteadas(n: number, semente = 20261111): Entradas[] {
  const rnd = mulberry32(semente);
  const entre = (min: number, max: number, casas: number) =>
    Number((min + rnd() * (max - min)).toFixed(casas));
  const inteiro = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1));
  const escolhe = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const casos: Entradas[] = [];
  for (let i = 0; i < n; i++) {
    const embalagemIncluida = rnd() < 0.25;
    casos.push({
      quantidade: rnd() < 0.5 ? inteiro(1, 5) : inteiro(1, 2000),
      pecasPorPlaca: rnd() < 0.6 ? 1 : inteiro(1, 30),
      gramasModelo: entre(0.01, rnd() < 0.8 ? 400 : 3000, 2),
      pesoSuporteG: rnd() < 0.7 ? 0 : entre(0.01, 400, 2),
      pesoPurgaG: rnd() < 0.8 ? 0 : entre(0.01, 400, 2),
      tempoMinutos: rnd() < 0.7 ? inteiro(1, 1500) : inteiro(1, 30000),
      custoPorGrama: escolhe([
        0.05932,
        0.09,
        0.0658,
        0.1299,
        0.15,
        0.17,
        0.29676,
        entre(0.01, 0.5, 6),
        0,
      ]),
      custoHoraMaquina: escolhe([0.5995, 0.876, 1.349, 1.375, entre(0, 6, 4), 0]),
      potenciaW: escolhe([150, 500, entre(0, 1500, 0)]),
      tarifaKwh: escolhe([1.1339, 0.95, entre(0.3, 3, 4), 0]),
      moCustoHora: escolhe([12.17, 40, entre(0, 90, 2)]),
      moHoras: rnd() < 0.6 ? 0 : escolhe([0.0333, 0.5, 1, entre(0.01, 4, 2)]),
      pctAcabamento: escolhe([0, 5, 12, entre(0, 30, 1)]),
      pctFalha: escolhe([0, 3, 5, 10, entre(0, 30, 1)]),
      embalagemIncluida,
      embalagemValor: embalagemIncluida ? escolhe([12, entre(0.01, 60, 2), 0]) : 0,
      markup: escolhe([2, 1.4, 1.5, 2.3, entre(1, 5, 2)]),
    });
  }
  return casos;
}

const nomeDoRegistro = (r: Registro) => `real n=${r.n}`;

/** Folga dos testes de 20.000 sorteios: máquina carregada ou CI lento não pode derrubar a suíte. */
const TEMPO_DO_SORTEIO = 60_000;

describe("o corpus de ouro é o que a conta de hoje devolve (o oráculo não envelheceu)", () => {
  it.each(corpus.registros.map((r) => [nomeDoRegistro(r), r] as const))("%s", (_nome, r) => {
    const o = oraculo(r.entradas);
    expect(o.preco.toNumber()).toBe(r.precoDeHoje);
    expect(o.unitario.toNumber()).toBe(r.unitarioDeHoje);
    expect(o.peloMinimo).toBe(r.peloMinimoHoje);
    expect(o.placas).toBe(r.placasHoje);
    for (const [k, v] of Object.entries(r.decomposicaoDeHoje)) {
      expect(o[k as (typeof DECIMAIS)[number]].toNumber(), k).toBe(v);
    }
  });

  it.each(corpus.sinteticos.map((s) => [s.id, s] as const))("%s", (_nome, s) => {
    const o = oraculo(s.entradas);
    const x = s.esperadoDoOraculo;
    expect(o.preco.toNumber()).toBe(x.preco);
    expect(o.unitario.toNumber()).toBe(x.unitario);
    expect(o.peloMinimo).toBe(x.peloMinimo);
    expect(o.placas).toBe(x.placas);
    expect(o.pecasPlaca).toBe(x.pecasPorPlaca);
    expect(o.qtd).toBe(x.quantidade);
    expect(o.horasMaoDeObra).toBe(x.horasMaoDeObra);
    for (const [k, v] of Object.entries(x.decomposicao)) {
      expect(o[k as (typeof DECIMAIS)[number]].toNumber(), k).toBe(v);
    }
  });

  it("tem os 24 reais e os 14 sintéticos", () => {
    expect(corpus.registros).toHaveLength(24);
    expect(corpus.sinteticos).toHaveLength(14);
  });
});

describe("calcularPeca3D dá o mesmo que a conta de hoje, em TODOS os componentes", () => {
  it.each(corpus.registros.map((r) => [nomeDoRegistro(r), r.entradas] as const))(
    "%s",
    (_nome, e) => {
      const m = calcularPeca3D(entradasDoModulo(e));
      expect(diferencas(oraculo(e), m)).toEqual([]);
      expect(m.horasTotais).toBe(e.tempoMinutos / 60);
    },
  );

  it.each(corpus.sinteticos.map((s) => [s.id, s.entradas] as const))("%s", (_nome, e) => {
    const m = calcularPeca3D(entradasDoModulo(e));
    expect(diferencas(oraculo(e), m)).toEqual([]);
    expect(m.horasTotais).toBe(e.tempoMinutos / 60);
  });

  it(
    "20.000 entradas sorteadas com semente fixa: zero divergência, e o sorteio cobre os casos que importam",
    () => {
      let divergencias = 0;
      let primeiro = "";
      const cobertura = { piso: 0, variasPlacas: 0, embalagem: 0, maoDeObra: 0, pontoFlutuante: 0 };
      for (const e of sorteadas(20_000)) {
        const o = oraculo(e);
        const d = diferencas(o, calcularPeca3D(entradasDoModulo(e)));
        if (d.length) {
          divergencias++;
          primeiro ||= `${JSON.stringify(e)} => ${d.join("; ")}`;
        }
        if (o.peloMinimo) cobertura.piso++;
        if (o.placas > 1) cobertura.variasPlacas++;
        if (e.embalagemIncluida && e.embalagemValor > 0) cobertura.embalagem++;
        if (e.moHoras > 0) cobertura.maoDeObra++;
        if ((e.tempoMinutos / 60) * 3600 !== e.tempoMinutos * 60) cobertura.pontoFlutuante++;
      }
      expect(primeiro).toBe("");
      expect(divergencias).toBe(0);
      // Um sorteio que não passa pelo piso, por várias placas ou pelos minutos que quebram o ponto
      // flutuante passaria sempre e não provaria nada.
      expect(cobertura.piso).toBeGreaterThan(100);
      expect(cobertura.variasPlacas).toBeGreaterThan(5_000);
      expect(cobertura.embalagem).toBeGreaterThan(1_000);
      expect(cobertura.maoDeObra).toBeGreaterThan(5_000);
      expect(cobertura.pontoFlutuante).toBeGreaterThan(500);
      // 20.000 sorteios levam ~1 s num micro quieto e mais de 7 s num carregado: folga explícita, o padrão é 5 s.
    },
    TEMPO_DO_SORTEIO,
  );

  it("entradas estranhas (zero, negativo, fração) dão o mesmo que a tela de hoje, sem exceção nova", () => {
    const base = corpus.sinteticos[0].entradas;
    const estranhas: Entradas[] = [
      { ...base, quantidade: 0 },
      { ...base, quantidade: 2.5, pecasPorPlaca: 0 },
      { ...base, quantidade: -3 },
      { ...base, markup: 0 },
      { ...base, moHoras: -1, pctFalha: 0, pctAcabamento: 0 },
      { ...base, embalagemIncluida: true, embalagemValor: -12 },
      { ...base, custoHoraMaquina: 0, potenciaW: 0, tarifaKwh: 0, custoPorGrama: 0 },
    ];
    for (const e of estranhas) {
      expect(
        diferencas(oraculo(e), calcularPeca3D(entradasDoModulo(e))),
        JSON.stringify(e),
      ).toEqual([]);
    }
  });

  it("markup de atacado ausente: os dois caem no mesmo 1,5", () => {
    const e = corpus.sinteticos[0].entradas;
    const daBase: number | null = null; // linha da base sem markup de atacado
    const o = oraculo(e, daBase);
    // o servidor passa `Number(base.markup_atacado_padrao ?? 1.5)`
    const m = calcularPeca3D(entradasDoModulo(e, Number(daBase ?? 1.5)));
    expect(diferencas(o, m)).toEqual([]);
    expect(calcularPeca3D(entradasDoModulo(e, NaN)).markupAtacado).toBe(1.5);
  });
});

describe("o teste tem dentes: mandar SEGUNDOS em vez de minutos é pego", () => {
  /** O atalho tentador: máquina por `minutos * 60` em vez de `(minutos / 60) * 3600`. */
  function mutanteEmSegundos(e: Entradas): Comparavel {
    const certo = calcularPeca3D(entradasDoModulo(e));
    return {
      ...certo,
      maquina: machineCost(e.tempoMinutos * 60, e.custoHoraMaquina).mul(certo.placas),
    };
  }

  it("o caso s06 (123 minutos) falha com o mutante", () => {
    const s06 = corpus.sinteticos.find((s) => s.id.startsWith("s06"));
    expect(s06).toBeDefined();
    const d = diferencas(oraculo(s06!.entradas), mutanteEmSegundos(s06!.entradas));
    expect(d.some((x) => x.startsWith("maquina:"))).toBe(true);
  });

  it(
    "no sorteio, o mutante diverge em centenas de casos",
    () => {
      let pegos = 0;
      for (const e of sorteadas(20_000))
        if (diferencas(oraculo(e), mutanteEmSegundos(e)).length) pegos++;
      expect(pegos).toBeGreaterThan(50);
    },
    TEMPO_DO_SORTEIO,
  );
});

describe("o preço gravado: só 13 dos 24 ainda são a regra de hoje, e os outros 11 têm motivo conhecido", () => {
  // Os preços gravados são de antes de 13/11/2026, quando a mão de obra só entrava se alguém digitasse horas.
  // Para provar que o resto da conta não mudou, o módulo roda com taxa de mão de obra ZERO nos cálculos que
  // gravaram mão de obra zero (os 2 minutos padrão valem hoje, mas não existiam nesses preços).
  const comModulo = corpus.registros.map((r) => ({
    r,
    m: calcularPeca3D(
      entradasDoModulo({
        ...r.entradas,
        moCustoHora: r.gravado.maoDeObra > 0 ? r.entradas.moCustoHora : 0,
      }),
    ),
  }));

  it("nos 13 que batem, o módulo dá o total e o unitário gravados, ao centavo", () => {
    const batem = comModulo.filter(({ r }) => r.bateComHoje);
    expect(batem).toHaveLength(13);
    for (const { r, m } of batem) {
      expect(m.preco.toNumber(), `n=${r.n}`).toBe(r.precoEsperado);
      expect(m.unitario.toNumber(), `n=${r.n}`).toBe(r.valorUnitarioEsperado);
    }
  });

  it("4 gravaram o total sem arredondar (antes de 14/10): o unitário é o mesmo e o total difere menos de um centavo", () => {
    const semArredondar = comModulo.filter(
      ({ r, m }) =>
        !r.bateComHoje && !m.peloMinimo && (r.motivoSeNaoBate ?? "").includes("sem arredondar"),
    );
    expect(semArredondar.map(({ r }) => r.n)).toEqual([1, 2, 3, 4]);
    for (const { r, m } of semArredondar) {
      expect(m.unitario.toNumber()).toBe(r.valorUnitarioEsperado);
      expect(Math.abs(m.preco.toNumber() - r.precoEsperado)).toBeLessThan(0.01);
    }
  });

  it("7 são de antes do piso de R$ 5,00 por peça (30/10): hoje valem o piso", () => {
    // Pelo módulo SEM os 2 minutos (como eram esses preços): com a mão de obra de hoje, só 2 dos 7 ainda ficam no piso.
    const peloPiso = comModulo.filter(({ r, m }) => !r.bateComHoje && m.peloMinimo);
    expect(peloPiso.map(({ r }) => r.n)).toEqual([8, 11, 12, 13, 15, 16, 17]);
    for (const { r, m } of peloPiso) {
      expect(m.peloMinimo).toBe(true);
      expect(m.unitario.toNumber()).toBe(5);
      expect(r.valorUnitarioEsperado).toBeLessThan(5);
    }
  });

  it("o custo operacional dos 24 é o gravado: a fórmula do custo não mudou, só o fechamento do preço", () => {
    for (const { r, m } of comModulo)
      expect(m.operacional.toNumber(), `n=${r.n}`).toBe(r.gravado.operacional);
  });
});

describe("os construtores gravam no formato de hoje", () => {
  const casos = [
    ...corpus.registros.map((r) => [nomeDoRegistro(r), r.entradas] as const),
    ...corpus.sinteticos.map((s) => [s.id, s.entradas] as const),
  ];

  it.each(casos)("%s: inputs_json e resultados_json iguais aos da calculadora", (_nome, e) => {
    const calc = oraculo(e);
    const hoje = gravacaoDeHoje({
      f: {
        ...camposDaTela(e),
        cliente_id: "",
        titulo: "Peça",
        maquina_id: "m",
        material_id: "f",
        filamento_tipo_detectado: "PLA",
        altura_camada: "0,2",
        infill_pct: "",
      },
      calc,
      tempoHoras: e.tempoMinutos / 60,
      embalagemIncluida: e.embalagemIncluida,
      clienteId: "c",
      slicerPath: null,
      slicerAtualPath: "orcamentos-3d/1_slicer_peca.3mf",
      impressora: { maquinas: { nome: "Bambu Lab 3D 01" } },
      filamento: { materiais: { nome: "PLA 3DX Natural" } },
      orcId: "o",
      orcamento3dId: null,
      fotoArquivoId: null,
      materialDescricao: null,
    });
    const entradas = entradasDoModulo(e);
    const r = calcularPeca3D(entradas);
    const extras = {
      clienteId: "c",
      filamentoTipoDetectado: "PLA",
      alturaCamadaMm: 0.2,
      infillPct: null,
      slicerScreenshot: "orcamentos-3d/1_slicer_peca.3mf",
      impressora: "Bambu Lab 3D 01",
      filamento: "PLA 3DX Natural",
    };
    expect(inputsDoItem3d(entradas, r, extras)).toEqual(hoje.inputs);
    expect(resultadosDoItem3d(entradas, r)).toEqual(hoje.resultados);
  });
});

describe("o que sai para fora", () => {
  const r = calcularPeca3D(entradasDoModulo(corpus.sinteticos[2].entradas));

  it("a cotação pública tem EXATAMENTE as chaves de preço, nada de custo", () => {
    expect(Object.keys(cotacaoPublica(r, [])).sort()).toEqual(
      [
        "avisos",
        "peloMinimo",
        "pecasPorPlaca",
        "placas",
        "preco",
        "quantidade",
        "unitario",
        "verCusto",
      ].sort(),
    );
  });

  it("a cotação com custo acrescenta a decomposição, e mais nada", () => {
    const c = cotacaoComCusto(r, []);
    expect(Object.keys(c).sort()).toEqual(
      [
        "avisos",
        "decomposicao",
        "peloMinimo",
        "pecasPorPlaca",
        "placas",
        "preco",
        "quantidade",
        "unitario",
        "verCusto",
      ].sort(),
    );
    expect(c.decomposicao.operacional).toBe(r.operacional.toNumber());
    expect(c.decomposicao.equilibrio).toBe(r.equilibrio.toNumber());
  });

  it("avisos só dizem que o cadastro está zerado", () => {
    expect(
      avisosDaCotacao({ custoHoraMaquina: 1.349, potenciaW: 150, custoPorGrama: 0.0658 }),
    ).toEqual([]);
    expect(avisosDaCotacao({ custoHoraMaquina: 0, potenciaW: 0, custoPorGrama: 0 })).toEqual([
      "impressora_sem_custo_hora",
      "impressora_sem_potencia",
      "filamento_sem_custo",
    ]);
  });

  it("nenhum limite deixa um número digitado chegar ao Decimal escrito com expoente", () => {
    for (const [campo, l] of Object.entries(LIMITES_DA_PECA_3D)) {
      const pontas = [l.min, l.max, l.min * 60, l.min / 60];
      for (const v of pontas) expect(String(v), campo).not.toMatch(/e/i);
    }
  });
});
