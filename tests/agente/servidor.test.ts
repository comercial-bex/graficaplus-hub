import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O agente no servidor (C3): a porta de verdade, o teto de tempo, a conferência da fila e a varredura, com o banco trocado
 * por dublê. O que se segura:
 *   desligado            lê a linha de configuração e nada mais: nenhuma função, nenhuma outra tabela
 *   banco fora           não lança; devolve erro e tenta deixar o rastro só com etapa e código
 *   tempo                passou do teto: devolve erro de tempo e não pendura o webhook
 *   formato das chamadas os nomes dos parâmetros são os das funções do banco
 *   fila                 a linha com `agente: true` é conferida pelo agente; a da triagem continua na triagem
 *   varredura            só com o agente ligado em algum degrau
 */

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/api/whatsapp-enviar.server", () => ({
  rodadaDoServidor: vi.fn(async () => new Response("{}")),
}));

import {
  agenteSemDerrubar,
  conferirLinhaDoAgente,
  portaDoAgente,
  TEMPO_LIMITE_DO_AGENTE_MS,
  varrerAgente,
  varrerAgenteSeLigado,
} from "@/lib/api/agente-escolhe.server";
import { conferirLinhaDeTriagem } from "@/lib/api/whatsapp-triagem.server";
import { rodadaDoServidor } from "@/lib/api/whatsapp-enviar.server";

type Resp = { data?: unknown; error?: { message?: string; code?: string } | null };

function bancoFalso(o: {
  tabelas?: Record<string, Resp | (() => Resp)>;
  rpcs?: Record<string, (params: Record<string, unknown>) => Resp>;
  tabelaLanca?: boolean;
}) {
  const chamadas: { tipo: "from" | "rpc"; nome: string; params?: unknown; metodos?: string[] }[] =
    [];
  const db = {
    from(tabela: string) {
      const c: { tipo: "from"; nome: string; metodos: string[] } = {
        tipo: "from",
        nome: tabela,
        metodos: [],
      };
      chamadas.push(c);
      if (o.tabelaLanca) throw new Error("banco fora");
      const cadeia: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range", "maybeSingle"]) {
        cadeia[m] = () => {
          c.metodos.push(m);
          return cadeia;
        };
      }
      cadeia.then = (resolve: (v: unknown) => unknown) => {
        const r = o.tabelas?.[tabela];
        return Promise.resolve(
          typeof r === "function" ? r() : (r ?? { data: null, error: null }),
        ).then(resolve);
      };
      return cadeia;
    },
    rpc(nome: string, params: Record<string, unknown>) {
      chamadas.push({ tipo: "rpc", nome, params });
      const f = o.rpcs?.[nome];
      return Promise.resolve(f ? f(params) : { data: null, error: null });
    },
  };
  return { db: db as never, chamadas };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("estado de nascença: desligado", () => {
  it("lê a linha de configuração do agente e sai: nenhuma função do banco, nenhuma outra tabela", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: { agente_config: { data: { estado: "desligada" }, error: null } },
    });
    expect(await agenteSemDerrubar("c-1", "m-1", { porta: portaDoAgente(db) })).toEqual({
      acao: "nada",
      motivo: "desligada",
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      tipo: "from",
      nome: "agente_config",
      metodos: ["select", "maybeSingle"],
    });
  });

  it("a varredura do agente desligado nem chama o banco além da linha de configuração", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: { agente_config: { data: { estado: "desligada" }, error: null } },
    });
    expect(await varrerAgenteSeLigado(db)).toEqual({ pulada: true, motivo: "desligada" });
    expect(chamadas.filter((c) => c.tipo === "rpc")).toEqual([]);
    const sem = bancoFalso({ tabelas: { agente_config: { data: null, error: null } } });
    expect(await varrerAgenteSeLigado(sem.db)).toEqual({
      pulada: true,
      motivo: "sem_configuracao",
    });
    const quebrada = bancoFalso({ tabelaLanca: true });
    expect(await varrerAgenteSeLigado(quebrada.db)).toEqual({
      pulada: true,
      motivo: "leitura_da_configuracao",
    });
  });

  it("ligado em qualquer degrau, a varredura chama agente_varrer", async () => {
    for (const estado of ["ensaio", "teste", "parcial", "ligada"]) {
      const { db, chamadas } = bancoFalso({
        tabelas: { agente_config: { data: { estado }, error: null } },
        rpcs: {
          agente_varrer: () => ({ data: { freio: null, eventos_apagados: 2 }, error: null }),
        },
      });
      expect(await varrerAgenteSeLigado(db)).toEqual({ freio: null, eventos_apagados: 2 });
      expect(chamadas.find((c) => c.tipo === "rpc")).toMatchObject({
        nome: "agente_varrer",
        params: {},
      });
    }
  });

  it("varredura com erro do banco devolve erro e nunca lança", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = bancoFalso({
      rpcs: { agente_varrer: () => ({ data: null, error: { message: "x", code: "42501" } }) },
    });
    expect(await varrerAgente(db)).toEqual({ erro: true });
  });
});

