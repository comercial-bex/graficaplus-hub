import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O preço da peça 3D no SERVIDOR (onda C da privacidade do custo, 11/11/2026).
 *
 * O vendedor manda peso, tempo e quantidade; o servidor lê as taxas com a chave de serviço, faz a MESMA conta
 * da calculadora de hoje e devolve só o preço. Estes testes travam: (1) a entrada estrita (o navegador não
 * manda preço, custo, markup nem taxa); (2) a resposta de quem não vê custo sem nenhum número de custo;
 * (3) a permissão conferida antes de qualquer leitura com a chave de serviço; (4) `custo_hora_calculado` e
 * nunca `custo_hora_manual`; (5) falha vira erro em português, nunca preço de fábrica; (6) o preço igual ao
 * da calculadora de hoje, caso a caso do corpus de ouro; (7) a gravação pelo cliente do próprio usuário, no
 * formato de hoje. Padrão de mock: `tests/preco-cliente-final-x-parceiro.test.ts`, com `context.supabase`.
 */

type Linha = Record<string, unknown>;
type Consulta = { tabela: string; colunas: string; filtros: Record<string, unknown> };
type Resposta = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  erroDePermissao: false,
  base: null as Linha | null,
  impressoras: [] as Linha[],
  filamentos: [] as Linha[],
  erroNaTabela: null as string | null,
  consultas: [] as { tabela: string; colunas: string; filtros: Record<string, unknown> }[],
  rpcDoUsuario: [] as { nome: string; args: Record<string, unknown> }[],
  rpcComChaveDeServico: [] as string[],
  respostaDoSalvar: null as { data: unknown; error: { message: string } | null } | null,
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@tanstack/react-start", () => {
  type Validador = (d: unknown) => unknown;
  type Manipulador = (a: { data: unknown; context: unknown }) => Promise<unknown>;
  return {
    // Uma cadeia NOVA por função: o arquivo cria duas, e cada uma tem o seu validador.
    createServerFn: () => {
      let validar: Validador = (d) => d;
      const cadeia = {
        middleware: () => cadeia,
        inputValidator: (v: Validador) => {
          validar = v;
          return cadeia;
        },
        handler: (fn: Manipulador) => async (entrada: { data: unknown }) =>
          fn({ data: validar(entrada.data), context: contexto() }),
      };
      return cadeia;
    },
  };

  function contexto() {
    return {
      userId: "u1",
      claims: {},
      supabase: {
        rpc: async (nome: string, args: Record<string, unknown>) => {
          h.rpcDoUsuario.push({ nome, args });
          if (nome === "has_permission") {
            if (h.erroDePermissao) return { data: null, error: { message: "timeout" } };
            return { data: h.permissoes.has(String(args._permission)), error: null };
          }
          if (nome === "salvar_item_3d_no_orcamento") {
            if (h.respostaDoSalvar) return h.respostaDoSalvar;
            const qtd = Number(args.p_quantidade);
            const unit = Math.round((Number(args.p_preco) / qtd) * 100) / 100;
            return {
              data: {
                orcamento_id: args.p_orcamento_id,
                orcamento_3d_id: "7d0c3a52-9f3e-4b8e-a1a7-5d6f8e9c0b11",
                item_id: "1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b",
                valor_unitario: unit,
                valor_total: Math.round(unit * qtd * 100) / 100,
                versao: 1,
              },
              error: null,
            };
          }
          return { data: null, error: { message: `rpc inesperada: ${nome}` } };
        },
      },
    };
  }
});

vi.mock("@/integrations/supabase/client.server", () => {
  /** Projeta a linha nas colunas pedidas (com `tabela(coluna)` embutida), como o PostgREST. */
  function projetar(linha: Record<string, unknown>, colunas: string) {
    const out: Record<string, unknown> = {};
    for (const bruto of colunas.split(/,(?![^(]*\))/)) {
      const c = bruto.trim();
      const embutida = c.match(/^(\w+)\(([^)]*)\)$/);
      if (embutida) {
        const filho = (linha[embutida[1]] ?? null) as Record<string, unknown> | null;
        out[embutida[1]] = filho ? projetar(filho, embutida[2]) : null;
      } else out[c] = linha[c];
    }
    return out;
  }
  function responder(q: { tabela: string; colunas: string; filtros: Record<string, unknown> }) {
    if (h.erroNaTabela === q.tabela) {
      return { data: null, error: { message: `permission denied for table ${q.tabela}` } };
    }
    const confere = (l: Record<string, unknown>) =>
      Object.entries(q.filtros).every(([k, v]) => l[k] === v);
    let linha: Record<string, unknown> | null = null;
    if (q.tabela === "config_precificacao_3d")
      linha = h.base && confere({ id: true }) ? h.base : null;
    if (q.tabela === "maquinas_3d_config") linha = h.impressoras.find(confere) ?? null;
    if (q.tabela === "materiais_3d_filamento") linha = h.filamentos.find(confere) ?? null;
    return { data: linha ? projetar(linha, q.colunas) : null, error: null };
  }
  return {
    supabaseAdmin: {
      from: (tabela: string) => {
        const q = { tabela, colunas: "*", filtros: {} as Record<string, unknown> };
        h.consultas.push(q);
        const b = {
          select: (c: string) => {
            q.colunas = c;
            return b;
          },
          eq: (k: string, v: unknown) => {
            q.filtros[k] = v;
            return b;
          },
          maybeSingle: async () => responder(q),
        };
        return b;
      },
      rpc: async (nome: string) => {
        h.rpcComChaveDeServico.push(nome);
        return { data: null, error: null };
      },
    },
  };
});

