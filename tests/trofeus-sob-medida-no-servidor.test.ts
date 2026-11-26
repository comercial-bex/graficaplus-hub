import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cotar as peças de uma ficha NO SERVIDOR, sem modelo cadastrado (26/11/2026), no molde de
 * `tests/trofeus-no-servidor.test.ts`. Estes testes travam: (1) a entrada estrita (preço, custo, taxa, multiplicador e
 * arte vindos do navegador são recusados); (2) a permissão conferida ANTES de qualquer leitura com a chave de serviço;
 * (3) a resposta de quem não vê custo sem nenhum número de custo; (4) o material tem de existir como chapa e ter a
 * MESMA espessura da peça; (5) cadastro que falta é erro em português, nunca preço de fábrica; (6) o estoque só AVISA;
 * (7) a EQUIVALÊNCIA: as peças do modelo Padrão dão, de ponta a ponta, o preço do `cotarTrofeu` do mesmo modelo.
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
        handler: (fn: Manipulador) => async (entrada?: { data: unknown }) => fn({ data: validar(entrada?.data), context: contexto() }),
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
          h.rpcDoUsuario.push(`${nome}:${String(args._permission ?? args._role ?? "")}`);
          if (nome === "has_permission") {
            if (h.erroDePermissao) return { data: null, error: { message: "timeout" } };
            return { data: h.permissoes.has(String(args._permission)), error: null };
          }
          if (nome === "has_role") return { data: false, error: null };
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

import { cotarFichaSobMedida, cotarTrofeu } from "../src/lib/api/trofeus.functions";
import { ECONOMICO, PADRAO, baseDoBanco } from "./apoio/trofeus-banco";
import { MATERIAL } from "./apoio/trofeus";

const cotarFicha = cotarFichaSobMedida as unknown as (a: { data: unknown }) => Promise<Record<string, unknown>>;
const cotarModelo = cotarTrofeu as unknown as (a: { data: unknown }) => Promise<Record<string, unknown>>;

const MODELO = "3f8e1c2a-7b4d-4e6f-9a1b-2c3d4e5f6a7b";
const U = {
  cristal2: "00000000-0000-4000-8000-000000000001",
  cristal3: "00000000-0000-4000-8000-000000000002",
  cristal6: "00000000-0000-4000-8000-000000000003",
  preto3: "00000000-0000-4000-8000-000000000004",
  dourado2: "00000000-0000-4000-8000-000000000005",
  branco2: "00000000-0000-4000-8000-000000000006",
  cristal10: "00000000-0000-4000-8000-000000000007",
  cristal12: "00000000-0000-4000-8000-000000000008",
  cristal10SemCusto: "00000000-0000-4000-8000-000000000009",
  inexistente: "00000000-0000-4000-8000-0000000000ff",
} as const;
const PARA_UUID: Record<string, string> = {
  [MATERIAL.cristal2]: U.cristal2,
  [MATERIAL.cristal3]: U.cristal3,
  [MATERIAL.cristal6]: U.cristal6,
  [MATERIAL.preto3]: U.preto3,
  [MATERIAL.dourado2]: U.dourado2,
};
const ESPESSURA: Record<string, number> = { [U.cristal2]: 2, [U.cristal3]: 3, [U.cristal6]: 6, [U.preto3]: 3, [U.dourado2]: 2 };

const VENDEDOR = ["orcamentos.create", "orcamentos.update"];
const FINANCEIRO = [...VENDEDOR, "financeiro.read"];

function chapa(id: string, nome: string, espessura: number, custo: number | null, estoque: number | null = 0): Linha {
  return { id, nome, unidade: "m²", espessura_mm: espessura, custo_unitario: custo, custo_medio: custo, estoque };
}

