/* eslint-disable @typescript-eslint/no-explicit-any -- dublês do cliente do banco e chamada direta da função de servidor: o contrato é JSON sem tipo */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { basePadrao } from "./montar";

/**
 * As funções de servidor da tela do agente (C4), chamadas como o servidor as chamaria, com o cliente do banco trocado por
 * dublê. O que se segura:
 *   permissão       conferida antes de qualquer leitura ou escrita; ligar é só whatsapp.manage, desligar aceita as duas
 *   escada          zero resposta aprovada não sobe; pular degrau não passa; desligar só pelo botão vermelho
 *   nada cru        erro do banco nunca chega à tela com o texto do banco; só a recusa escrita para o dono passa
 *   não instalado   migração ausente é dito, nunca vira lista vazia nem zero
 *   métricas        contagem em texto vira número, modo e ramo desconhecidos caem no padrão, a janela é de 30 dias
 */

type Resp = {
  data?: unknown;
  error?: { message?: string; code?: string } | null;
  count?: number | null;
};

const dubles = vi.hoisted(() => ({
  permissoes: new Set<string>(["configuracoes.manage"]),
  tabelas: {} as Record<string, Resp>,
  rpcs: {} as Record<string, (args: Record<string, unknown>) => Resp>,
  chamadas: [] as {
    tipo: "from" | "rpc";
    nome: string;
    metodos: [string, unknown[]][];
    args?: unknown;
  }[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const c: any = {
      middleware: () => c,
      inputValidator: (v: (d: unknown) => unknown) => ((c.validar = v), c),
      handler: (fn: (a: unknown) => unknown) => {
        return async (entrada: { data?: unknown; context: unknown }) =>
          fn({ ...entrada, data: c.validar ? c.validar(entrada.data) : entrada.data });
      },
    };
    return c;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => {
      const reg = { tipo: "from" as const, nome: tabela, metodos: [] as [string, unknown[]][] };
      dubles.chamadas.push(reg);

      const q: any = {};
      for (const m of ["select", "eq", "neq", "gte", "in", "order", "range", "limit"]) {
        q[m] = (...a: unknown[]) => {
          reg.metodos.push([m, a]);
          return q;
        };
      }
      const resposta = () => dubles.tabelas[tabela] ?? { data: [], error: null };
      q.maybeSingle = () => Promise.resolve(resposta());
      q.then = (ok: (v: Resp) => unknown, nok?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, nok);
      return q;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      dubles.chamadas.push({ tipo: "rpc", nome, metodos: [], args });
      return Promise.resolve(dubles.rpcs[nome]?.(args) ?? { data: {}, error: null });
    },
  },
}));

import {
  desligarTudoDoAgente,
  lerMetricasDoAgente,
  lerPainelDoAgente,
  fraseDoBancoServeParaATela,
  lerRegistroDoAgenteNaConversa,
  mudarDegrauDoAgente,
  naoInstalado,
  numero,
  salvarConfigDoAgente,
} from "../../src/lib/api/agente-escolhe.functions";
import { diaAntes } from "../../src/domain/agente/metricas";
import { mensagemErro } from "../../src/lib/erros";
import { hojeBr } from "../../src/lib/hoje-br";

const contexto = () => ({
  userId: "u1",
  supabase: {
    rpc: (_f: string, a: { _permission: string }) =>
      Promise.resolve({ data: dubles.permissoes.has(a._permission), error: null }),
  },
});

const chamar = (fn: unknown, data?: unknown) =>
  (fn as any)({ data, context: contexto() }) as Promise<any>;
const rpcsChamadas = () => dubles.chamadas.filter((c) => c.tipo === "rpc");
const tabelasLidas = () => dubles.chamadas.filter((c) => c.tipo === "from").map((c) => c.nome);

const CONFIG = {
  estado: "desligada",
  percentual: 0,
  numeros_teste: [],
  vale_a_partir_de: null,
  max_mensagens: 3,
  max_por_hora: 20,
  max_por_dia: 100,
  avisar_grupo: true,
  desligada_por: null,
  desligada_em: null,
  atualizado_em: null,
};

