import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O consumidor da fila com a triagem (PR B5), exercido de verdade com o banco e o Z-API trocados por dublês.
 *   varredura          roda no começo de cada rodada do servidor, antes de qualquer retorno; a rodada imediata da
 *                      triagem passa varrer: false
 *   pergunta de triagem só sai se a triagem está ativa, sem gente na conversa e com o degrau permitindo; senão a
 *                      linha é cancelada pelo banco; se a conferência não consegue ler, a linha espera
 *   despedida          a ÚLTIMA mensagem da triagem (fechamento, link de parceiro, aviso de equipe, aviso de parar) é
 *                      enfileirada junto do status final (concluida, entregue_equipe, parada_pelo_contato) e SAI,
 *                      tanto na rodada de 2 minutos quanto no despacho imediato; gente na conversa e degrau desligado
 *                      ainda cancelam
 *   telefone           lid, número de fora e fixo nunca recebem mensagem da triagem
 *   atraso de digitação vai para o Z-API só na linha de triagem; o aviso de pedido sai como sempre
 */

type Linha = {
  id: string;
  conversa_id: string;
  mensagem_id: string;
  payload: Record<string, unknown>;
  tentativas: number;
  created_by: string | null;
  idempotency_key: string;
};

const banco = vi.hoisted(() => {
  const e = {
    log: [] as {
      tabela: string;
      metodo: string;
      args: unknown[];
      filtros: Record<string, unknown>;
    }[],
    rpcs: [] as { nome: string; params: unknown }[],
    linhas: [] as unknown[],
    triagem: { data: { status: "ativa", modo: "real" }, error: null } as unknown,
    config: { data: { estado: "teste" }, error: null } as unknown,
    telefone: "96991112233" as string | null,
    humano: { data: false, error: null } as unknown,
    degrau: { data: true, error: null } as unknown,
    from(tabela: string) {
      let verbo = "select";
      const filtros: Record<string, unknown> = {};
      const c: Record<string, unknown> = {};
      for (const m of [
        "select",
        "insert",
        "update",
        "delete",
        "eq",
        "neq",
        "in",
        "is",
        "gte",
        "lte",
        "lt",
        "gt",
        "or",
        "not",
        "limit",
        "maybeSingle",
        "single",
        "order",
      ]) {
        c[m] = (...args: unknown[]) => {
          if (m === "insert" || m === "update" || m === "delete") verbo = m;
          if (m === "eq") filtros[String(args[0])] = args[1];
          e.log.push({ tabela, metodo: m, args, filtros });
          return c;
        };
      }
      c.then = (resolve: (v: unknown) => unknown) => {
        let r: unknown = { data: [], error: null };
        if (tabela === "whatsapp_instancias")
          r = { data: { id: "inst-1", zapi_instance_id: "INST", conectado: true }, error: null };
        else if (tabela === "whatsapp_fila_envio") {
          if (verbo === "update") r = { data: [{ id: "x" }], error: null };
          else r = { data: filtros.status === "pendente" ? e.linhas : [], error: null };
        } else if (tabela === "whatsapp_mensagens" && verbo === "update")
          r = { data: [{ id: "x" }], error: null };
        else if (tabela === "whatsapp_conversas")
          r = { data: { telefone: e.telefone, fila: null }, error: null };
        else if (tabela === "whatsapp_triagem_config") r = e.config;
        else if (tabela === "whatsapp_triagem_eventos") r = { data: null, error: null };
        else if (tabela === "whatsapp_triagens") r = e.triagem;
        else if (tabela === "whatsapp_logs") r = { data: null, error: null };
        return Promise.resolve(r).then(resolve);
      };
      return c;
    },
    rpc(nome: string, params: unknown) {
      e.rpcs.push({ nome, params });
      if (nome === "_triagem_humano_na_conversa") return Promise.resolve(e.humano);
      if (nome === "_triagem_degrau_permite") return Promise.resolve(e.degrau);
      if (nome === "_triagem_cancelar_pendentes") return Promise.resolve({ data: 1, error: null });
      if (nome === "triagem_varrer")
        return Promise.resolve({ data: { expiradas: 0 }, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  return e;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => banco.from(t),
    rpc: (n: string, p: unknown) => banco.rpc(n, p),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "sem sessão" } }) },
  },
}));

import { rodadaDoServidor } from "../src/lib/api/whatsapp-enviar.server";
import { montarEnvio, atrasoValidoDoZapi } from "../src/domain/whatsapp/zapi-envio";

