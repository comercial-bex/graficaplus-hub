import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O preço do troféu de acrílico no SERVIDOR (22/11/2026), no molde de `tests/cotacao-3d-no-servidor.test.ts`.
 *
 * O vendedor manda modelo, altura, quantidade, urgência e arte; o servidor lê as taxas com a chave de serviço, faz a
 * MESMA conta da função pura e devolve só o preço. Estes testes travam: (1) a entrada estrita (o navegador não manda
 * preço, custo, multiplicador nem taxa); (2) a resposta de quem não vê custo sem nenhum número de custo; (3) a
 * permissão conferida antes de qualquer leitura com a chave de serviço; (4) falha vira erro em português, nunca preço
 * de fábrica; (5) o cliente do USUÁRIO só pergunta permissão: nunca lê tabela de custo.
 */

type Linha = Record<string, unknown>;
type Consulta = { tabela: string; colunas: string; filtros: Record<string, unknown>; em: Record<string, unknown[]> };

const h = vi.hoisted(() => ({
  permissoes: new Set<string>(),
  erroDePermissao: false,
  tabelas: {} as Record<string, Linha | Linha[] | null>,
  erroNaTabela: null as string | null,
  consultas: [] as { tabela: string; colunas: string; filtros: Record<string, unknown>; em: Record<string, unknown[]> }[],
  rpcDoUsuario: [] as string[],
  leiturasDoUsuario: [] as string[],
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@tanstack/react-start", () => {
  type Validador = (d: unknown) => unknown;
  type Manipulador = (a: { data: unknown; context: unknown }) => Promise<unknown>;
  return {
    createServerFn: () => {
      let validar: Validador = (d) => d;
      const cadeia = {
        middleware: () => cadeia,
        inputValidator: (v: Validador) => {
          validar = v;
          return cadeia;
        },
        handler: (fn: Manipulador) => async (entrada: { data: unknown }) => fn({ data: validar(entrada.data), context: contexto() }),
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
          h.rpcDoUsuario.push(`${nome}:${String(args._permission ?? "")}`);
          if (nome === "has_permission") {
            if (h.erroDePermissao) return { data: null, error: { message: "timeout" } };
            return { data: h.permissoes.has(String(args._permission)), error: null };
          }
          return { data: null, error: { message: `rpc inesperada: ${nome}` } };
        },
        from: (tabela: string) => {
          h.leiturasDoUsuario.push(tabela);
          throw new Error("o cliente do usuário não pode ler tabela de custo");
        },
      },
    };
  }
});

vi.mock("@/integrations/supabase/client.server", () => {
  function responder(q: Consulta, unico: boolean) {
    if (h.erroNaTabela === q.tabela) return { data: null, error: { message: `permission denied for table ${q.tabela}` } };
    const fonte = h.tabelas[q.tabela] ?? null;
    if (unico) return { data: Array.isArray(fonte) ? (fonte[0] ?? null) : fonte, error: null };
    let linhas = Array.isArray(fonte) ? fonte : fonte ? [fonte] : [];
    linhas = linhas.filter((l) => Object.entries(q.filtros).every(([k, v]) => !(k in l) || l[k] === v));
    for (const [k, valores] of Object.entries(q.em)) linhas = linhas.filter((l) => !(k in l) || valores.includes(l[k]));
    return { data: linhas, error: null };
  }
  return {
    supabaseAdmin: {
      from: (tabela: string) => {
        const q: Consulta = { tabela, colunas: "*", filtros: {}, em: {} };
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
          in: (k: string, v: unknown[]) => {
            q.em[k] = v;
            return b;
          },
          order: () => b,
          maybeSingle: async () => responder(q, true),
          then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(responder(q, false)).then(ok, ko),
        };
        return b;
      },
    },
  };
});

import { cotarTrofeu } from "../src/lib/api/trofeus.functions";
import { ECONOMICO, PADRAO, PREMIUM, baseDoBanco } from "./apoio/trofeus-banco";
import type { ModeloDeTrofeu } from "../src/domain/trofeus/conta";

const cotar = cotarTrofeu as unknown as (a: { data: unknown }) => Promise<Record<string, unknown>>;

const MODELO = "3f8e1c2a-7b4d-4e6f-9a1b-2c3d4e5f6a7b";
const PEDIDO = { modeloId: MODELO, alturaCm: 18, quantidade: 1 };

const VENDEDOR = ["orcamentos.create", "orcamentos.update"];
const FINANCEIRO = [...VENDEDOR, "financeiro.read"];