beforeEach(() => {
  dubles.permissoes = new Set(["configuracoes.manage"]);
  dubles.tabelas = {};
  dubles.rpcs = {};
  dubles.chamadas = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("lerPainelDoAgente", () => {
  it("sem nenhuma das duas permissões, recusa antes de ler qualquer coisa", async () => {
    dubles.permissoes = new Set();
    await expect(chamar(lerPainelDoAgente)).rejects.toThrow(/não tem a permissão/);
    expect(tabelasLidas()).toEqual([]);
  });

  it("migração não aplicada: diz que não está instalado, sem ler a base nem o quadro", async () => {
    dubles.tabelas.agente_config = {
      data: null,
      error: { code: "42P01", message: 'relation "agente_config" does not exist' },
    };
    const r = await chamar(lerPainelDoAgente);
    expect(r).toMatchObject({ instalada: false, config: null, base: [] });
    expect(tabelasLidas()).toEqual(["agente_config"]);
  });

  it("devolve configuração, base que ainda vale, quadro, termos e erros; só quem tem whatsapp.manage pode ligar", async () => {
    dubles.tabelas.agente_config = { data: CONFIG, error: null };
    dubles.tabelas.agente_base_respostas = { data: basePadrao(), error: null };
    dubles.tabelas.whatsapp_triagem_respostas = {
      data: [{ id: 1, passo: null, intencao: "parar", frase: "parar", casamento: "igual" }],
      error: null,
    };
    dubles.tabelas.whatsapp_triagem_termos_proibidos = {
      data: [
        { regra: "x", termo: "y", tipo: "trecho", sobre: "plano", ramo: "todos", ativo: true },
      ],
      error: null,
    };
    dubles.tabelas.agente_eventos = { data: null, error: null, count: 2 };
    const r = await chamar(lerPainelDoAgente);
    expect(r).toMatchObject({ instalada: true, podeLigar: false, errosEm24h: 2 });
    expect(r.base).toHaveLength(4);
    expect(r.quadro).toHaveLength(1);
    expect(r.termos).toHaveLength(1);
    // a base lida não inclui arquivada
    const leituraDaBase = dubles.chamadas.find((c) => c.nome === "agente_base_respostas")!;
    expect(leituraDaBase.metodos).toContainEqual(["neq", ["status", "arquivada"]]);
    dubles.permissoes = new Set(["whatsapp.manage"]);
    expect((await chamar(lerPainelDoAgente)).podeLigar).toBe(true);
  });

  it("erro de leitura LANÇA com frase própria e nunca com o texto do banco", async () => {
    dubles.tabelas.agente_config = {
      data: null,
      error: { code: "XX000", message: "senha do banco vazou aqui" },
    };
    const e = await chamar(lerPainelDoAgente).catch((x) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/Não consegui ler a configuração/);
    expect((e as Error).message).not.toMatch(/senha/);
  });

  it("termo proibido que não leu não derruba a tela: lista vazia, o piso do código continua", async () => {
    dubles.tabelas.agente_config = { data: CONFIG, error: null };
    dubles.tabelas.whatsapp_triagem_termos_proibidos = { data: null, error: { message: "x" } };
    dubles.tabelas.agente_eventos = { data: null, error: null, count: 0 };
    expect((await chamar(lerPainelDoAgente)).termos).toEqual([]);
  });
});

describe("mudarDegrauDoAgente", () => {
  const preparar = (config: Record<string, unknown>, base = basePadrao()) => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    dubles.tabelas.agente_config = { data: { ...CONFIG, ...config }, error: null };
    dubles.tabelas.agente_base_respostas = { data: base, error: null };
    dubles.rpcs.agente_config_salvar = (a) => ({
      data: { estado: (a.p_config as { estado: string }).estado },
      error: null,
    });
  };

  it("descer de ligada para parcial com porcentagem acima de 50 é recusado, e nada é gravado", async () => {
    preparar({ estado: "ligada", percentual: 100 });
    await expect(chamar(mudarDegrauDoAgente, { para: "parcial" })).rejects.toThrow(/50/);
    expect(rpcsChamadas()).toEqual([]);
  });

  it("quem só gerencia configurações não liga, e nada é lido nem gravado", async () => {
    await expect(chamar(mudarDegrauDoAgente, { para: "ensaio" })).rejects.toThrow(
      /permissão de gerenciar o WhatsApp/,
    );
    expect(dubles.chamadas.filter((c) => c.nome !== "has_permission")).toEqual([]);
  });

  it("desligada sobe para ensaio, e o banco recebe só o estado, com o id de quem pediu", async () => {
    preparar({});
    expect(await chamar(mudarDegrauDoAgente, { para: "ensaio" })).toEqual({
      ok: true,
      estado: "ensaio",
    });
    expect(rpcsChamadas()).toEqual([
      expect.objectContaining({
        nome: "agente_config_salvar",
        args: { p_usuario: "u1", p_config: { estado: "ensaio" } },
      }),
    ]);
  });

  it("ZERO respostas aprovadas: não sobe para teste e não chama o banco", async () => {
    preparar({ estado: "ensaio", numeros_teste: ["5596991112233"] }, []);
    await expect(chamar(mudarDegrauDoAgente, { para: "teste" })).rejects.toThrow(
      /Nenhuma resposta está aprovada/,
    );
    expect(rpcsChamadas()).toEqual([]);
  });

  it("pula degrau: recusa; teste sem número: recusa; parcial sem porcentagem: recusa", async () => {
    preparar({ estado: "desligada" });
    await expect(chamar(mudarDegrauDoAgente, { para: "teste" })).rejects.toThrow(
      /só sobe um degrau de cada vez/,
    );
    preparar({ estado: "ensaio" });
    await expect(chamar(mudarDegrauDoAgente, { para: "teste" })).rejects.toThrow(/número de teste/);
    preparar({ estado: "teste", numeros_teste: ["5596991112233"] });
    await expect(chamar(mudarDegrauDoAgente, { para: "parcial" })).rejects.toThrow(/porcentagem/);
    expect(rpcsChamadas()).toEqual([]);
  });

  it("descer é livre; ficar onde está não chama o banco; desligar só pelo botão vermelho", async () => {
    preparar({ estado: "ligada" });
    expect(await chamar(mudarDegrauDoAgente, { para: "parcial" })).toMatchObject({
      estado: "parcial",
    });
    expect(rpcsChamadas()).toHaveLength(1);
    dubles.chamadas = [];
    expect(await chamar(mudarDegrauDoAgente, { para: "ligada" })).toEqual({
      ok: true,
      estado: "ligada",
    });
    expect(rpcsChamadas()).toEqual([]);
    await expect(chamar(mudarDegrauDoAgente, { para: "desligada" })).rejects.toThrow(
      /botão vermelho Desligar tudo/,
    );
  });

  it("degrau que não existe é recusado na entrada", async () => {
    preparar({});
    await expect(chamar(mudarDegrauDoAgente, { para: "turbo" })).rejects.toThrow();
  });

  it("recusa do banco escrita para o dono passa; erro de outro tipo vira frase própria", async () => {
    preparar({});
    dubles.rpcs.agente_config_salvar = () => ({
      data: null,
      error: { code: "P0001", message: "O agente sobe um degrau por vez." },
    });
    await expect(chamar(mudarDegrauDoAgente, { para: "ensaio" })).rejects.toThrow(
      "O agente sobe um degrau por vez.",
    );
    dubles.rpcs.agente_config_salvar = () => ({
      data: null,
      error: { code: "42501", message: "permission denied for table agente_config" },
    });
    const e = await chamar(mudarDegrauDoAgente, { para: "ensaio" }).catch((x) => x as Error);
    expect((e as Error).message).toBe("Não consegui mudar o degrau do agente. Tente de novo.");
  });

  it("agente não instalado: diz isso, não mostra erro técnico", async () => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    dubles.tabelas.agente_config = {
      data: null,
      error: { code: "42P01", message: "does not exist" },
    };
    await expect(chamar(mudarDegrauDoAgente, { para: "ensaio" })).rejects.toThrow(
      /ainda não foi instalado/,
    );
  });
});