const linhaDeTriagem = (extra: Partial<Linha> = {}): Linha => ({
  id: "f-1",
  conversa_id: "c-1",
  mensagem_id: "m-1",
  payload: {
    tipo: "texto",
    texto: "Olá, seja bem-vindo à Bex Print!",
    atraso_s: 5,
    triagem_id: "t-1",
    passo: "nome",
  },
  tentativas: 0,
  created_by: null,
  idempotency_key: "triagem:t-1:nome:1",
  ...extra,
});

let corposDoZapi: Record<string, unknown>[];
let fetchOriginal: typeof fetch;

beforeEach(() => {
  banco.log.length = 0;
  banco.rpcs.length = 0;
  banco.linhas = [];
  banco.triagem = { data: { status: "ativa", modo: "real" }, error: null };
  banco.config = { data: { estado: "teste" }, error: null };
  banco.telefone = "96991112233";
  banco.humano = { data: false, error: null };
  banco.degrau = { data: true, error: null };
  vi.stubEnv("ZAPI_TOKEN", "token-zapi");
  vi.stubEnv("ZAPI_CLIENT_TOKEN", "client-token");
  corposDoZapi = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    corposDoZapi.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ messageId: "zap-1", id: "zap-1" }), { status: 200 });
  }) as unknown as typeof fetch;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const cancelou = () => banco.rpcs.filter((r) => r.nome === "_triagem_cancelar_pendentes");
const reservou = () =>
  banco.log.some((l) => l.tabela === "whatsapp_fila_envio" && l.metodo === "update");

describe("a varredura da triagem roda a cada rodada do servidor", () => {
  it("antes de qualquer retorno antecipado: mesmo sem token do Z-API ela roda", async () => {
    vi.stubEnv("ZAPI_TOKEN", "");
    const r = await rodadaDoServidor();
    expect(r.status).toBe(503);
    expect(banco.rpcs).toEqual([{ nome: "triagem_varrer", params: {} }]);
  });

  it("vem antes de ler a fila e o resultado vai na resposta", async () => {
    const r = await rodadaDoServidor();
    const primeiraLeituraDaFila = banco.log.findIndex((l) => l.tabela === "whatsapp_fila_envio");
    expect(primeiraLeituraDaFila).toBeGreaterThanOrEqual(0);
    expect(banco.rpcs[0].nome).toBe("triagem_varrer");
    expect((await r.json()).triagem).toEqual({ expiradas: 0 });
  });

  it("a rodada imediata da triagem não varre", async () => {
    await rodadaDoServidor({ varrer: false });
    expect(banco.rpcs.filter((x) => x.nome === "triagem_varrer")).toEqual([]);
  });

  it("não cria job novo: o código do despachante não agenda nada", () => {
    const src = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");
    expect(src).not.toMatch(/cron\.schedule|setInterval/);
  });
});

describe("pergunta de triagem na fila", () => {
  it("triagem ativa, sem gente, degrau permite: sai sem autor e com o atraso de digitação", async () => {
    banco.linhas = [linhaDeTriagem()];
    const r = await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([
      {
        phone: "5596991112233",
        message: "Olá, seja bem-vindo à Bex Print!",
        delayTyping: 5,
        delayMessage: 5,
      },
    ]);
    expect((await r.json()).enviadas).toBe(1);
    expect(cancelou()).toEqual([]);
  });

  it("a equipe respondeu entre enfileirar e enviar: cancela pelo banco, não reserva e não manda nada", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.humano = { data: true, error: null };
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([]);
    expect(cancelou()).toEqual([
      { nome: "_triagem_cancelar_pendentes", params: { p_conversa: "c-1" } },
    ]);
    expect(reservou()).toBe(false);
  });

  it("a escada desceu: cancela", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.degrau = { data: false, error: null };
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([]);
    expect(cancelou()).toHaveLength(1);
  });

  it("a triagem parou: cancela", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.triagem = { data: { status: "pausada_humano", modo: "real" }, error: null };
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([]);
    expect(cancelou()).toHaveLength(1);
  });

  it("não deu para ler a triagem: a linha espera, sem cancelar e sem enviar", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.triagem = { data: null, error: { message: "banco fora" } };
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([]);
    expect(cancelou()).toEqual([]);
    expect(reservou()).toBe(false);
  });

  it("resposta da IA e aviso de pedido não passam pela conferência nem levam atraso", async () => {
    banco.linhas = [
      {
        id: "f-2",
        conversa_id: "c-1",
        mensagem_id: "m-2",
        payload: { tipo: "texto", texto: "Resposta da assistente" },
        tentativas: 0,
        created_by: null,
        idempotency_key: "ia:m-2",
      },
    ];
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([{ phone: "5596991112233", message: "Resposta da assistente" }]);
    expect(banco.rpcs.filter((x) => x.nome.startsWith("_triagem"))).toEqual([]);
  });

  it("linha sem autor e sem chave conhecida continua sendo recusada", async () => {
    banco.linhas = [
      linhaDeTriagem({ idempotency_key: "qualquer:coisa", payload: { tipo: "texto", texto: "x" } }),
    ];
    const r = await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([]);
    expect((await r.json()).falhas).toBe(1);
  });
});