function carregarBanco(modelo: ModeloDeTrofeu = ECONOMICO, mexer?: (t: Record<string, Linha | Linha[] | null>) => void) {
  const b = baseDoBanco(modelo);
  const tabelas: Record<string, Linha | Linha[] | null> = {
    trofeu_regras: { unica: true, ...(b.regras as unknown as Linha) },
    trofeu_modelos: { ...(b.modelo as unknown as Linha), id: MODELO },
    trofeu_pecas: b.pecas.map((p) => ({ ...(p as unknown as Linha), modelo_id: MODELO })),
    materiais: b.materiais as unknown as Linha[],
    custos_tabela: b.custos.map((c) => ({ ...c, ativo: true })),
    custos_mao_de_obra: b.maoDeObra.map((m) => ({ ...(m as unknown as Linha), ativo: true })),
    maquinas: b.maquinas.map((m) => ({ ...(m as unknown as Linha), ativa: true })),
  };
  mexer?.(tabelas);
  h.tabelas = tabelas;
}

beforeEach(() => {
  h.permissoes = new Set(VENDEDOR);
  h.erroDePermissao = false;
  h.erroNaTabela = null;
  h.consultas = [];
  h.rpcDoUsuario = [];
  h.leiturasDoUsuario = [];
  carregarBanco();
});
afterEach(() => vi.restoreAllMocks());

describe("a entrada é estrita: o navegador só manda o que o vendedor escolhe", () => {
  it("recusa preço, custo, multiplicador, margem e taxa vindos do navegador", async () => {
    for (const campo of ["preco", "precoUnitario", "custo", "multiplicador", "margem", "markup", "laserHora", "custoM2", "taxas"]) {
      await expect(cotar({ data: { ...PEDIDO, [campo]: 1 } }), campo).rejects.toThrow(`campo não aceito (${campo})`);
    }
    expect(h.consultas).toHaveLength(0);
  });

  it("recusa campo estranho dentro da arte", async () => {
    await expect(cotar({ data: { ...PEDIDO, arte: { tipo: "criacao_exclusiva", valor: 1 } } })).rejects.toThrow("campo não aceito (valor)");
  });

  it("diz em português o que está errado (nunca o JSON do zod)", async () => {
    await expect(cotar({ data: { ...PEDIDO, alturaCm: 0 } })).rejects.toThrow("Confira os dados do troféu (altura): deve ser pelo menos 1.");
    await expect(cotar({ data: { ...PEDIDO, quantidade: 2.5 } })).rejects.toThrow("Confira os dados do troféu (quantidade): precisa ser um número inteiro.");
    await expect(cotar({ data: { ...PEDIDO, quantidade: 0 } })).rejects.toThrow("deve ser pelo menos 1");
    await expect(cotar({ data: { ...PEDIDO, modeloId: "premium" } })).rejects.toThrow("Confira os dados do troféu (modelo)");
    await expect(cotar({ data: { ...PEDIDO, alturaCm: undefined } })).rejects.toThrow("(altura): falta preencher");
    await expect(cotar({ data: { ...PEDIDO, arte: { tipo: "pintura" } } })).rejects.toThrow("(tipo da arte): opção desconhecida");
    await expect(cotar({ data: { ...PEDIDO, urgente: "sim" } })).rejects.toThrow("(urgência): precisa ser sim ou não");
  });

  it("altura e quantidade têm teto, para ninguém cotar um troféu de 200 m", async () => {
    await expect(cotar({ data: { ...PEDIDO, alturaCm: 500 } })).rejects.toThrow("deve ser no máximo 200");
    await expect(cotar({ data: { ...PEDIDO, quantidade: 1000000 } })).rejects.toThrow("deve ser no máximo");
  });
});