describe("desligarTudoDoAgente", () => {
  it("qualquer uma das duas permissões desliga, e o banco recebe o motivo e o usuário", async () => {
    dubles.rpcs.agente_desligar = () => ({ data: { canceladas_na_fila: 2 }, error: null });
    for (const p of ["configuracoes.manage", "whatsapp.manage"]) {
      dubles.permissoes = new Set([p]);
      dubles.chamadas = [];
      expect(await chamar(desligarTudoDoAgente, {})).toEqual({ ok: true, canceladasNaFila: 2 });
      expect(rpcsChamadas()[0]).toMatchObject({
        nome: "agente_desligar",
        args: { p_motivo: "botao_desligar_tudo", p_usuario: "u1" },
      });
    }
  });

  it("sem permissão nenhuma, recusa antes de chamar o banco", async () => {
    dubles.permissoes = new Set();
    await expect(chamar(desligarTudoDoAgente, {})).rejects.toThrow(/não tem a permissão/);
    expect(rpcsChamadas()).toEqual([]);
  });

  it("falha no banco: frase própria que manda tentar de novo agora", async () => {
    dubles.rpcs.agente_desligar = () => ({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const e = await chamar(desligarTudoDoAgente, {}).catch((x) => x as Error);
    expect((e as Error).message).toBe("Não consegui desligar o agente. Tente de novo agora.");
  });
});

describe("salvarConfigDoAgente", () => {
  it("só whatsapp.manage; grava com os nomes das colunas do banco", async () => {
    await expect(chamar(salvarConfigDoAgente, { percentual: 10 })).rejects.toThrow(
      /permissão de gerenciar o WhatsApp/,
    );
    dubles.permissoes = new Set(["whatsapp.manage"]);
    await chamar(salvarConfigDoAgente, { percentual: 10, numerosTeste: ["5596991112233"] });
    expect(rpcsChamadas().at(-1)).toMatchObject({
      nome: "agente_config_salvar",
      args: { p_usuario: "u1", p_config: { percentual: 10, numeros_teste: ["5596991112233"] } },
    });
  });

  it("nada para salvar não chama o banco; porcentagem fora de 0 a 100 é recusada", async () => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    expect(await chamar(salvarConfigDoAgente, {})).toEqual({ ok: true });
    expect(rpcsChamadas().filter((c) => c.nome === "agente_config_salvar")).toEqual([]);
    await expect(chamar(salvarConfigDoAgente, { percentual: 101 })).rejects.toThrow();
  });
});

describe("lerMetricasDoAgente", () => {
  it("sem nenhuma das duas permissões, recusa", async () => {
    dubles.permissoes = new Set();
    await expect(chamar(lerMetricasDoAgente)).rejects.toThrow(/não tem a permissão/);
  });

  it("aceita quem tem só whatsapp.manage e devolve tudo vazio quando as views estão vazias", async () => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    const r = await chamar(lerMetricasDoAgente);
    expect(r).toMatchObject({ dias: [], motivos: [], respostas: [], semResposta: [], base: [] });
    expect(r.hoje).toBe(hojeBr());
  });

  it("contagem em texto vira número, modo e ramo desconhecidos caem no padrão, e nenhuma linha some", async () => {
    dubles.tabelas.agente_metricas_dia = {
      error: null,
      data: [
        {
          dia: "2026-11-14",
          modo: "qualquer",
          ramo: "estranho",
          decisoes: "7",
          escolhidas: 3,
          entregues: "abc",
          barradas: null,
          sensiveis: "1",
        },
      ],
    };
    dubles.tabelas.agente_metricas_motivos_30_dias = {
      error: null,
      data: [
        { modo: "ensaio", ramo: "parceiro", acao: "barrar", motivo: "cortesia", n: "4" },
        { modo: "real", ramo: "cliente", acao: "x", motivo: "sem_resposta", n: 2 },
      ],
    };
    dubles.tabelas.agente_metricas_respostas = {
      error: null,
      data: [
        {
          resposta_id: "a",
          tema: "t",
          status: "aprovada",
          versao: "2",
          usos_real_30_dias: "5",
          usos_ensaio_30_dias: 0,
          usos_total: "9",
          ultimo_uso: "2026-11-14T10:00:00Z",
        },
      ],
    };
    dubles.tabelas.agente_metricas_sem_resposta_dia = {
      error: null,
      data: [{ dia: "2026-11-14", modo: "real", ramo: "cliente", perguntas_sem_resposta: "3" }],
    };
    dubles.tabelas.agente_base_respostas = {
      error: null,
      data: [{ id: "a", pergunta: "Qual o horário?", tema: "t" }],
    };
    const r = await chamar(lerMetricasDoAgente);
    expect(r.dias[0]).toEqual({
      dia: "2026-11-14",
      modo: "real",
      ramo: "cliente",
      decisoes: 7,
      escolhidas: 3,
      entregues: 0,
      barradas: 0,
      sensiveis: 1,
    });
    expect(r.motivos).toEqual([
      { modo: "ensaio", ramo: "parceiro", acao: "barrar", motivo: "cortesia", n: 4 },
      { modo: "real", ramo: "cliente", acao: "entregar", motivo: "sem_resposta", n: 2 },
    ]);
    expect(r.respostas[0]).toMatchObject({
      versao: 2,
      usos_real_30_dias: 5,
      usos_total: 9,
      ultimo_uso: "2026-11-14T10:00:00Z",
    });
    expect(r.semResposta[0].perguntas_sem_resposta).toBe(3);
    expect(r.base).toEqual([{ id: "a", pergunta: "Qual o horário?", tema: "t" }]);
  });

  it("a janela é de 30 dias de Macapá nas views por dia, e a base lida não traz arquivada", async () => {
    await chamar(lerMetricasDoAgente);
    const desde = diaAntes(hojeBr(), 29);
    for (const v of ["agente_metricas_dia", "agente_metricas_sem_resposta_dia"]) {
      expect(dubles.chamadas.find((c) => c.nome === v)!.metodos).toContainEqual([
        "gte",
        ["dia", desde],
      ]);
    }
    expect(dubles.chamadas.find((c) => c.nome === "agente_base_respostas")!.metodos).toContainEqual(
      ["neq", ["status", "arquivada"]],
    );
  });

  it("erro de leitura LANÇA (nunca lista vazia); view que não existe diz 'ainda não foram instaladas'; sem texto do banco", async () => {
    dubles.tabelas.agente_metricas_dia = {
      data: null,
      error: { code: "XX000", message: "segredo do banco" },
    };
    const geral = await chamar(lerMetricasDoAgente).catch((x) => x as Error);
    expect((geral as Error).message).toBe("Não consegui ler as métricas do agente. Tente de novo.");
    dubles.tabelas.agente_metricas_dia = {
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.agente_metricas_dia' in the schema cache",
      },
    };
    const falta = await chamar(lerMetricasDoAgente).catch((x) => x as Error);
    expect((falta as Error).message).toMatch(/ainda não foram instaladas/);
    expect((falta as Error).message).not.toMatch(/PGRST|schema cache/);
  });

  it("não lê coluna de texto: só as views de contagem e a pergunta que o dono escreveu na base", async () => {
    await chamar(lerMetricasDoAgente);
    expect(tabelasLidas().sort()).toEqual([
      "agente_base_respostas",
      "agente_metricas_dia",
      "agente_metricas_motivos_30_dias",
      "agente_metricas_respostas",
      "agente_metricas_sem_resposta_dia",
    ]);
    const base = dubles.chamadas.find((c) => c.nome === "agente_base_respostas")!;
    expect(base.metodos).toContainEqual(["select", ["id, pergunta, tema"]]);
  });
});