/** As duas portas do consumidor: a rodada de 2 minutos (com varredura) e o despacho imediato (sem varrer). */
const PORTAS: [string, () => Promise<Response>][] = [
  ["rodada de 2 minutos", () => rodadaDoServidor()],
  ["despacho imediato", () => rodadaDoServidor({ varrer: false })],
];

describe.each(PORTAS)("a despedida da triagem, pela %s", (_nome, rodar) => {
  for (const status of ["concluida", "entregue_equipe", "parada_pelo_contato"]) {
    it(`status ${status}: a última mensagem SAI, com o atraso de digitação, e nada é cancelado`, async () => {
      banco.linhas = [
        linhaDeTriagem({
          idempotency_key: "triagem:t-1:fechamento_dentro:3",
          payload: {
            tipo: "texto",
            texto: "Já avisei a equipe. Em breve alguém responde por aqui.",
            atraso_s: 6,
            triagem_id: "t-1",
            passo: "fechamento",
          },
        }),
      ];
      banco.triagem = { data: { status, modo: "real" }, error: null };
      const r = await rodar();
      expect(corposDoZapi).toEqual([
        {
          phone: "5596991112233",
          message: "Já avisei a equipe. Em breve alguém responde por aqui.",
          delayTyping: 6,
          delayMessage: 6,
        },
      ]);
      expect((await r.json()).enviadas).toBe(1);
      expect(cancelou()).toEqual([]);
    });

    it(`status ${status}: gente na conversa depois do fechamento enfileirado cancela`, async () => {
      banco.linhas = [linhaDeTriagem()];
      banco.triagem = { data: { status, modo: "real" }, error: null };
      banco.humano = { data: true, error: null };
      await rodar();
      expect(corposDoZapi).toEqual([]);
      expect(cancelou()).toHaveLength(1);
      expect(reservou()).toBe(false);
    });

    it(`status ${status}: degrau desligado cancela a despedida também`, async () => {
      banco.linhas = [linhaDeTriagem()];
      banco.triagem = { data: { status, modo: "real" }, error: null };
      banco.degrau = { data: false, error: null };
      await rodar();
      expect(corposDoZapi).toEqual([]);
      expect(cancelou()).toHaveLength(1);
    });
  }

  for (const status of ["pausada_humano", "pausada_desligada", "pulada", "expirada", "ensaio"]) {
    it(`status ${status}: cancela e apaga a mensagem pendente`, async () => {
      banco.linhas = [linhaDeTriagem()];
      banco.triagem = { data: { status, modo: status === "ensaio" ? "ensaio" : "real" }, error: null };
      await rodar();
      expect(corposDoZapi).toEqual([]);
      expect(cancelou()).toEqual([{ nome: "_triagem_cancelar_pendentes", params: { p_conversa: "c-1" } }]);
      expect(reservou()).toBe(false);
    });
  }

  it("triagem em modo ensaio nunca envia, mesmo com status terminal", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.triagem = { data: { status: "entregue_equipe", modo: "ensaio" }, error: null };
    await rodar();
    expect(corposDoZapi).toEqual([]);
    expect(cancelou()).toHaveLength(1);
  });
});