describe("nunca derruba o webhook", () => {
  it("banco que lança ao ler a configuração: devolve erro, sem exceção", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = bancoFalso({ tabelaLanca: true });
    await expect(agenteSemDerrubar("c-1", "m-1", { porta: portaDoAgente(db) })).resolves.toEqual({
      acao: "erro",
      etapa: "configuracao",
    });
  });

  it("banco que devolve erro: deixa o rastro por agente_evento, só com etapa e código", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: {
        agente_config: {
          data: null,
          error: { message: "permission denied for table 96991112233", code: "42501" },
        },
      },
    });
    expect(await agenteSemDerrubar("c-1", "m-1", { porta: portaDoAgente(db) })).toEqual({
      acao: "erro",
      etapa: "configuracao",
    });
    const rastro = chamadas.find((c) => c.tipo === "rpc" && c.nome === "agente_evento");
    expect(rastro).toMatchObject({
      params: {
        p_conversa_id: "c-1",
        p_mensagem_id: "m-1",
        p_tipo: "erro",
        p_detalhe: { etapa: "configuracao", codigo: "42501" },
      },
    });
    expect(JSON.stringify(rastro)).not.toContain("96991112233");
  });

  it("estouro de tempo: devolve erro de tempo, deixa o rastro e não pendura", async () => {
    vi.useFakeTimers();
    const { db, chamadas } = bancoFalso({});
    const porta = {
      ...portaDoAgente(db),
      estadoDaConfiguracao: () => new Promise<string | null>(() => {}),
    };
    const p = agenteSemDerrubar("c-1", "m-1", { porta, limiteMs: 50, rastroMs: 10 });
    await vi.advanceTimersByTimeAsync(60);
    expect(await p).toEqual({ acao: "erro", etapa: "tempo" });
    expect(chamadas.find((c) => c.tipo === "rpc" && c.nome === "agente_evento")).toMatchObject({
      params: { p_tipo: "erro", p_detalhe: { etapa: "tempo", codigo: "tempo" } },
    });
  });

  it("o teto de tempo cobre o despacho imediato mais a folga do banco", () => {
    expect(TEMPO_LIMITE_DO_AGENTE_MS).toBe(30_000);
  });

  it("falha ao gravar o rastro do erro também não lança", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = bancoFalso({
      tabelas: { agente_config: { data: null, error: { message: "x", code: "42501" } } },
      rpcs: {
        agente_evento: () => {
          throw new Error("banco fora de novo");
        },
      },
    });
    await expect(agenteSemDerrubar("c-1", "m-1", { porta: portaDoAgente(db) })).resolves.toEqual({
      acao: "erro",
      etapa: "configuracao",
    });
  });
});