describe("lerRegistroDoAgenteNaConversa", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("exige whatsapp.read, a permissão de quem abre a conversa", async () => {
    await expect(chamar(lerRegistroDoAgenteNaConversa, { conversaId: id })).rejects.toThrow(
      /permissão de ler o WhatsApp/,
    );
    expect(tabelasLidas()).toEqual([]);
  });

  it("conta só as respostas enviadas e se entregou; só tipos saem do banco", async () => {
    dubles.permissoes = new Set(["whatsapp.read"]);
    dubles.tabelas.agente_eventos = {
      error: null,
      data: [{ tipo: "enviado" }, { tipo: "enviado" }, { tipo: "entregou" }],
    };
    expect(await chamar(lerRegistroDoAgenteNaConversa, { conversaId: id })).toEqual({
      instalado: true,
      respostas: 2,
      entregou: true,
    });
    const leitura = dubles.chamadas.find((c) => c.nome === "agente_eventos")!;
    expect(leitura.metodos).toContainEqual(["select", ["tipo"]]);
    expect(leitura.metodos).toContainEqual(["in", ["tipo", ["enviado", "entregou"]]]);
  });

  it("ensaio nunca conta: o filtro só pede enviado e entregou, nunca ensaio", async () => {
    dubles.permissoes = new Set(["whatsapp.read"]);
    await chamar(lerRegistroDoAgenteNaConversa, { conversaId: id });
    const filtro = JSON.stringify(
      dubles.chamadas.find((c) => c.nome === "agente_eventos")!.metodos,
    );
    expect(filtro).not.toMatch(/ensaio/);
  });

  it("sem registro: zero e falso, não erro", async () => {
    dubles.permissoes = new Set(["whatsapp.read"]);
    expect(await chamar(lerRegistroDoAgenteNaConversa, { conversaId: id })).toEqual({
      instalado: true,
      respostas: 0,
      entregou: false,
    });
  });

  it("migração ausente: instalado falso, sem erro e sem barulho; outro erro lança com frase própria", async () => {
    dubles.permissoes = new Set(["whatsapp.read"]);
    dubles.tabelas.agente_eventos = {
      data: null,
      error: { code: "42P01", message: "does not exist" },
    };
    expect(await chamar(lerRegistroDoAgenteNaConversa, { conversaId: id })).toEqual({
      instalado: false,
      respostas: 0,
      entregou: false,
    });
    dubles.tabelas.agente_eventos = { data: null, error: { code: "XX000", message: "segredo" } };
    const e = await chamar(lerRegistroDoAgenteNaConversa, { conversaId: id }).catch(
      (x) => x as Error,
    );
    expect((e as Error).message).toBe("Não consegui ler o registro do agente.");
  });

  it("conversa que não é um uuid é recusada na entrada", async () => {
    dubles.permissoes = new Set(["whatsapp.read"]);
    await expect(chamar(lerRegistroDoAgenteNaConversa, { conversaId: "abc" })).rejects.toThrow();
  });
});