describe("telefone com cara de lid nunca recebe mensagem da triagem", () => {
  for (const telefone of ["253386293268636", "253386293268636@lid", "447700900123"]) {
    for (const status of ["ativa", "concluida", "entregue_equipe", "parada_pelo_contato"]) {
      it(`${telefone} com a triagem ${status}: cancela, não reserva e não chama o Z-API`, async () => {
        banco.linhas = [linhaDeTriagem()];
        banco.triagem = { data: { status, modo: "real" }, error: null };
        banco.telefone = telefone;
        await rodadaDoServidor({ varrer: false });
        expect(corposDoZapi).toEqual([]);
        expect(cancelou()).toHaveLength(1);
        expect(reservou()).toBe(false);
        const evento = banco.log.find((l) => l.tabela === "whatsapp_triagem_eventos" && l.metodo === "insert");
        expect(evento).toBeDefined();
      });
    }
  }

  it("celular brasileiro com 55 na frente sai normalmente", async () => {
    banco.linhas = [linhaDeTriagem()];
    banco.telefone = "5596991112233";
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toHaveLength(1);
    expect(corposDoZapi[0].phone).toBe("5596991112233");
  });

  it("aviso da IA para um telefone de fora não passa por esta conferência", async () => {
    banco.telefone = "447700900123";
    banco.linhas = [
      {
        id: "f-9",
        conversa_id: "c-1",
        mensagem_id: "m-9",
        payload: { tipo: "texto", texto: "Resposta da assistente" },
        tentativas: 0,
        created_by: null,
        idempotency_key: "ia:m-9",
      },
    ];
    await rodadaDoServidor({ varrer: false });
    expect(corposDoZapi).toEqual([{ phone: "447700900123", message: "Resposta da assistente" }]);
  });
});

describe("a varredura com a triagem desligada", () => {
  it("desligada e sem conversa aberta: a rodada nem chama o banco para varrer", async () => {
    banco.config = { data: { estado: "desligada" }, error: null };
    banco.triagem = { data: [], error: null };
    const r = await rodadaDoServidor();
    expect(banco.rpcs.filter((x) => x.nome === "triagem_varrer")).toEqual([]);
    expect((await r.json()).triagem).toEqual({ pulada: true, motivo: "desligada" });
  });

  it("desligada com conversa aberta: varre, para o freio terminar de parar o que ficou", async () => {
    banco.config = { data: { estado: "desligada" }, error: null };
    banco.triagem = { data: [{ id: "t-1" }], error: null };
    await rodadaDoServidor();
    expect(banco.rpcs.filter((x) => x.nome === "triagem_varrer")).toHaveLength(1);
  });

  it("ligada em qualquer degrau: varre", async () => {
    for (const estado of ["ensaio", "teste", "parcial", "ligada"]) {
      banco.rpcs.length = 0;
      banco.config = { data: { estado }, error: null };
      await rodadaDoServidor();
      expect(banco.rpcs.filter((x) => x.nome === "triagem_varrer"), estado).toHaveLength(1);
    }
  });

  it("não deu para ler o estado: varre, o lado seguro", async () => {
    banco.config = { data: null, error: { message: "banco fora" } };
    await rodadaDoServidor();
    expect(banco.rpcs.filter((x) => x.nome === "triagem_varrer")).toHaveLength(1);
  });
});

describe("o atraso de digitação no corpo do Z-API", () => {
  const cred = { instanceId: "I", token: "T" };
  it("só vale de 1 a 15, só em texto e só para pessoa", () => {
    expect(atrasoValidoDoZapi(1)).toBe(1);
    expect(atrasoValidoDoZapi(15)).toBe(15);
    expect(atrasoValidoDoZapi(4.6)).toBe(5);
    for (const v of [0, 16, -3, NaN, "5", null, undefined])
      expect(atrasoValidoDoZapi(v)).toBeNull();
    const base = { tipo: "texto" as const, para: "96991112233", texto: "oi" };
    expect(montarEnvio({ ...base, atrasoS: 4 }, cred)).toMatchObject({
      corpo: { phone: "5596991112233", message: "oi", delayTyping: 4, delayMessage: 4 },
    });
    expect(montarEnvio({ ...base, atrasoS: 99 }, cred)).toMatchObject({
      corpo: { phone: "5596991112233", message: "oi" },
    });
    expect((montarEnvio({ ...base }, cred) as { corpo: Record<string, unknown> }).corpo).toEqual({
      phone: "5596991112233",
      message: "oi",
    });
    expect(
      (
        montarEnvio({ ...base, para: "120363000000000000-group", atrasoS: 4 }, cred) as {
          corpo: Record<string, unknown>;
        }
      ).corpo,
    ).toEqual({
      phone: "120363000000000000-group",
      message: "oi",
    });
  });
});