function carregarBanco(mexer?: (t: Record<string, Linha | Linha[] | null>) => void) {
  const b = baseDoBanco(PADRAO);
  const materiais = (b.materiais as unknown as Linha[]).map((m) => {
    const id = PARA_UUID[String(m.id)] ?? String(m.id);
    return { ...m, id, ...(ESPESSURA[id] != null ? { espessura_mm: ESPESSURA[id] } : {}) };
  });
  materiais.push(
    chapa(U.branco2, "ACRILICO BRANCO VIRGEM 2MM", 2, 160),
    chapa(U.cristal10, "ACRILICO CRISTAL VIRGEM 10MM", 10, 900),
    chapa(U.cristal12, "ACRILICO CRISTAL VIRGEM 12MM", 12, 1100),
    chapa(U.cristal10SemCusto, "ACRILICO PRETO 10MM SEM CUSTO", 10, null),
  );
  const economico = baseDoBanco(ECONOMICO);
  const tabelas: Record<string, Linha | Linha[] | null> = {
    trofeu_regras: { unica: true, ...(b.regras as unknown as Linha) },
    // O Padrão vem primeiro: o `cotarTrofeu` lê o modelo por id e o mock devolve a primeira linha.
    trofeu_modelos: [
      { ...(b.modelo as unknown as Linha), id: MODELO, linha: "padrao", ativo: true },
      { ...(economico.modelo as unknown as Linha), id: "outro", linha: "economico", ativo: true },
    ],
    trofeu_pecas: b.pecas.map((p) => ({ ...(p as unknown as Linha), material_id: PARA_UUID[p.material_id] ?? p.material_id, modelo_id: MODELO })),
    materiais,
    custos_tabela: b.custos.map((c) => ({ ...c, ativo: true })),
    custos_mao_de_obra: b.maoDeObra.map((m) => ({ ...(m as unknown as Linha), ativo: true })),
    maquinas: b.maquinas.map((m) => ({ ...(m as unknown as Linha), ativa: true })),
  };
  mexer?.(tabelas);
  h.tabelas = tabelas;
}

/** A ficha do JariCross 10 Anos: placa de 6 mm, plaqueta de prata (sem cadastro) e base de 10 mm (preto 10 mm sem cadastro). */
function pecasDoJariCross(mexer?: (p: Record<string, unknown>[]) => void) {
  const pecas: Record<string, unknown>[] = [
    { nome: "Placa principal", materialId: U.cristal6, espessuraMm: 6, larguraCm: 20, alturaCm: 15, quantidade: 1, decoracao: "vinil_laminado", fatorDeForma: 1.3, materialPedido: null },
    { nome: "Placa frontal da base", materialId: U.branco2, espessuraMm: 2, larguraCm: 16, alturaCm: 4, quantidade: 1, decoracao: "vinil_laminado", fatorDeForma: 1, materialPedido: "Acrílico prata escovado" },
    { nome: "Base", materialId: U.cristal10, espessuraMm: 10, larguraCm: 22, alturaCm: 5, quantidade: 1, decoracao: "nenhuma", fatorDeForma: 1, materialPedido: "Acrílico preto brilhante" },
  ];
  mexer?.(pecas);
  return pecas;
}
const PEDIDO = (pecas = pecasDoJariCross()) => ({ alturaCm: 18, quantidade: 1, urgente: false, pecas });

let erros: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.permissoes = new Set(VENDEDOR);
  h.erroDePermissao = false;
  h.erroNaTabela = null;
  h.consultas = [];
  h.rpcDoUsuario = [];
  h.leiturasDoUsuario = [];
  carregarBanco();
  erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => erros.mockRestore());

describe("a entrada é estrita", () => {
  it.each([
    ["preço", { precoUnitario: 1 }],
    ["custo", { custoCheio: 1 }],
    ["multiplicador", { multiplicadorManual: 1 }],
    ["arte", { arte: { tipo: "cliente_manda" } }],
    ["modelo", { modeloId: MODELO }],
  ])("recusa %s vindo do navegador", async (_nome, extra) => {
    await expect(cotarFicha({ data: { ...PEDIDO(), ...extra } })).rejects.toThrow(/campo não aceito/);
    expect(h.consultas).toHaveLength(0);
  });

  it("recusa custo do m² dentro da peça", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[0].custoM2 = 0.01;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow(/campo não aceito/);
    expect(h.consultas).toHaveLength(0);
  });

  it("recusa lista de peças vazia ou grande demais, e material que não é uuid", async () => {
    await expect(cotarFicha({ data: PEDIDO([]) })).rejects.toThrow(/Confira os dados do troféu/);
    await expect(cotarFicha({ data: PEDIDO(Array.from({ length: 21 }, () => pecasDoJariCross()[0])) })).rejects.toThrow(/Confira os dados do troféu/);
    const semUuid = pecasDoJariCross((p) => {
      p[0].materialId = "mat-cristal-6mm";
    });
    await expect(cotarFicha({ data: PEDIDO(semUuid) })).rejects.toThrow(/Confira os dados do troféu \(material\)/);
  });

  it("recusa medida fora do que o sistema aceita com frase em português, antes de ler o banco", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[0].larguraCm = 900;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow(/A peça 1 \("Placa principal"\) está com largura fora do que o sistema aceita/);
    expect(h.consultas.filter((c) => c.tabela !== "trofeu_regras")).toHaveLength(0);
  });
});