describe("a porta de verdade fala os nomes de parâmetro do banco", () => {
  it("contexto, registrar e despacho", async () => {
    const { db, chamadas } = bancoFalso({
      rpcs: {
        agente_contexto: () => ({ data: { a: 1 }, error: null }),
        agente_registrar: () => ({ data: { registrado: true }, error: null }),
      },
    });
    const p = portaDoAgente(db);
    expect(await p.lerContexto("c-1", "m-1")).toEqual({ a: 1 });
    expect(await p.registrar("c-1", "m-1", { acao: "barrar", motivo: "robo" })).toEqual({
      registrado: true,
    });
    expect(chamadas[0]).toMatchObject({
      nome: "agente_contexto",
      params: { p_conversa_id: "c-1", p_mensagem_id: "m-1" },
    });
    expect(chamadas[1]).toMatchObject({
      nome: "agente_registrar",
      params: {
        p_conversa_id: "c-1",
        p_mensagem_id: "m-1",
        p_decisao: { acao: "barrar", motivo: "robo" },
      },
    });
    await p.despachar();
    expect(rodadaDoServidor).toHaveBeenCalledWith({ varrer: false });
  });

  it("o quadro é lido por páginas, só o ativo, em ordem total", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: {
        whatsapp_triagem_respostas: {
          data: [{ id: "1", intencao: "parar", frase: "parar", casamento: "igual", passo: null }],
          error: null,
        },
      },
    });
    const q = (await portaDoAgente(db).lerQuadro()) as unknown[];
    expect(q).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      nome: "whatsapp_triagem_respostas",
      metodos: ["select", "eq", "order", "range"],
    });
  });

  it("erro do banco em contexto e registro lança com o código (o orquestrador transforma em erro de etapa)", async () => {
    const { db } = bancoFalso({
      rpcs: {
        agente_contexto: () => ({ data: null, error: { message: "boom", code: "P0001" } }),
        agente_registrar: () => ({ data: null, error: { message: "boom", code: "23514" } }),
      },
    });
    const p = portaDoAgente(db);
    await expect(p.lerContexto("c", "m")).rejects.toMatchObject({ code: "P0001" });
    await expect(p.registrar("c", "m", {})).rejects.toMatchObject({ code: "23514" });
  });
});

describe("a conferência da linha do agente na fila", () => {
  const linha = {
    conversa_id: "c-1",
    payload: { triagem_id: "t-1", agente: true, texto: "x", resposta_id: "r-1", versao: 3 },
  };
  const ok = {
    estado: "teste",
    triagem_liberou: true,
    degrau_permite: true,
    humano: false,
    bloqueado: false,
    resposta_aprovada: true,
  };
  const banco = (conf: Record<string, unknown> | null, tel = "5596999990001") =>
    bancoFalso({
      tabelas: { whatsapp_conversas: { data: { telefone: tel }, error: null } },
      rpcs: {
        agente_conferir_envio: () => ({ data: conf, error: conf ? null : { message: "x" } }),
        agente_evento: () => ({ data: { ok: true }, error: null }),
      },
    });

  it("tudo em ordem: sai", async () => {
    expect(await conferirLinhaDoAgente(linha, banco(ok).db)).toEqual({ acao: "sai", motivo: "ok" });
  });

  it("cada motivo cancela e deixa o evento pausado só com o motivo", async () => {
    for (const [mudanca, motivo] of [
      [{ humano: true }, "humano_na_conversa"],
      [{ degrau_permite: false }, "fora_do_degrau"],
      [{ estado: "desligada" }, "agente_desligado"],
      [{ bloqueado: true }, "bloqueado"],
      [{ triagem_liberou: false }, "triagem_nao_liberou"],
      [{ resposta_aprovada: false }, "resposta_mudou"],
    ] as const) {
      const b = banco({ ...ok, ...mudanca });
      expect(await conferirLinhaDoAgente(linha, b.db)).toEqual({ acao: "cancela", motivo });
      expect(b.chamadas.find((c) => c.nome === "agente_evento")).toMatchObject({
        params: { p_tipo: "pausado", p_detalhe: { motivo } },
      });
    }
  });

  it("manda ao banco a resposta e a versão que a linha carrega, e linha sem elas leva nulo (o banco cancela)", async () => {
    const b = banco(ok);
    await conferirLinhaDoAgente(linha, b.db);
    expect(b.chamadas.find((c) => c.nome === "agente_conferir_envio")).toMatchObject({
      params: { p_conversa_id: "c-1", p_resposta_id: "r-1", p_versao: 3 },
    });
    const semResposta = banco(ok);
    await conferirLinhaDoAgente(
      { conversa_id: "c-1", payload: { triagem_id: "t-1", agente: true } },
      semResposta.db,
    );
    expect(semResposta.chamadas.find((c) => c.nome === "agente_conferir_envio")).toMatchObject({
      params: { p_conversa_id: "c-1", p_resposta_id: null, p_versao: null },
    });
  });

  it("telefone que o robô não alcança cancela", async () => {
    expect(await conferirLinhaDoAgente(linha, banco(ok, "99999999990001@lid").db)).toEqual({
      acao: "cancela",
      motivo: "sem_numero_alcancavel",
    });
  });

  it("não deu para ler: ADIA, não cancela", async () => {
    expect(await conferirLinhaDoAgente(linha, banco(null).db)).toEqual({
      acao: "adia",
      motivo: "leitura_da_conferencia",
    });
    const lanca = {
      rpc: () => {
        throw new Error("x");
      },
      from: () => {
        throw new Error("x");
      },
    } as never;
    expect(await conferirLinhaDoAgente(linha, lanca)).toEqual({ acao: "adia", motivo: "excecao" });
  });

  it("linha sem a marca de agente não é do agente", async () => {
    expect(
      await conferirLinhaDoAgente(
        { conversa_id: "c-1", payload: { triagem_id: "t-1" } },
        banco(ok).db,
      ),
    ).toEqual({ acao: "cancela", motivo: "linha_sem_agente" });
    expect(
      await conferirLinhaDoAgente({ conversa_id: null, payload: { agente: true } }, banco(ok).db),
    ).toEqual({ acao: "cancela", motivo: "linha_sem_agente" });
  });

  it("conferirLinhaDeTriagem entrega a linha com `agente: true` ao agente, sem olhar a triagem", async () => {
    const b = banco(ok);
    expect(await conferirLinhaDeTriagem(linha, b.db)).toEqual({ acao: "sai", motivo: "ok" });
    expect(b.chamadas.some((c) => c.tipo === "from" && c.nome === "whatsapp_triagens")).toBe(false);
    expect(b.chamadas.some((c) => c.nome === "_triagem_degrau_permite")).toBe(false);
  });

  it("a linha da triagem (sem a marca) continua na conferência da triagem", async () => {
    const b = bancoFalso({
      tabelas: {
        whatsapp_triagens: { data: { status: "ativa", modo: "real" }, error: null },
        whatsapp_conversas: { data: { telefone: "5596999990001" }, error: null },
      },
      rpcs: {
        _triagem_degrau_permite: () => ({ data: true, error: null }),
        _triagem_humano_na_conversa: () => ({ data: false, error: null }),
      },
    });
    expect(
      await conferirLinhaDeTriagem({ conversa_id: "c-1", payload: { triagem_id: "t-1" } }, b.db),
    ).toEqual({ acao: "sai", motivo: "ok" });
    expect(b.chamadas.some((c) => c.nome === "agente_conferir_envio")).toBe(false);
  });
});