describe("ajudantes", () => {
  it("numero(): texto e número viram número, o resto vira 0", () => {
    expect([
      numero("7"),
      numero(3),
      numero(null),
      numero("abc"),
      numero(undefined),
      numero(NaN),
    ]).toEqual([7, 3, 0, 0, 0, 0]);
  });
  it("naoInstalado(): os códigos de tabela ausente do Postgres e do PostgREST", () => {
    expect(naoInstalado({ code: "42P01" })).toBe(true);
    expect(naoInstalado({ code: "PGRST205" })).toBe(true);
    expect(naoInstalado({ message: "relation does not exist" })).toBe(true);
    expect(naoInstalado({ code: "42501", message: "permission denied" })).toBe(false);
    expect(naoInstalado(null)).toBe(false);
  });
});

describe("o arquivo do servidor", () => {
  const src = readFileSync("src/lib/api/agente-escolhe.functions.ts", "utf8");
  it("nunca escreve nas tabelas do agente: só `from` para ler e `rpc` para as funções do banco", () => {
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect([...src.matchAll(/db\.rpc\("(\w+)"/g)].map((m) => m[1]).sort()).toEqual([
      "agente_config_salvar",
      "agente_config_salvar",
      "agente_desligar",
    ]);
  });
  it("não manda mensagem nem importa o despachante", () => {
    expect(src).not.toMatch(/whatsapp-enviar|rodadaDoServidor|enviar/i);
  });
});

/* ------------------------------------------------------------------ */
/* Revisão de 14/11/2026: chave antiga, porcentagem em parcial e frases do banco */
/* ------------------------------------------------------------------ */

describe("a chave antiga agente_apos_triagem bloqueia subir de degrau, na tela e no servidor", () => {
  const preparar = (config: Record<string, unknown>, chave: boolean | null) => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    dubles.tabelas.agente_config = { data: { ...CONFIG, ...config }, error: null };
    dubles.tabelas.agente_base_respostas = { data: basePadrao(), error: null };
    dubles.tabelas.whatsapp_triagem_config = {
      data: chave === null ? null : { agente_apos_triagem: chave },
      error: null,
    };
    dubles.rpcs.agente_config_salvar = (a) => ({
      data: { estado: (a.p_config as { estado: string }).estado },
      error: null,
    });
  };

  it("o painel lê a chave: ligada vira chaveAntigaLigada true, desligada false", async () => {
    dubles.tabelas.agente_config = { data: CONFIG, error: null };
    dubles.tabelas.agente_eventos = { data: null, error: null, count: 0 };
    dubles.tabelas.whatsapp_triagem_config = { data: { agente_apos_triagem: true }, error: null };
    expect((await chamar(lerPainelDoAgente)).chaveAntigaLigada).toBe(true);
    dubles.tabelas.whatsapp_triagem_config = { data: { agente_apos_triagem: false }, error: null };
    expect((await chamar(lerPainelDoAgente)).chaveAntigaLigada).toBe(false);
  });

  it("falha ao ler a chave NÃO vira desligada: o painel lança com frase própria", async () => {
    dubles.tabelas.agente_config = { data: CONFIG, error: null };
    dubles.tabelas.agente_eventos = { data: null, error: null, count: 0 };
    dubles.tabelas.whatsapp_triagem_config = {
      data: null,
      error: { code: "XX000", message: "segredo do banco" },
    };
    const e = await chamar(lerPainelDoAgente).catch((x) => x as Error);
    expect((e as Error).message).toMatch(/Não consegui ler a configuração do robô de boas-vindas/);
    expect((e as Error).message).not.toMatch(/segredo/);
  });

  it("o servidor recusa subir com a chave ligada, em palavras, e não grava nada", async () => {
    preparar({ estado: "desligada" }, true);
    await expect(chamar(mudarDegrauDoAgente, { para: "ensaio" })).rejects.toThrow(
      /chave antiga de texto livre/,
    );
    expect(rpcsChamadas().filter((c) => c.nome === "agente_config_salvar")).toEqual([]);
  });

  it("com a chave desligada o mesmo passo sobe; descer continua livre mesmo com ela ligada", async () => {
    preparar({ estado: "desligada" }, false);
    expect(await chamar(mudarDegrauDoAgente, { para: "ensaio" })).toMatchObject({ ok: true });
    dubles.chamadas = [];
    preparar({ estado: "ligada" }, true);
    expect(await chamar(mudarDegrauDoAgente, { para: "parcial" })).toMatchObject({
      estado: "parcial",
    });
    expect(rpcsChamadas()).toHaveLength(1);
  });
});