describe("a permissão vem antes de qualquer leitura", () => {
  it("sem permissão de cotar, nada é lido com a chave de serviço", async () => {
    h.permissoes = new Set();
    await expect(cotarFicha({ data: PEDIDO() })).rejects.toThrow("Seu perfil não cota troféus.");
    expect(h.consultas).toHaveLength(0);
  });

  it("falha ao conferir a permissão vira frase, sem ler nada", async () => {
    h.erroDePermissao = true;
    await expect(cotarFicha({ data: PEDIDO() })).rejects.toThrow(/Não consegui calcular o preço agora/);
    expect(h.consultas).toHaveLength(0);
  });

  it("o cliente do usuário só pergunta permissão: nunca lê tabela", async () => {
    await cotarFicha({ data: PEDIDO() });
    expect(h.leiturasDoUsuario).toEqual([]);
    expect(h.rpcDoUsuario.every((r) => r.startsWith("has_permission:"))).toBe(true);
  });
});

describe("cotar a ficha do JariCross, sem estoque e com material trocado", () => {
  it("devolve o preço e os avisos, e a peça trocada diz qual material foi usado no lugar de qual", async () => {
    const r = await cotarFicha({ data: PEDIDO() });
    expect(r.precoUnitario).toBeGreaterThan(0);
    expect(r.precoTotal).toBe(r.precoUnitario);
    expect(r.arte).toBeNull();
    const avisos = (r.avisos as string[]).join(" | ");
    expect(avisos).toMatch(/sob medida/);
    expect(avisos).toContain('A peça "Placa frontal da base" foi cotada com ACRILICO BRANCO VIRGEM 2MM no lugar de "Acrílico prata escovado"');
    expect(avisos).toContain('A peça "Base" foi cotada com ACRILICO CRISTAL VIRGEM 10MM no lugar de "Acrílico preto brilhante"');
    expect(avisos).not.toMatch(/As medidas das peças vêm das imagens do modelo/);
  });

  it("o preço fecha em ,90 como o dos modelos", async () => {
    const r = (await cotarFicha({ data: PEDIDO() })).precoUnitario as number;
    expect(Math.round((r % 1) * 100)).toBe(90);
  });

  it("estoque zero só avisa: o preço sai", async () => {
    const r = await cotarFicha({ data: PEDIDO() });
    expect(r.precoUnitario).toBeGreaterThan(0);
    expect((r.avisos as string[]).join(" ")).toMatch(/Estoque de ACRILICO CRISTAL VIRGEM 10MM abaixo do necessário para este pedido. O orçamento sai normalmente/);
  });

  it("quem não vê custo recebe só preço e avisos: nenhum campo de custo", async () => {
    const r = await cotarFicha({ data: PEDIDO() });
    expect(Object.keys(r).sort()).toEqual(["alturaCm", "arte", "avisos", "modelo", "precoTotal", "precoUnitario", "quantidade", "totalGeral", "urgente"]);
    // Nenhum campo de custo e nenhuma menção ao multiplicador: o vendedor não vê a margem da casa (o aviso diz "regra de preço").
    expect(JSON.stringify(r)).not.toMatch(/"(custo|custoCheio|custoDeProducao|multiplicador|margemLiquidaPct|minutosDeLaser|minutosDeMaoDeObra|areaUtilM2|corteM|faixaDe)"/);
    expect(JSON.stringify(r)).not.toMatch(/multiplicador|margem/i);
  });

  it("quem vê custo recebe a decomposição, sem aval (não há multiplicador à mão)", async () => {
    h.permissoes = new Set(FINANCEIRO);
    const r = await cotarFicha({ data: PEDIDO() });
    expect(r.custoCheio).toBeGreaterThan(0);
    expect(r.multiplicadorManual).toBe(false);
    expect(r.podeDarAval).toBe(false);
    expect(r.pecas).toBe(3);
  });

  it("mais troféus, preço unitário igual ou menor (a escada de quantidade é a mesma)", async () => {
    const um = (await cotarFicha({ data: { ...PEDIDO(), quantidade: 1 } })).precoUnitario as number;
    const cem = (await cotarFicha({ data: { ...PEDIDO(), quantidade: 100 } })).precoUnitario as number;
    expect(cem).toBeLessThanOrEqual(um);
  });

  it("urgência encarece, como no modelo", async () => {
    const normal = (await cotarFicha({ data: PEDIDO() })).precoUnitario as number;
    const urgente = (await cotarFicha({ data: { ...PEDIDO(), urgente: true } })).precoUnitario as number;
    expect(urgente).toBeGreaterThan(normal);
  });

  it("lê o modelo Padrão ATIVO como referência (a linha, não outro modelo)", async () => {
    await cotarFicha({ data: PEDIDO() });
    const q = h.consultas.find((c) => c.tabela === "trofeu_modelos");
    expect(q?.filtros).toEqual({ linha: "padrao", ativo: true });
  });
});