describe("as ligações no código", () => {
  const enviar = readFileSync("src/lib/api/whatsapp-enviar.server.ts", "utf8");
  const triagem = readFileSync("src/lib/api/whatsapp-triagem.server.ts", "utf8");
  const servidor = readFileSync("src/lib/api/agente-escolhe.server.ts", "utf8");

  it("a rodada do despachante chama a varredura do agente só pelo servidor e sem derrubar", () => {
    const i = enviar.indexOf("varrerAgenteSeLigado");
    expect(i).toBeGreaterThan(0);
    const trecho = enviar.slice(enviar.lastIndexOf("try {", i), enviar.indexOf("catch", i) + 40);
    expect(trecho).toContain("agente-escolhe.server");
    expect(enviar.slice(enviar.lastIndexOf("if (", i), i)).toContain('quem.tipo === "servidor"');
  });

  it("a chave de idempotência da linha do agente começa por triagem:, que o consumidor já deixa passar", () => {
    expect(enviar).toContain("/^(ia|auto|triagem):/");
    const sql = readFileSync(
      "supabase/migrations/20261115100000_agente_escolhe_respostas.sql",
      "utf8",
    );
    expect(sql).toContain("v_chave := 'triagem:' || t.id::text || ':agente:' || m.id::text;");
  });

  it("a conferência da triagem delega ao agente antes de qualquer leitura", () => {
    const i = triagem.indexOf("export async function conferirLinhaDeTriagem");
    const d = triagem.indexOf("agente === true", i);
    const t = triagem.indexOf("whatsapp_triagens", i);
    expect(d).toBeGreaterThan(i);
    expect(d).toBeLessThan(t);
  });

  it("o servidor do agente nunca monta texto: nenhuma chamada a enfileirar, inserir ou escrever mensagem", () => {
    expect(servidor).not.toMatch(
      /whatsapp_ia_enviar|enfileirarMensagem|\.insert\(|\.update\(|\.delete\(|whatsapp_responder/,
    );
    expect(servidor).not.toMatch(/console\.(log|error)\([^)]*(texto|mensagem\b|frase)/);
  });
});