describe("porcentagem em parcial: o servidor recusa acima de 50", () => {
  beforeEach(() => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
  });

  it("em parcial, 51 e 100 são recusados com a frase que manda subir para ligada, e nada é gravado", async () => {
    dubles.tabelas.agente_config = {
      data: { ...CONFIG, estado: "parcial", percentual: 10 },
      error: null,
    };
    for (const p of [51, 100]) {
      await expect(chamar(salvarConfigDoAgente, { percentual: p })).rejects.toThrow(
        /Em parcial, a porcentagem vai só até 50/,
      );
    }
    expect(rpcsChamadas().filter((c) => c.nome === "agente_config_salvar")).toEqual([]);
  });

  it("em parcial, 50 passa; fora de parcial o limite não vale (ainda não é quem recebe)", async () => {
    dubles.tabelas.agente_config = {
      data: { ...CONFIG, estado: "parcial", percentual: 10 },
      error: null,
    };
    await chamar(salvarConfigDoAgente, { percentual: 50 });
    expect(rpcsChamadas().at(-1)).toMatchObject({ args: { p_config: { percentual: 50 } } });
    dubles.chamadas = [];
    dubles.tabelas.agente_config = { data: { ...CONFIG, estado: "teste" }, error: null };
    await chamar(salvarConfigDoAgente, { percentual: 80 });
    expect(rpcsChamadas().at(-1)).toMatchObject({ args: { p_config: { percentual: 80 } } });
  });

  it("subir para parcial com a porcentagem salva acima de 50 é recusado", async () => {
    dubles.tabelas.agente_config = {
      data: { ...CONFIG, estado: "teste", percentual: 80, numeros_teste: ["5596991112233"] },
      error: null,
    };
    dubles.tabelas.agente_base_respostas = { data: basePadrao(), error: null };
    dubles.tabelas.whatsapp_triagem_config = { data: { agente_apos_triagem: false }, error: null };
    await expect(chamar(mudarDegrauDoAgente, { para: "parcial" })).rejects.toThrow(
      /Em parcial, a porcentagem vai só até 50/,
    );
  });
});