import { cotarPeca3d, salvarPeca3dNoOrcamento } from "../src/lib/api/orcamento-3d.functions";
import { descreverFilamento } from "../src/domain/impressao3d/arquivos";
import { camposDaTela, contaInlineDeHoje } from "./apoio/impressao3d/conta-inline-de-hoje";
import { gravacaoDeHoje } from "./apoio/impressao3d/gravacao-de-hoje";

const cotar = cotarPeca3d as unknown as (a: { data: unknown }) => Promise<Record<string, unknown>>;
const salvar = salvarPeca3dNoOrcamento as unknown as (a: {
  data: unknown;
}) => Promise<Record<string, unknown>>;

const MAQUINA = "39807c59-d6da-42f4-9072-9540978cd3d4";
const MAQUINA_DESLIGADA = "53d4ed68-2472-48e9-bacf-0adacf3bf193";
const FILAMENTO = "073d7118-27e9-4fe9-aa4e-5f74f304666f";
const ORCAMENTO = "996f3d96-b34b-49fa-9be6-4f94c43129c7";
const CLIENTE = "2b8f0f6e-3c1a-4d5e-9f7a-1b2c3d4e5f60";
const FOTO = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

/** Taxas de valor inconfundível: se alguma aparecer na resposta do vendedor, o teste acha. */
const TAXAS = {
  custo_hora_calculado: 7.7777,
  custo_hora_manual: 99,
  potencia_media_w: 123.4,
  custo_por_grama_calculado: 0.1234,
  tarifa_kwh_padrao: 1.9876,
  mo_custo_hora_padrao: 33.33,
  markup_padrao: 3.5,
  markup_atacado_padrao: 2.75,
  pct_acabamento_padrao: 6.5,
  pct_falha_padrao: 4.25,
  custo_admin_padrao: 9.87,
};

const TODAS_AS_PERMISSOES_DE_COTAR = [
  "orcamentos.create",
  "orcamentos.update",
  "impressao3d.quote.create",
  "impressao3d.quote.update",
];
const VENDEDOR = TODAS_AS_PERMISSOES_DE_COTAR;
const GESTOR = [...TODAS_AS_PERMISSOES_DE_COTAR, "impressao3d.cost.read"];

function carregarBanco(t: {
  custoHora: unknown;
  potencia: unknown;
  cpg: unknown;
  tarifa: unknown;
  moCustoHora: unknown;
  markup: unknown;
  markupAtacado: unknown;
  pctAcabamento: unknown;
  pctFalha: unknown;
  embalagem: unknown;
}) {
  h.base = {
    id: true,
    tarifa_kwh_padrao: t.tarifa,
    mo_custo_hora_padrao: t.moCustoHora,
    markup_padrao: t.markup,
    markup_atacado_padrao: t.markupAtacado,
    pct_acabamento_padrao: t.pctAcabamento,
    pct_falha_padrao: t.pctFalha,
    custo_admin_padrao: t.embalagem,
    salario_mensal: 5432.1,
  };
  h.impressoras = [
    {
      maquina_id: MAQUINA,
      custo_hora_calculado: t.custoHora,
      custo_hora_manual: TAXAS.custo_hora_manual,
      depreciacao_hora: 4.4444,
      potencia_media_w: t.potencia,
      ativa: true,
      maquinas: { nome: "Bambu Lab 3D 01", valor_compra: 8999 },
    },
    {
      maquina_id: MAQUINA_DESLIGADA,
      custo_hora_calculado: 0.876,
      potencia_media_w: 150,
      ativa: false,
      maquinas: { nome: "Bambu Lab 3D 02" },
    },
  ];
  h.filamentos = [
    {
      material_id: FILAMENTO,
      custo_por_grama_calculado: t.cpg,
      preco_compra: 129.9,
      peso_rolo_g: 1000,
      tipo: "PLA Lite",
      cor: "Ciano",
      materiais: { nome: "PLA Lite Ciano (Bambu Lab)" },
    },
  ];
}

function bancoDistintivo() {
  carregarBanco({
    custoHora: TAXAS.custo_hora_calculado,
    potencia: TAXAS.potencia_media_w,
    cpg: TAXAS.custo_por_grama_calculado,
    tarifa: TAXAS.tarifa_kwh_padrao,
    moCustoHora: TAXAS.mo_custo_hora_padrao,
    markup: TAXAS.markup_padrao,
    markupAtacado: TAXAS.markup_atacado_padrao,
    pctAcabamento: TAXAS.pct_acabamento_padrao,
    pctFalha: TAXAS.pct_falha_padrao,
    embalagem: TAXAS.custo_admin_padrao,
  });
}

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