describe("a permissão vem antes de qualquer leitura com a chave de serviço", () => {
  it("sem permissão de cotar: nega e não lê nada", async () => {
    h.permissoes = new Set();
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Seu perfil não cota troféus.");
    expect(h.consultas).toHaveLength(0);
  });

  it("só financeiro.read, sem permissão de cotar, também nega", async () => {
    h.permissoes = new Set(["financeiro.read"]);
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Seu perfil não cota troféus.");
    expect(h.consultas).toHaveLength(0);
  });

  it("a pergunta de permissão falhou: erro genérico, nada lido", async () => {
    h.erroDePermissao = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Não consegui calcular o preço agora.");
    expect(h.consultas).toHaveLength(0);
  });

  it("qualquer uma das duas permissões de orçamento basta para cotar", async () => {
    for (const p of VENDEDOR) {
      h.permissoes = new Set([p]);
      const r = await cotar({ data: PEDIDO });
      expect(r.precoUnitario).toBe(53.9);
    }
  });

  it("o cliente do usuário só pergunta permissão: nunca lê tabela", async () => {
    await cotar({ data: PEDIDO });
    expect(h.leiturasDoUsuario).toEqual([]);
    expect(h.rpcDoUsuario.every((r) => r.startsWith("has_permission:"))).toBe(true);
    const fonte = readFileSync("src/lib/api/trofeus.functions.ts", "utf8");
    expect(fonte).not.toMatch(/context\.supabase\s*\.from\(/);
    expect(fonte).toContain("await import(\"@/integrations/supabase/client.server\")");
  });
});

describe("o vendedor recebe só o preço", () => {
  it("1 troféu econômico: R$ 53,90, sem custo, multiplicador nem margem", async () => {
    const r = await cotar({ data: PEDIDO });
    expect(Object.keys(r).sort()).toEqual(["alturaCm", "arte", "avisos", "modelo", "precoTotal", "precoUnitario", "quantidade", "totalGeral", "urgente"]);
    expect(r.precoUnitario).toBe(53.9);
    expect(r.precoTotal).toBe(53.9);
    expect(r.totalGeral).toBe(53.9);
    expect(r.modelo).toEqual({ id: MODELO, nome: "Troféu econômico" });
  });

  it("a resposta não contém nenhuma taxa do cadastro (os números de custo não aparecem em lugar nenhum)", async () => {
    const r = await cotar({ data: { ...PEDIDO, quantidade: 5, arte: { tipo: "criacao_exclusiva" } } });
    const texto = JSON.stringify(r);
    for (const proibido of ["custoCheio", "custoDeProducao", "multiplicador", "margem", "faixaDe", "laserHora", "194.5", "158", "12.94", "12.2327", "9.2102", "1.1339"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("5 troféus saem mais baratos cada um (a escada de quantidade), e o total é a soma", async () => {
    const um = await cotar({ data: PEDIDO });
    const cinco = await cotar({ data: { ...PEDIDO, quantidade: 5 } });
    expect(cinco.precoUnitario as number).toBeLessThan(um.precoUnitario as number);
    expect(cinco.precoUnitario).toBe(45.9);
    expect(cinco.precoTotal).toBeCloseTo(45.9 * 5, 2);
  });

  it("altura em centímetros escala o preço", async () => {
    const base = await cotar({ data: PEDIDO });
    const maior = await cotar({ data: { ...PEDIDO, alturaCm: 25 } });
    expect(maior.precoUnitario as number).toBeGreaterThan(base.precoUnitario as number);
  });

  it("urgência sobe o multiplicador para ×4 e o preço junto", async () => {
    const normal = await cotar({ data: PEDIDO });
    const urgente = await cotar({ data: { ...PEDIDO, urgente: true } });
    expect(urgente.precoUnitario as number).toBeGreaterThan(normal.precoUnitario as number);
    expect(urgente.urgente).toBe(true);
  });

  it("a arte entra como linha à parte e soma no total geral", async () => {
    const r = await cotar({ data: { ...PEDIDO, arte: { tipo: "criacao_exclusiva", alteracoesExtras: 1, nomesIndividuais: 0 } } });
    const arte = r.arte as { linhas: { descricao: string; valor: number }[]; total: number };
    expect(arte.linhas.map((l) => l.valor)).toEqual([220, 30]);
    expect(arte.total).toBe(250);
    expect(r.totalGeral).toBe(53.9 + 250);
  });

  it("padrão e premium cotam também", async () => {
    carregarBanco(PADRAO);
    expect((await cotar({ data: { ...PEDIDO, alturaCm: 18 } })).precoUnitario).toBe(85.9);
    carregarBanco(PREMIUM);
    expect((await cotar({ data: { ...PEDIDO, alturaCm: 28 } })).precoUnitario).toBe(201.9);
  });

  it("traz os avisos do que ainda é estimativa", async () => {
    const r = await cotar({ data: PEDIDO });
    expect((r.avisos as string[]).length).toBeGreaterThan(0);
  });
});

describe("quem tem financeiro.read recebe também a decomposição", () => {
  it("custo cheio, multiplicador, margem e as parcelas", async () => {
    h.permissoes = new Set(FINANCEIRO);
    carregarBanco(PREMIUM);
    const r = await cotar({ data: { ...PEDIDO, alturaCm: 28 } });
    expect(r.precoUnitario).toBe(201.9);
    expect(r.custoCheio).toBe(67.25);
    expect(r.multiplicador).toBe(3);
    expect(r.faixaDe).toBe(1);
    expect(r.margemLiquidaPct as number).toBeGreaterThan(40);
    expect(Object.keys(r.custo as object).sort()).toEqual(["cola", "decoracao", "indireto", "maoDeObra", "maquina", "material"]);
  });
});

describe("falha vira erro em português, nunca preço com número de fábrica", () => {
  it("modelo que não existe ou está desativado", async () => {
    carregarBanco(ECONOMICO, (t) => (t.trofeu_modelos = null));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Modelo de troféu não encontrado ou desativado. Escolha outro.");
    carregarBanco(ECONOMICO, (t) => (t.trofeu_modelos = { ...(t.trofeu_modelos as Linha), ativo: false }));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Modelo de troféu não encontrado ou desativado");
  });

  it("modelo sem peças e regras que não existem", async () => {
    carregarBanco(ECONOMICO, (t) => (t.trofeu_pecas = []));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("O modelo escolhido não tem peças cadastradas. Avise a gerência.");
    carregarBanco(ECONOMICO, (t) => (t.trofeu_regras = null));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("As regras de preço do troféu não estão cadastradas. Avise a gerência.");
  });

  it("cadastro incompleto: a frase do cadastro passa adiante, sem preço", async () => {
    carregarBanco(ECONOMICO, (t) => (t.custos_mao_de_obra = []));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Não há custo de mão de obra cadastrado. Avise a gerência.");
    carregarBanco(ECONOMICO, (t) => (t.custos_tabela = (t.custos_tabela as Linha[]).filter((c) => c.codigo !== "energia_tarifa_kwh")));
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Falta a tarifa de energia (kWh) nos custos fixos. Avise a gerência.");
  });

  it("altura fora do limite: a frase da conta", async () => {
    await expect(cotar({ data: { ...PEDIDO, alturaCm: 8 } })).rejects.toThrow("A altura vai de 12 a 40 cm.");
  });

  it("consulta que falha vira erro genérico, e só o nome da tabela vai para o registro (nenhuma taxa)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.erroNaTabela = "custos_tabela";
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Não consegui calcular o preço agora. Tente de novo; se continuar, avise a gerência.");
    const escrito = JSON.stringify(log.mock.calls);
    expect(escrito).toContain("custos_tabela");
    for (const taxa of ["12.5", "1.1339", "194.5", "9.2102"]) expect(escrito, taxa).not.toContain(taxa);
  });

  it("a falha da leitura dos materiais também é genérica", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.erroNaTabela = "materiais";
    await expect(cotar({ data: PEDIDO })).rejects.toThrow("Não consegui calcular o preço agora.");
  });
});

describe("o que o servidor lê, e só isso", () => {
  it("lê as regras, o modelo e as peças do modelo pedido, pelas tabelas certas", async () => {
    await cotar({ data: PEDIDO });
    const tabelas = h.consultas.map((c) => c.tabela).sort();
    expect(tabelas).toEqual(["custos_mao_de_obra", "custos_tabela", "maquinas", "materiais", "trofeu_modelos", "trofeu_pecas", "trofeu_regras"]);
    expect(h.consultas.find((c) => c.tabela === "trofeu_modelos")!.filtros).toEqual({ id: MODELO });
    expect(h.consultas.find((c) => c.tabela === "trofeu_pecas")!.filtros).toEqual({ modelo_id: MODELO });
  });

  it("só lê máquina ativa, e só laser CO2 e plotter de impressão", async () => {
    await cotar({ data: PEDIDO });
    const q = h.consultas.find((c) => c.tabela === "maquinas")!;
    expect(q.filtros).toEqual({ ativa: true });
    expect(q.em.tipo).toEqual(["laser_co2", "plotter_impressao"]);
  });

  it("só lê custo fixo e mão de obra ativos", async () => {
    await cotar({ data: PEDIDO });
    expect(h.consultas.find((c) => c.tabela === "custos_tabela")!.filtros).toEqual({ ativo: true });
    expect(h.consultas.find((c) => c.tabela === "custos_mao_de_obra")!.filtros).toEqual({ ativo: true });
  });

  it("pede os materiais das peças e os quatro da decoração e da cola, uma vez cada", async () => {
    await cotar({ data: PEDIDO });
    const ids = h.consultas.find((c) => c.tabela === "materiais")!.em.id as string[];
    expect(new Set(ids).size).toBe(ids.length);
    for (const peca of ECONOMICO.pecas) expect(ids).toContain(peca.materialId);
    for (const id of ["mat-vinil-branco-brilho", "mat-laminacao-polimerica", "mat-tinta-solvente", "mat-cola-acrilico-250ml"]) expect(ids).toContain(id);
  });

  it("não lê a tabela de custo da máquina por nenhum outro caminho (nada de custo manual, nada de chave de serviço em RPC)", async () => {
    const fonte = readFileSync("src/lib/api/trofeus.functions.ts", "utf8");
    expect(fonte).not.toMatch(/custo_hora_manual/);
    expect(fonte).not.toMatch(/supabaseAdmin\.rpc/);
  });
});