describe("falhou(): a frase do banco só passa se estiver escrita para a tela", () => {
  const recusa = (message: string) => {
    dubles.permissoes = new Set(["whatsapp.manage"]);
    dubles.tabelas.agente_config = { data: { ...CONFIG, estado: "desligada" }, error: null };
    dubles.tabelas.agente_base_respostas = { data: basePadrao(), error: null };
    dubles.tabelas.whatsapp_triagem_config = { data: { agente_apos_triagem: false }, error: null };
    dubles.rpcs.agente_config_salvar = () => ({ data: null, error: { code: "P0001", message } });
    return chamar(mudarDegrauDoAgente, { para: "ensaio" }).catch((x) => (x as Error).message);
  };

  it("frase limpa passa; com parênteses ou com sublinhado vira a frase genérica", async () => {
    expect(await recusa("O agente só sobe um degrau de cada vez, na ordem.")).toBe(
      "O agente só sobe um degrau de cada vez, na ordem.",
    );
    const generica = "Não consegui mudar o degrau do agente. Tente de novo.";
    expect(await recusa("O agente sobe (desligada, ensaio, teste): de % não vai")).toBe(generica);
    expect(await recusa("Para desligar use agente_desligar: ele cancela a fila.")).toBe(generica);
    expect(await recusa("Mudar o teto exige a permissão whatsapp_manage.")).toBe(generica);
  });

  it("fraseDoBancoServeParaATela diz o mesmo, e frase vazia nunca serve", () => {
    expect(
      fraseDoBancoServeParaATela("Seu perfil não tem a permissão para configurar o agente."),
    ).toBe(true);
    expect(fraseDoBancoServeParaATela("tem (parênteses)")).toBe(false);
    expect(fraseDoBancoServeParaATela("tem_sublinhado")).toBe(false);
    expect(fraseDoBancoServeParaATela("")).toBe(false);
    expect(fraseDoBancoServeParaATela(undefined)).toBe(false);
  });

  it("toda frase própria do servidor e das recusas do banco chega inteira à tela: acento, sem parênteses nem sublinhado", () => {
    const sql = readFileSync(
      "supabase/migrations/20261115100000_agente_escolhe_respostas.sql",
      "utf8",
    );
    const doBanco = [...sql.matchAll(/RAISE EXCEPTION '([^'%]*(?:''[^'%]*)*)'(?:,|;)/g)]
      .map((m) => m[1])
      .filter((f) => !f.startsWith("esperava") && !f.includes("FALHOU"));
    // as recusas que a tela pode mostrar: as das funções de configuração e de desligar e a do gatilho
    const daTela = doBanco.filter((f) =>
      /degrau|permissão|Configuração inválida|números de teste|Desligar tudo/.test(f),
    );
    expect(daTela.length).toBeGreaterThanOrEqual(8);
    const doServidor = [
      ...readFileSync("src/lib/api/agente-escolhe.functions.ts", "utf8").matchAll(
        /new Error\(\s*"([^"]+)"/g,
      ),
    ].map((m) => m[1]);
    expect(doServidor.length).toBeGreaterThanOrEqual(6);
    for (const f of [...daTela, ...doServidor]) {
      expect(f, f).not.toMatch(/[()_]/);
      // mensagemErro só deixa passar o que tem letra acentuada: sem acento a tela mostraria a frase genérica
      expect(mensagemErro(new Error(f)), f).toBe(f);
    }
  });
});