/** O banco com as taxas DESTE caso, para o servidor ter de chegar ao mesmo preço da calculadora de hoje. */
function bancoDoCaso(e: Entradas) {
  carregarBanco({
    custoHora: e.custoHoraMaquina,
    potencia: e.potenciaW,
    cpg: e.custoPorGrama,
    tarifa: e.tarifaKwh,
    moCustoHora: e.moCustoHora,
    markup: e.markup,
    markupAtacado: 1.5,
    pctAcabamento: e.pctAcabamento,
    pctFalha: e.pctFalha,
    embalagem: e.embalagemValor,
  });
}

/** O que o navegador manda: só o que se digita. */
function pedidoDoCaso(e: Entradas) {
  return {
    maquinaId: MAQUINA,
    materialId: FILAMENTO,
    gramasModelo: e.gramasModelo,
    pesoSuporteG: e.pesoSuporteG,
    pesoPurgaG: e.pesoPurgaG,
    tempoMinutos: e.tempoMinutos,
    quantidade: e.quantidade,
    pecasPorPlaca: e.pecasPorPlaca,
    moHoras: e.moHoras,
    embalagemIncluida: e.embalagemIncluida,
  };
}

function oraculo(e: Entradas) {
  return contaInlineDeHoje({
    f: camposDaTela(e),
    tempoMinutos: e.tempoMinutos,
    custoPorGramaCalculado: e.custoPorGrama,
    embalagemIncluida: e.embalagemIncluida,
    markupAtacadoPadrao: 1.5,
  });
}

type Caso = { nome: string; entradas: Entradas };
const corpus = JSON.parse(
  readFileSync("tests/apoio/impressao3d/corpus-3d-de-ouro.json", "utf8"),
) as {
  registros: { n: number; entradas: Entradas }[];
  sinteticos: { id: string; entradas: Entradas }[];
};
const CASOS: Caso[] = [
  ...corpus.registros.map((r) => ({ nome: `real n=${r.n}`, entradas: r.entradas })),
  ...corpus.sinteticos.map((s) => ({ nome: s.id, entradas: s.entradas })),
];

const PEDIDO_SIMPLES = {
  maquinaId: MAQUINA,
  materialId: FILAMENTO,
  gramasModelo: 52,
  tempoMinutos: 190,
  quantidade: 10,
  pecasPorPlaca: 4,
};

/** Todos os números de um objeto (em qualquer profundidade) e todos os nomes de chave. */
function varrer(x: unknown, numeros: number[] = [], chaves: string[] = []) {
  if (typeof x === "number") numeros.push(x);
  else if (Array.isArray(x)) x.forEach((v) => varrer(v, numeros, chaves));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      chaves.push(k);
      varrer(v, numeros, chaves);
    }
  }
  return { numeros, chaves };
}

let erroDoConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.permissoes = new Set(VENDEDOR);
  h.erroDePermissao = false;
  h.erroNaTabela = null;
  h.consultas = [];
  h.rpcDoUsuario = [];
  h.rpcComChaveDeServico = [];
  h.respostaDoSalvar = null;
  bancoDistintivo();
  erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  erroDoConsole.mockRestore();
});

describe("a entrada é estrita: o navegador não manda preço, custo nem taxa", () => {
  it.each([
    ["preco", 1],
    ["markup", 5],
    ["custoHora", 0.01],
    ["custoPorGrama", 0.001],
    ["tarifaKwh", 0],
    ["pctFalha", 0],
    ["moCustoHora", 0],
    ["qualquerCoisa", "x"],
  ])("recusa a chave %s", async (chave, valor) => {
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, [chave]: valor } })).rejects.toThrow(
      `Confira os dados da peça: campo não aceito (${chave}).`,
    );
    expect(h.consultas).toHaveLength(0);
  });

  it("frases curtas em português, sem o JSON do zod", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [
        { quantidade: 2.5 },
        "Confira os dados da peça (quantidade): precisa ser um número inteiro.",
      ],
      [
        { tempoMinutos: 0 },
        "Confira os dados da peça (tempo de impressão): deve ser pelo menos 1.",
      ],
      [{ gramasModelo: undefined }, "Confira os dados da peça (peso do modelo): falta preencher."],
      [{ gramasModelo: "52" }, "Confira os dados da peça (peso do modelo): precisa ser um número."],
      [
        { moHoras: 1e-9 },
        "Confira os dados da peça (horas de acabamento por peça): deve ser zero ou pelo menos 0,001.",
      ],
      [
        { pecasPorPlaca: 20_000 },
        "Confira os dados da peça (peças por placa): deve ser no máximo 10.000.",
      ],
      [{ maquinaId: "abc" }, "Confira os dados da peça (impressora): valor inválido."],
      [{ pesoSuporteG: -1 }, "Confira os dados da peça (peso do suporte): deve ser pelo menos 0."],
    ];
    for (const [troca, frase] of casos) {
      await expect(cotar({ data: { ...PEDIDO_SIMPLES, ...troca } })).rejects.toThrow(frase);
    }
    expect(h.consultas).toHaveLength(0);
  });

  it("horas de acabamento e embalagem são opcionais: sem elas, zero e desligada", async () => {
    const r = await cotar({ data: PEDIDO_SIMPLES });
    expect(r.preco).toBeTypeOf("number");
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, moHoras: 0 } })).resolves.toEqual(r);
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, embalagemIncluida: false } })).resolves.toEqual(
      r,
    );
  });
});