describe("o material tem de ser chapa da MESMA espessura", () => {
  it("o preto de 3 mm numa peça de 10 mm é recusado, com a frase que diz o que fazer", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[2].materialId = U.preto3;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow(
      'A peça "Base" pede 10 mm, mas ACRILICO PRETO VIRGEM 3MM é de outra espessura. Escolha um material da mesma espessura.',
    );
  });

  it("material que não existe no cadastro é recusado", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[0].materialId = U.inexistente;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow('O material da peça "Placa principal" não está no cadastro de chapas. Escolha outro.');
  });

  it("o que não é chapa (vinil, em m² sem espessura) é recusado", async () => {
    h.tabelas.materiais = [...(h.tabelas.materiais as Linha[]), { id: U.inexistente, nome: "Vinil", unidade: "un", espessura_mm: 6, custo_unitario: 1, custo_medio: 1 }];
    const pecas = pecasDoJariCross((p) => {
      p[0].materialId = U.inexistente;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow(/não está no cadastro de chapas/);
  });
});

describe("cadastro incompleto é erro em português, nunca preço de fábrica", () => {
  it("material sem custo por m²", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[2].materialId = U.cristal10SemCusto;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow('O material de "Base" está sem custo por m² no cadastro. Avise a gerência.');
  });

  it("peça mais grossa que o laser da casa corta", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[2].materialId = U.cristal12;
      p[2].espessuraMm = 12;
    });
    await expect(cotarFicha({ data: PEDIDO(pecas) })).rejects.toThrow(/o laser da casa corta acrílico até 10 mm/);
  });

  it("sem o modelo Padrão ativo não há referência de mão de obra", async () => {
    carregarBanco((t) => {
      t.trofeu_modelos = [{ ...(baseDoBanco(ECONOMICO).modelo as unknown as Linha), id: "outro", linha: "economico", ativo: true }];
    });
    await expect(cotarFicha({ data: PEDIDO() })).rejects.toThrow(/Falta o modelo Padrão ativo no cadastro/);
  });

  it("sem as regras do troféu", async () => {
    carregarBanco((t) => {
      t.trofeu_regras = null;
    });
    await expect(cotarFicha({ data: PEDIDO() })).rejects.toThrow(/As regras de preço do troféu não estão cadastradas/);
  });

  it("falha do banco vira a frase genérica, sem vazar a mensagem do banco", async () => {
    h.erroNaTabela = "maquinas";
    const erro = await cotarFicha({ data: PEDIDO() }).catch((e: Error) => e);
    expect((erro as Error).message).toMatch(/Não consegui calcular o preço agora/);
    expect((erro as Error).message).not.toMatch(/permission denied/);
  });

  it("o que o servidor lê nunca vai para a resposta de erro", async () => {
    const pecas = pecasDoJariCross((p) => {
      p[2].materialId = U.cristal10SemCusto;
    });
    const erro = (await cotarFicha({ data: PEDIDO(pecas) }).catch((e: Error) => e)) as Error;
    expect(erro.message).not.toMatch(/\d+[.,]\d{2}/);
  });
});

describe("EQUIVALÊNCIA de ponta a ponta com o modelo cadastrado", () => {
  /** As peças do Padrão como a tela as mandaria, com o material do cadastro pelo uuid. */
  function pecasDoPadrao() {
    return PADRAO.pecas.map((p) => ({
      nome: p.nome,
      materialId: PARA_UUID[p.materialId],
      espessuraMm: p.espessuraMm,
      larguraCm: Math.round(p.larguraM * 1000) / 10,
      alturaCm: Math.round(p.alturaM * 1000) / 10,
      quantidade: p.quantidade,
      decoracao: p.decoracao,
      fatorDeForma: p.fatorDeForma,
      materialPedido: null,
    }));
  }

  it("as peças do Padrão dão o preço, o total e o custo do próprio Padrão", async () => {
    h.permissoes = new Set(FINANCEIRO);
    for (const quantidade of [1, 7, 50]) {
      const a = await cotarFicha({ data: { alturaCm: 18, quantidade, urgente: false, pecas: pecasDoPadrao() } });
      const b = await cotarModelo({ data: { modeloId: MODELO, alturaCm: 18, quantidade } });
      expect(a.precoUnitario).toBe(b.precoUnitario);
      expect(a.precoTotal).toBe(b.precoTotal);
      expect(a.custoCheio).toBe(b.custoCheio);
      expect(a.custoDeProducao).toBe(b.custoDeProducao);
    }
  });

  it("peça sem material trocado não gera aviso de substituição", async () => {
    const r = await cotarFicha({ data: { alturaCm: 18, quantidade: 1, urgente: false, pecas: pecasDoPadrao() } });
    expect((r.avisos as string[]).join(" ")).not.toMatch(/foi cotada com/);
  });
});