describe("quem não vê custo não escolhe horas de acabamento nem embalagem (achado do revisor)", () => {
  const FRASE =
    "Confira os dados da peça: horas de acabamento e embalagem só valem para quem vê o custo.";

  it("duas cotações com moHoras 0 e 1 NÃO isolam mão de obra x markup: a segunda é recusada", async () => {
    const zero = await cotar({ data: { ...PEDIDO_SIMPLES, moHoras: 0 } });
    expect(zero.preco).toBeTypeOf("number");
    h.consultas.length = 0;
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, moHoras: 1 } })).rejects.toThrow(FRASE);
    expect(h.consultas).toHaveLength(0);
  });

  it("embalagem ligada também é recusada, sem ler taxa", async () => {
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, embalagemIncluida: true } })).rejects.toThrow(
      FRASE,
    );
    expect(h.consultas).toHaveLength(0);
  });

  it("salvar tem a mesma guarda: nada é lido nem gravado", async () => {
    const e = corpus.sinteticos[2].entradas;
    for (const extra of [{ moHoras: 1 }, { embalagemIncluida: true }]) {
      await expect(salvar({ data: pedidoDeSalvar(e, extra) })).rejects.toThrow(FRASE);
    }
    expect(h.consultas).toHaveLength(0);
    expect(h.rpcDoUsuario.filter((c) => c.nome === "salvar_item_3d_no_orcamento")).toHaveLength(0);
  });

  it("quem vê custo continua mandando os dois, com o preço de sempre", async () => {
    h.permissoes = new Set(GESTOR);
    const com = await cotar({
      data: { ...PEDIDO_SIMPLES, moHoras: 1, embalagemIncluida: true },
    });
    const sem = await cotar({ data: PEDIDO_SIMPLES });
    expect(com.preco).toBeGreaterThan(sem.preco as number);
  });
});

describe("permissão: conferida ANTES de qualquer leitura com a chave de serviço", () => {
  it("sem nenhuma das quatro permissões de cotar: recusa e não lê taxa nenhuma", async () => {
    h.permissoes = new Set();
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow("Seu perfil não cota peças 3D.");
    expect(h.consultas).toHaveLength(0);
  });

  it("quem só vê custo (o financeiro) também não cota", async () => {
    h.permissoes = new Set(["impressao3d.cost.read", "financeiro.read"]);
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow("Seu perfil não cota peças 3D.");
    expect(h.consultas).toHaveLength(0);
  });

  it.each(TODAS_AS_PERMISSOES_DE_COTAR)("qualquer uma basta: só %s", async (p) => {
    h.permissoes = new Set([p]);
    const r = await cotar({ data: PEDIDO_SIMPLES });
    expect(r.verCusto).toBe(false);
  });

  it("falha ao conferir a permissão: mensagem genérica e nenhuma leitura", async () => {
    h.erroDePermissao = true;
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow(
      "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.",
    );
    expect(h.consultas).toHaveLength(0);
  });

  it("confere pelo cliente do PRÓPRIO usuário, com o id dele", () => {
    return cotar({ data: PEDIDO_SIMPLES }).then(() => {
      const perguntas = h.rpcDoUsuario.filter((c) => c.nome === "has_permission");
      expect(perguntas.length).toBeGreaterThan(0);
      for (const p of perguntas) expect(p.args._user_id).toBe("u1");
      expect(h.rpcComChaveDeServico).toEqual([]);
    });
  });
});

describe("quem NÃO vê custo recebe o preço e mais nada", () => {
  it("as chaves são exatamente as públicas, e nenhum número é taxa ou parcela", async () => {
    const r = await cotar({ data: PEDIDO_SIMPLES });
    expect(Object.keys(r).sort()).toEqual(
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
    expect(r.verCusto).toBe(false);

    const o = contaInlineDeHoje({
      f: camposDaTela({
        quantidade: 10,
        gramasModelo: 52,
        pesoSuporteG: 0,
        pesoPurgaG: 0,
        pecasPorPlaca: 4,
        custoHoraMaquina: TAXAS.custo_hora_calculado,
        potenciaW: TAXAS.potencia_media_w,
        tarifaKwh: TAXAS.tarifa_kwh_padrao,
        moCustoHora: TAXAS.mo_custo_hora_padrao,
        moHoras: 0,
        pctAcabamento: TAXAS.pct_acabamento_padrao,
        pctFalha: TAXAS.pct_falha_padrao,
        embalagemIncluida: false,
        embalagemValor: TAXAS.custo_admin_padrao,
        markup: TAXAS.markup_padrao,
      }),
      tempoMinutos: 190,
      custoPorGramaCalculado: TAXAS.custo_por_grama_calculado,
      embalagemIncluida: false,
      markupAtacadoPadrao: TAXAS.markup_atacado_padrao,
    });
    expect(r.preco).toBe(o.preco.toNumber());
    expect(r.unitario).toBe(o.unitario.toNumber());

    const { numeros, chaves } = varrer(r);
    // Só preço, unitário e contagens.
    expect(new Set(numeros)).toEqual(
      new Set([o.preco.toNumber(), o.unitario.toNumber(), 10, 3, 4]),
    );
    for (const proibido of [
      ...Object.values(TAXAS),
      o.material.toNumber(),
      o.maquina.toNumber(),
      o.energia.toNumber(),
      o.maoDeObra.toNumber(),
      o.acabamento.toNumber(),
      o.risco.toNumber(),
      o.indireto.toNumber(),
      o.operacional.toNumber(),
      o.lucro.toNumber(),
      o.margem.toNumber(),
      o.atacado.toNumber(),
      o.equilibrio.toNumber(),
    ]) {
      expect(numeros).not.toContain(proibido);
    }
    for (const c of chaves.filter((k) => k !== "verCusto")) {
      expect(c).not.toMatch(
        /custo|margem|lucro|markup|atacado|equilibrio|decomposicao|material|maquina|energia|tarifa|hora|grama|potencia|risco|acabamento/i,
      );
    }
    const texto = JSON.stringify(r);
    for (const t of ["7.7777", "0.1234", "33.33", "1.9876", "9.87", "123.4", "2.75", "99"]) {
      expect(texto).not.toContain(t);
    }
  });

  it("quem VÊ custo recebe a decomposição igual à da calculadora de hoje", async () => {
    h.permissoes = new Set(GESTOR);
    const e = corpus.sinteticos.find((s) => s.id.startsWith("s07"))!.entradas;
    bancoDoCaso(e);
    const r = await cotar({ data: pedidoDoCaso(e) });
    const o = oraculo(e);
    expect(r.verCusto).toBe(true);
    expect(r.decomposicao).toEqual({
      material: o.material.toNumber(),
      maquina: o.maquina.toNumber(),
      energia: o.energia.toNumber(),
      maoDeObra: o.maoDeObra.toNumber(),
      acabamento: o.acabamento.toNumber(),
      risco: o.risco.toNumber(),
      indireto: o.indireto.toNumber(),
      operacional: o.operacional.toNumber(),
      lucro: o.lucro.toNumber(),
      margem: o.margem.toNumber(),
      atacado: o.atacado.toNumber(),
      equilibrio: o.equilibrio.toNumber(),
      markup: o.markup,
      markupAtacado: o.markupAtacado,
    });
  });
});

describe("as taxas certas, lidas do jeito certo", () => {
  it("custo por hora é o CALCULADO; o manual (99) nem é pedido ao banco", async () => {
    const e = corpus.sinteticos[0].entradas;
    bancoDoCaso(e);
    const r = await cotar({ data: pedidoDoCaso(e) });
    expect(r.preco).toBe(oraculo(e).preco.toNumber());
    const daImpressora = h.consultas.find((q) => q.tabela === "maquinas_3d_config")!;
    expect(daImpressora.colunas).toContain("custo_hora_calculado");
    expect(daImpressora.colunas).not.toContain("custo_hora_manual");
    expect(daImpressora.filtros).toEqual({ maquina_id: MAQUINA, ativa: true });
    expect(h.consultas.find((q) => q.tabela === "config_precificacao_3d")!.filtros).toEqual({
      id: true,
    });
    expect(h.consultas.find((q) => q.tabela === "materiais_3d_filamento")!.filtros).toEqual({
      material_id: FILAMENTO,
    });
  });

  it("com o manual valendo 99 e o calculado 0,5995, o preço é o do calculado", async () => {
    const e = corpus.sinteticos.find((s) => s.id.startsWith("s06"))!.entradas;
    bancoDoCaso(e);
    const comManual = await cotar({ data: pedidoDoCaso(e) });
    expect(comManual.preco).toBe(17.63);
  });
});

describe("falha nunca vira preço de fábrica", () => {
  const SEM_DIGITO = /^[^0-9]*$/;

  it("impressora desativada ou que não existe", async () => {
    await expect(
      cotar({ data: { ...PEDIDO_SIMPLES, maquinaId: MAQUINA_DESLIGADA } }),
    ).rejects.toThrow("Impressora não encontrada ou desativada. Escolha outra.");
    await expect(
      cotar({ data: { ...PEDIDO_SIMPLES, maquinaId: "00000000-0000-4000-8000-000000000000" } }),
    ).rejects.toThrow("Impressora não encontrada ou desativada. Escolha outra.");
  });

  it("filamento que não existe", async () => {
    await expect(
      cotar({ data: { ...PEDIDO_SIMPLES, materialId: "00000000-0000-4000-8000-000000000000" } }),
    ).rejects.toThrow("Filamento não encontrado. Escolha outro.");
  });

  it("base de preço ausente (a linha que a política esconde chega como nula)", async () => {
    h.base = null;
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow(
      "A base de preço 3D não está cadastrada. Avise a gerência.",
    );
  });

  it.each([
    "tarifa_kwh_padrao",
    "mo_custo_hora_padrao",
    "markup_padrao",
    "pct_acabamento_padrao",
    "pct_falha_padrao",
  ])("base de preço sem %s: erro, não 0,95 nem 40 nem 2 nem 5", async (coluna) => {
    h.base = { ...h.base!, [coluna]: null };
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow(
      "A base de preço 3D está incompleta. Avise a gerência.",
    );
  });

  it("embalagem pedida sem valor na base: erro; sem pedir embalagem, a falta não importa", async () => {
    h.base = { ...h.base!, custo_admin_padrao: null };
    h.permissoes = new Set(GESTOR);
    await expect(cotar({ data: { ...PEDIDO_SIMPLES, embalagemIncluida: true } })).rejects.toThrow(
      "A base de preço 3D está incompleta. Avise a gerência.",
    );
    await expect(cotar({ data: PEDIDO_SIMPLES })).resolves.toMatchObject({ verCusto: true });
  });

  it("taxa que não é número no cadastro: erro", async () => {
    h.filamentos[0].custo_por_grama_calculado = "abc";
    await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow(
      "O cadastro da impressora ou do filamento está incompleto. Avise a gerência.",
    );
  });

  it.each(["config_precificacao_3d", "maquinas_3d_config", "materiais_3d_filamento"])(
    "consulta de %s que falha: mensagem genérica, e o registro não leva taxa",
    async (tabela) => {
      h.erroNaTabela = tabela;
      await expect(cotar({ data: PEDIDO_SIMPLES })).rejects.toThrow(
        "Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.",
      );
      const registrado = JSON.stringify(erroDoConsole.mock.calls);
      expect(registrado).toContain(tabela);
      for (const t of ["7.7777", "0.1234", "33.33", "1.9876"]) expect(registrado).not.toContain(t);
    },
  );

  it("nenhuma mensagem de erro de cadastro traz número", async () => {
    const mensagens: string[] = [];
    const tentar = async (preparar: () => void) => {
      bancoDistintivo();
      preparar();
      await cotar({ data: PEDIDO_SIMPLES }).catch((e: Error) => mensagens.push(e.message));
    };
    await tentar(() => (h.base = null));
    await tentar(() => (h.base = { ...h.base!, markup_padrao: null }));
    await tentar(() => (h.impressoras = []));
    await tentar(() => (h.filamentos = []));
    await tentar(() => (h.impressoras[0].potencia_media_w = "x"));
    await tentar(() => (h.erroNaTabela = "maquinas_3d_config"));
    expect(mensagens).toHaveLength(6);
    // "3D" é nome do módulo, não número de custo.
    for (const m of mensagens) expect(m.replace(/3D/g, "")).toMatch(SEM_DIGITO);
  });
});

describe("cadastro zerado: preço sai, e o aviso também (como a calculadora de hoje)", () => {
  it("s10: impressora sem custo por hora", async () => {
    const e = corpus.sinteticos.find((s) => s.id.startsWith("s10"))!.entradas;
    bancoDoCaso(e);
    const r = await cotar({ data: pedidoDoCaso(e) });
    expect(r.preco).toBe(6.81);
    expect(r.avisos).toEqual(["impressora_sem_custo_hora"]);
  });

  it("custo por hora NULO no cadastro vale zero e avisa (a tela de hoje faz `?? 0`)", async () => {
    const e = corpus.sinteticos.find((s) => s.id.startsWith("s10"))!.entradas;
    bancoDoCaso(e);
    h.impressoras[0].custo_hora_calculado = null;
    const r = await cotar({ data: pedidoDoCaso(e) });
    expect(r.preco).toBe(oraculo(e).preco.toNumber());
    expect(r.avisos).toEqual(["impressora_sem_custo_hora"]);
  });

  it("potência e filamento zerados também avisam", async () => {
    h.impressoras[0].potencia_media_w = 0;
    h.filamentos[0].custo_por_grama_calculado = null;
    const r = await cotar({ data: PEDIDO_SIMPLES });
    expect(r.avisos).toEqual(["impressora_sem_potencia", "filamento_sem_custo"]);
  });
});

describe("paridade ponta a ponta: o servidor cota o mesmo preço que a calculadora de hoje", () => {
  const cotaveis = CASOS.filter((c) => c.entradas.tempoMinutos >= 1);

  it("só o cálculo real n=1 (de 03/08, sem tempo) fica de fora: o servidor recusa tempo zero", async () => {
    expect(CASOS.filter((c) => c.entradas.tempoMinutos < 1).map((c) => c.nome)).toEqual([
      "real n=1",
    ]);
    const e = corpus.registros[0].entradas;
    bancoDoCaso(e);
    await expect(cotar({ data: pedidoDoCaso(e) })).rejects.toThrow("tempo de impressão");
  });

  it.each(cotaveis.map((c) => [c.nome, c.entradas] as const))(
    "%s: vendedor e gestor, ao centavo",
    async (_nome, e) => {
      bancoDoCaso(e);
      const o = oraculo(e);
      h.permissoes = new Set(VENDEDOR);
      // A tela do vendedor nunca manda horas de acabamento nem embalagem; o servidor recusa (ver o bloco abaixo).
      const vendedorMandaSoOPadrao = e.moHoras === 0 && !e.embalagemIncluida;
      const eDoVendedor = vendedorMandaSoOPadrao
        ? e
        : { ...e, moHoras: 0, embalagemIncluida: false };
      const oV = oraculo(eDoVendedor);
      const doVendedor = await cotar({ data: pedidoDoCaso(eDoVendedor) });
      expect(doVendedor).toEqual({
        verCusto: false,
        preco: oV.preco.toNumber(),
        unitario: oV.unitario.toNumber(),
        quantidade: oV.qtd,
        placas: oV.placas,
        pecasPorPlaca: oV.pecasPlaca,
        peloMinimo: oV.peloMinimo,
        avisos: doVendedor.avisos,
      });
      h.permissoes = new Set(GESTOR);
      const doGestor = await cotar({ data: pedidoDoCaso(e) });
      expect(doGestor.preco).toBe(o.preco.toNumber());
      expect((doGestor.decomposicao as Record<string, number>).operacional).toBe(
        o.operacional.toNumber(),
      );
      expect((doGestor.decomposicao as Record<string, number>).lucro).toBe(o.lucro.toNumber());
    },
  );
});

/** A assinatura de `salvar_item_3d_no_orcamento` lida no banco em 11/11/2026 (hash f18de0a9...). */
const PARAMETROS_DA_RPC = [
  "p_orcamento_id",
  "p_orcamento_3d_id",
  "p_titulo",
  "p_quantidade",
  "p_maquina_id",
  "p_material_id",
  "p_gramas",
  "p_tempo_segundos",
  "p_custo_por_grama",
  "p_inputs",
  "p_resultados",
  "p_custo_material",
  "p_custo_maquina",
  "p_custo_energia",
  "p_custo_mao_obra",
  "p_custo_acabamento",
  "p_custo_risco",
  "p_custo_indireto",
  "p_custo_operacional",
  "p_preco",
  "p_markup",
  "p_margem",
  "p_lucro",
  "p_foto_arquivo_id",
  "p_material_descricao",
];

function pedidoDeSalvar(e: Entradas, extra: Record<string, unknown> = {}) {
  return {
    ...pedidoDoCaso(e),
    orcamentoId: ORCAMENTO,
    orcamento3dId: null,
    titulo: "  Suporte de celular  ",
    filamentoTipoDetectado: "PLA",
    alturaCamadaMm: 0.2,
    infillPct: 15,
    slicerScreenshot: "orcamentos-3d/1762900000000_slicer_suporte.3mf",
    fotoArquivoId: FOTO,
    clienteId: CLIENTE,
    ...extra,
  };
}

describe("salvar: recalcula no servidor e grava pelo cliente do próprio usuário", () => {
  const ESCOLHIDOS = [
    "real n=22",
    "real n=24",
    "s03-quantidade-maior-que-a-placa",
    "s05-suporte-e-purga",
    "s08-embalagem-ligada",
  ];
  /** Todo o corpus usa markup 2 e acabamento e falha de 5%: este caso tira os valores "redondos" do caminho. */
  const DISTINTIVO: Entradas = {
    quantidade: 10,
    gramasModelo: 52,
    pesoSuporteG: 3.5,
    pesoPurgaG: 1.25,
    pecasPorPlaca: 4,
    tempoMinutos: 190,
    custoPorGrama: TAXAS.custo_por_grama_calculado,
    custoHoraMaquina: TAXAS.custo_hora_calculado,
    potenciaW: TAXAS.potencia_media_w,
    tarifaKwh: TAXAS.tarifa_kwh_padrao,
    moCustoHora: TAXAS.mo_custo_hora_padrao,
    moHoras: 0.5,
    pctAcabamento: TAXAS.pct_acabamento_padrao,
    pctFalha: TAXAS.pct_falha_padrao,
    embalagemIncluida: true,
    embalagemValor: TAXAS.custo_admin_padrao,
    markup: TAXAS.markup_padrao,
  };

  it.each([
    ...CASOS.filter((c) => ESCOLHIDOS.includes(c.nome)).map((c) => [c.nome, c.entradas] as const),
    ["taxas inconfundíveis (markup 3,5)", DISTINTIVO] as const,
  ])("%s: os 25 parâmetros são os que a calculadora de hoje mandaria", async (_nome, e) => {
    bancoDoCaso(e);
    h.permissoes = new Set(GESTOR); // os casos trazem horas de acabamento e embalagem: só quem vê custo manda
    const r = await salvar({ data: pedidoDeSalvar(e) });

    const chamadas = h.rpcDoUsuario.filter((c) => c.nome === "salvar_item_3d_no_orcamento");
    expect(chamadas).toHaveLength(1);
    expect(h.rpcComChaveDeServico).toEqual([]);
    const args = chamadas[0].args;
    expect(Object.keys(args).sort()).toEqual([...PARAMETROS_DA_RPC].sort());

    const fil = h.filamentos[0];
    const hoje = gravacaoDeHoje({
      f: {
        ...camposDaTela(e),
        cliente_id: "",
        titulo: "  Suporte de celular  ",
        maquina_id: MAQUINA,
        material_id: FILAMENTO,
        filamento_tipo_detectado: "PLA",
        altura_camada: "0.2",
        infill_pct: "15",
      },
      calc: oraculo(e),
      tempoHoras: e.tempoMinutos / 60,
      embalagemIncluida: e.embalagemIncluida,
      clienteId: CLIENTE,
      slicerPath: "orcamentos-3d/1762900000000_slicer_suporte.3mf",
      slicerAtualPath: null,
      impressora: { maquinas: { nome: "Bambu Lab 3D 01" } },
      filamento: { materiais: { nome: "PLA Lite Ciano (Bambu Lab)" } },
      orcId: ORCAMENTO,
      orcamento3dId: null,
      fotoArquivoId: FOTO,
      materialDescricao: descreverFilamento({ tipo: fil.tipo as string, cor: fil.cor as string }),
    });
    expect(args).toEqual(hoje.parametros);

    expect(Object.keys(r).sort()).toEqual([
      "itemId",
      "orcamento3dId",
      "orcamentoId",
      "valorTotal",
      "valorUnitario",
    ]);
    expect(r.valorTotal).toBe(oraculo(e).preco.toNumber());
  });

  it("o navegador não manda preço nem custo por aqui", async () => {
    const e = corpus.sinteticos[2].entradas;
    for (const chave of ["p_preco", "preco", "custoPorGrama", "markup", "resultados"]) {
      await expect(salvar({ data: pedidoDeSalvar(e, { [chave]: 1 }) })).rejects.toThrow(
        "campo não aceito",
      );
    }
    expect(h.rpcDoUsuario.filter((c) => c.nome === "salvar_item_3d_no_orcamento")).toHaveLength(0);
  });

  it("sem permissão: nada é lido nem gravado", async () => {
    h.permissoes = new Set();
    await expect(salvar({ data: pedidoDeSalvar(corpus.sinteticos[2].entradas) })).rejects.toThrow(
      "Seu perfil não cota peças 3D.",
    );
    expect(h.consultas).toHaveLength(0);
    expect(h.rpcDoUsuario.filter((c) => c.nome === "salvar_item_3d_no_orcamento")).toHaveLength(0);
  });

  it("preço visto diferente do recalculado: nada é gravado", async () => {
    const e = corpus.sinteticos[2].entradas;
    bancoDoCaso(e);
    h.permissoes = new Set(GESTOR);
    const certo = oraculo(e).preco.toNumber();
    await expect(salvar({ data: pedidoDeSalvar(e, { precoVisto: certo - 0.01 }) })).rejects.toThrow(
      "O preço mudou desde a última conta. Confira o novo valor e salve de novo.",
    );
    expect(h.rpcDoUsuario.filter((c) => c.nome === "salvar_item_3d_no_orcamento")).toHaveLength(0);
    await expect(salvar({ data: pedidoDeSalvar(e, { precoVisto: certo }) })).resolves.toMatchObject(
      {
        valorTotal: certo,
      },
    );
  });

  it("a mensagem da RPC passa adiante sem mudança", async () => {
    h.permissoes = new Set(GESTOR);
    h.respostaDoSalvar = {
      data: null,
      error: { message: "Este orçamento já virou OS: os itens ficam como foram vendidos." },
    };
    await expect(salvar({ data: pedidoDeSalvar(corpus.sinteticos[2].entradas) })).rejects.toThrow(
      "Este orçamento já virou OS: os itens ficam como foram vendidos.",
    );
  });

  it("resposta sem os ids: erro, nunca sucesso vazio", async () => {
    h.permissoes = new Set(GESTOR);
    h.respostaDoSalvar = { data: {}, error: null };
    await expect(salvar({ data: pedidoDeSalvar(corpus.sinteticos[2].entradas) })).rejects.toThrow(
      "O banco não confirmou a gravação da peça.",
    );
  });

  it("título só com espaço é recusado antes de qualquer leitura", async () => {
    await expect(
      salvar({ data: pedidoDeSalvar(corpus.sinteticos[2].entradas, { titulo: "   " }) }),
    ).rejects.toThrow("Confira os dados da peça (título)");
    expect(h.consultas).toHaveLength(0);
  });

  it("caminho do fatiador fora do padrão do Storage é recusado", async () => {
    await expect(
      salvar({
        data: pedidoDeSalvar(corpus.sinteticos[2].entradas, { slicerScreenshot: "../outro/x.3mf" }),
      }),
    ).rejects.toThrow("Confira os dados da peça (arquivo do fatiador): valor inválido.");
  });
});

describe("o texto do servidor", () => {
  const fonte = readFileSync("src/lib/api/orcamento-3d.functions.ts", "utf8");

  it("só carrega a chave de serviço dentro da função, depois da permissão", () => {
    expect(fonte).not.toMatch(/^import[^\n]*client\.server/m);
    expect(fonte).toContain('await import("@/integrations/supabase/client.server")');
  });

  it("grava pela RPC com o cliente do usuário, nunca com a chave de serviço", () => {
    expect(fonte).toContain('usuario.rpc("salvar_item_3d_no_orcamento", {');
    expect(fonte).not.toMatch(/supabaseAdmin[^;]*\.rpc\(/);
  });
});
