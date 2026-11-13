import { describe, expect, it, vi } from "vitest";

/**
 * A triagem no servidor (PR B5): a porta de verdade do orquestrador, a conferência da
 * fila e a varredura, com o banco trocado por dublê. O que se segura:
 *   desligada            lê a linha de configuração e nada mais: nenhuma função, nenhuma tabela
 *   banco fora           não lança; devolve erro
 *   tempo                passou do teto: devolve erro de tempo, deixa o rastro e não pendura o webhook; o teto cobre o
 *                        pior caso somado (espera, CEP, despacho e folga do banco)
 *   formato das chamadas os nomes dos parâmetros são os das funções do banco
 *   conferência da fila  gente na conversa ou degrau mais baixo cancela; leitura que falhou adia; a despedida
 *                        (triagem concluída, entregue à equipe ou parada pelo contato) sai; telefone com cara de lid cancela
 *   varredura            só quando a triagem está ligada em algum degrau (ou há conversa aberta para parar)
 */

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/api/cep.server", () => ({
  consultarCepRapido: async (cep: string) => ({
    cep,
    endereco: "Rua A",
    bairro: "Centro",
    cidade: "Macapá",
    estado: "AP",
  }),
}));
vi.mock("@/lib/api/whatsapp-enviar.server", () => ({
  rodadaDoServidor: vi.fn(async () => new Response("{}")),
}));

import {
  assistentePodeFalar,
  cancelarFilaDaTriagem,
  conferirLinhaDeTriagem,
  dentroDoHorarioPeloBanco,
  FOLGA_DO_BANCO_MS,
  TEMPO_LIMITE_DA_TRIAGEM_MS,
  TEMPO_LIMITE_DO_DESPACHO_MS,
  donoDaConversa,
  portaDaTriagem,
  triagemSemDerrubar,
  varrerTriagem,
  varrerTriagemSeLigada,
} from "@/lib/api/whatsapp-triagem.server";
import { CEP_PIOR_CASO_MS, ESPERA_MAXIMA_MS } from "@/domain/whatsapp/triagem/orquestrador";
import { rodadaDoServidor } from "@/lib/api/whatsapp-enviar.server";

type Resp = { data?: unknown; error?: { message?: string; code?: string } | null; count?: number };

function bancoFalso(o: {
  tabelas?: Record<string, Resp | (() => Resp)>;
  rpcs?: Record<string, (params: Record<string, unknown>) => Resp>;
  tabelaLanca?: boolean;
}) {
  const chamadas: {
    tipo: "from" | "rpc";
    nome: string;
    params?: unknown;
    metodos?: string[];
    inserido?: unknown;
  }[] = [];
  const db = {
    from(tabela: string) {
      const c: { tipo: "from"; nome: string; metodos: string[]; inserido?: unknown } = {
        tipo: "from",
        nome: tabela,
        metodos: [],
      };
      chamadas.push(c);
      if (o.tabelaLanca) throw new Error("banco fora");
      const cadeia: Record<string, unknown> = {};
      for (const m of [
        "select",
        "insert",
        "eq",
        "in",
        "maybeSingle",
        "single",
        "gte",
        "order",
        "limit",
      ]) {
        cadeia[m] = (...args: unknown[]) => {
          c.metodos.push(m);
          if (m === "insert") c.inserido = args[0];
          return cadeia;
        };
      }
      cadeia.then = (resolve: (v: unknown) => unknown) => {
        const r = o.tabelas?.[tabela];
        const resp = typeof r === "function" ? r() : (r ?? { data: null, error: null });
        return Promise.resolve(resp).then(resolve);
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

describe("estado de nascença: desligada", () => {
  it("lê a linha de configuração e sai: nenhuma função do banco, nenhuma outra tabela", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: { whatsapp_triagem_config: { data: { estado: "desligada" }, error: null } },
    });
    const r = await triagemSemDerrubar("c-1", "m-1", { porta: portaDaTriagem(db) });
    expect(r).toEqual({ acao: "nada", motivo: "desligada" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ tipo: "from", nome: "whatsapp_triagem_config" });
    expect(chamadas.filter((c) => c.tipo === "rpc")).toEqual([]);
  });
});

describe("nunca derruba o webhook", () => {
  it("banco que lança ao ler a configuração: devolve erro, sem exceção", async () => {
    const { db } = bancoFalso({ tabelaLanca: true });
    await expect(triagemSemDerrubar("c-1", "m-1", { porta: portaDaTriagem(db) })).resolves.toEqual({
      acao: "erro",
      etapa: "configuracao",
    });
  });

  it("banco que devolve erro na leitura: devolve erro e tenta deixar o rastro só com etapa e código", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: {
        whatsapp_triagem_config: {
          data: null,
          error: { message: "permission denied for table 96991112233", code: "42501" },
        },
      },
    });
    const r = await triagemSemDerrubar("c-1", "m-1", { porta: portaDaTriagem(db) });
    expect(r).toEqual({ acao: "erro", etapa: "configuracao" });
    const insercao = chamadas.find(
      (c) => c.tipo === "from" && c.nome === "whatsapp_triagem_eventos",
    );
    expect(insercao).toMatchObject({
      inserido: {
        conversa_id: "c-1",
        mensagem_id: "m-1",
        tipo: "erro",
        detalhe: { etapa: "configuracao", codigo: "42501" },
      },
    });
    expect(JSON.stringify(insercao)).not.toMatch(/9699|permission denied/);
  });

  it("função do banco recusada (GRANT esquecido): erro registrado, nada enfileirado", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: { whatsapp_triagem_config: { data: { estado: "teste" }, error: null } },
      rpcs: {
        triagem_ler_ou_abrir: () => ({
          data: null,
          error: { message: "permission denied for function", code: "42501" },
        }),
      },
    });
    const r = await triagemSemDerrubar("c-1", "m-1", { porta: portaDaTriagem(db) });
    expect(r).toEqual({ acao: "erro", etapa: "ler_ou_abrir" });
    expect(chamadas.some((c) => c.tipo === "rpc" && c.nome === "triagem_aplicar")).toBe(false);
  });

  it("passou do teto de tempo: devolve erro de tempo", async () => {
    const porta = {
      ...portaDaTriagem(bancoFalso({}).db),
      estadoDaConfiguracao: () => new Promise<string | null>(() => {}),
    };
    const r = await triagemSemDerrubar("c-1", "m-1", { porta, limiteMs: 20 });
    expect(r).toEqual({ acao: "erro", etapa: "tempo" });
  });

  it("passou do teto: deixa o rastro com etapa e código tempo, que conta no freio de erros", async () => {
    const registrados: unknown[] = [];
    const porta = {
      ...portaDaTriagem(bancoFalso({}).db),
      estadoDaConfiguracao: () => new Promise<string | null>(() => {}),
      registrarErro: async (a: unknown) => {
        registrados.push(a);
      },
    };
    const r = await triagemSemDerrubar("c-1", "m-1", { porta, limiteMs: 20 });
    expect(r).toEqual({ acao: "erro", etapa: "tempo" });
    expect(registrados).toEqual([
      { conversaId: "c-1", mensagemId: "m-1", etapa: "tempo", codigo: "tempo" },
    ]);
  });

  it("o rastro do estouro também falhando ou travando não segura nem derruba o webhook", async () => {
    const base = {
      ...portaDaTriagem(bancoFalso({}).db),
      estadoDaConfiguracao: () => new Promise<string | null>(() => {}),
    };
    await expect(
      triagemSemDerrubar("c-1", "m-1", {
        porta: {
          ...base,
          registrarErro: async () => {
            throw new Error("o insert também falhou");
          },
        },
        limiteMs: 20,
      }),
    ).resolves.toEqual({ acao: "erro", etapa: "tempo" });
    const inicio = Date.now();
    await expect(
      triagemSemDerrubar("c-1", "m-1", {
        porta: { ...base, registrarErro: () => new Promise<void>(() => {}) },
        limiteMs: 20,
        rastroMs: 40,
      }),
    ).resolves.toEqual({ acao: "erro", etapa: "tempo" });
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it("o teto cobre o pior caso somado: espera, CEP, despacho e a folga do banco", () => {
    expect(TEMPO_LIMITE_DA_TRIAGEM_MS).toBeGreaterThanOrEqual(
      ESPERA_MAXIMA_MS + CEP_PIOR_CASO_MS + TEMPO_LIMITE_DO_DESPACHO_MS,
    );
    expect(FOLGA_DO_BANCO_MS).toBeGreaterThan(0);
    expect(TEMPO_LIMITE_DA_TRIAGEM_MS).toBe(
      ESPERA_MAXIMA_MS + CEP_PIOR_CASO_MS + TEMPO_LIMITE_DO_DESPACHO_MS + FOLGA_DO_BANCO_MS,
    );
  });

  it("o webhook passa se é grupo para o banco", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: { whatsapp_triagem_config: { data: { estado: "teste" }, error: null } },
      rpcs: {
        triagem_ler_ou_abrir: () => ({ data: { dono: "ninguem", motivo: "grupo" }, error: null }),
      },
    });
    const r = await triagemSemDerrubar("c-1", "m-1", { porta: portaDaTriagem(db), ehGrupo: true });
    expect(r).toMatchObject({ acao: "nada", motivo: "grupo", dono: "ninguem" });
    expect(chamadas.find((c) => c.tipo === "rpc")?.params).toEqual({
      p_conversa_id: "c-1",
      p_mensagem_id: "m-1",
      p_contexto: { eh_grupo: true },
    });
  });
});

describe("a porta de verdade fala com as funções do banco pelos nomes certos", () => {
  it("triagem_ler_ou_abrir e triagem_aplicar", async () => {
    const { db, chamadas } = bancoFalso({
      rpcs: {
        triagem_ler_ou_abrir: () => ({ data: { dono: "x" }, error: null }),
        triagem_aplicar: () => ({ data: { ok: true }, error: null }),
      },
    });
    const porta = portaDaTriagem(db);
    await porta.lerOuAbrir("c", "m", { eh_grupo: false });
    await porta.aplicar("t", 3, { estado: {} });
    expect(chamadas).toEqual([
      {
        tipo: "rpc",
        nome: "triagem_ler_ou_abrir",
        params: { p_conversa_id: "c", p_mensagem_id: "m", p_contexto: { eh_grupo: false } },
      },
      {
        tipo: "rpc",
        nome: "triagem_aplicar",
        params: { p_triagem_id: "t", p_versao: 3, p_resultado: { estado: {} } },
      },
    ]);
  });

  it("lê só mensagens de entrada, pelos ids, e usa recebido_em quando existe", async () => {
    const { db, chamadas } = bancoFalso({
      tabelas: {
        whatsapp_mensagens: {
          data: [
            {
              id: "a",
              tipo: "texto",
              texto: "oi",
              legenda: null,
              origem: null,
              recebido_em: "2026-11-16T13:00:00Z",
              created_at: "2026-11-16T13:00:05Z",
            },
            {
              id: "b",
              tipo: "audio",
              texto: null,
              legenda: null,
              origem: "automacao",
              recebido_em: null,
              created_at: "2026-11-16T13:01:00Z",
            },
          ],
          error: null,
        },
      },
    });
    const linhas = await portaDaTriagem(db).lerEntradas(["a", "b"]);
    expect(linhas).toEqual([
      {
        id: "a",
        tipo: "texto",
        texto: "oi",
        legenda: null,
        origem: null,
        recebidaEm: "2026-11-16T13:00:00Z",
      },
      {
        id: "b",
        tipo: "audio",
        texto: null,
        legenda: null,
        origem: "automacao",
        recebidaEm: "2026-11-16T13:01:00Z",
      },
    ]);
    expect(chamadas[0]).toMatchObject({
      nome: "whatsapp_mensagens",
      metodos: ["select", "in", "eq"],
    });
  });

  it("o CEP vira o formato do motor", async () => {
    const e = await portaDaTriagem(bancoFalso({}).db).consultarCep("68900000");
    expect(e).toEqual({
      cep: "68900000",
      rua: "Rua A",
      bairro: "Centro",
      cidade: "Macapá",
      estado: "AP",
    });
  });

  it("despachar pede a rodada sem varrer a triagem de novo", async () => {
    await portaDaTriagem(bancoFalso({}).db).despachar();
    expect(rodadaDoServidor).toHaveBeenCalledWith({ varrer: false });
  });
});

describe("quem manda na conversa", () => {
  it("devolve o texto do banco, ou nulo se a leitura falha", async () => {
    expect(
      await donoDaConversa(
        "c",
        bancoFalso({ rpcs: { triagem_dono_da_conversa: () => ({ data: "triagem", error: null }) } })
          .db,
      ),
    ).toBe("triagem");
    expect(
      await donoDaConversa(
        "c",
        bancoFalso({
          rpcs: { triagem_dono_da_conversa: () => ({ data: null, error: { message: "x" } }) },
        }).db,
      ),
    ).toBeNull();
    expect(
      await donoDaConversa(
        "c",
        bancoFalso({ rpcs: { triagem_dono_da_conversa: () => ({ data: { a: 1 }, error: null }) } })
          .db,
      ),
    ).toBeNull();
    expect(
      await donoDaConversa("c", {
        rpc: () => {
          throw new Error("fora");
        },
      } as never),
    ).toBeNull();
  });

  it("a assistente só fala quando o dono é ela", async () => {
    const dono = (v: unknown) =>
      bancoFalso({ rpcs: { triagem_dono_da_conversa: () => ({ data: v, error: null }) } }).db;
    expect((await assistentePodeFalar("c", dono("assistente"))).pode).toBe(true);
    expect((await assistentePodeFalar("c", dono("triagem"))).pode).toBe(false);
    expect((await assistentePodeFalar("c", dono("ninguem"))).pode).toBe(false);
    expect((await assistentePodeFalar("c", dono(null))).pode).toBe(false);
  });

  it("o horário pela função única; resposta que não é verdadeiro ou falso vira nulo", async () => {
    const h = (v: unknown, erro = false) =>
      bancoFalso({
        rpcs: {
          whatsapp_dentro_do_horario: () => ({ data: v, error: erro ? { message: "x" } : null }),
        },
      }).db;
    const agora = new Date("2026-11-16T13:00:00Z");
    expect(await dentroDoHorarioPeloBanco(agora, h(true))).toBe(true);
    expect(await dentroDoHorarioPeloBanco(agora, h(false))).toBe(false);
    expect(await dentroDoHorarioPeloBanco(agora, h("sim"))).toBeNull();
    expect(await dentroDoHorarioPeloBanco(agora, h(true, true))).toBeNull();
  });
});

describe("conferência da fila antes de despachar uma pergunta de triagem", () => {
  const linha = { conversa_id: "c-1", payload: { triagem_id: "t-1", tipo: "texto", texto: "x" } };
  function banco(o: {
    triagem?: Resp;
    degrau?: unknown;
    humano?: unknown;
    erroDegrau?: boolean;
    erroHumano?: boolean;
    telefone?: string | null;
    conversa?: Resp;
  }) {
    return bancoFalso({
      tabelas: {
        whatsapp_triagens: o.triagem ?? { data: { status: "ativa", modo: "real" }, error: null },
        whatsapp_conversas: o.conversa ?? {
          data: { telefone: o.telefone === undefined ? "96991112233" : o.telefone },
          error: null,
        },
      },
      rpcs: {
        _triagem_degrau_permite: () => ({
          data: o.degrau ?? true,
          error: o.erroDegrau ? { message: "x" } : null,
        }),
        _triagem_humano_na_conversa: () => ({
          data: o.humano ?? false,
          error: o.erroHumano ? { message: "x" } : null,
        }),
      },
    });
  }

  it("triagem ativa, sem gente, degrau permite: sai", async () => {
    expect(await conferirLinhaDeTriagem(linha, banco({}).db)).toEqual({
      acao: "sai",
      motivo: "ok",
    });
  });

  it("a despedida sai: triagem concluída, entregue à equipe ou parada pelo contato", async () => {
    for (const status of ["concluida", "entregue_equipe", "parada_pelo_contato"]) {
      const b = banco({ triagem: { data: { status, modo: "real" }, error: null } });
      expect(await conferirLinhaDeTriagem(linha, b.db), status).toEqual({
        acao: "sai",
        motivo: "ok_despedida",
      });
    }
  });

  it("a despedida cancela se a equipe entrou ou o degrau desceu", async () => {
    const t = { data: { status: "concluida", modo: "real" }, error: null };
    expect(await conferirLinhaDeTriagem(linha, banco({ triagem: t, humano: true }).db)).toEqual({
      acao: "cancela",
      motivo: "humano_na_conversa",
    });
    expect(await conferirLinhaDeTriagem(linha, banco({ triagem: t, degrau: false }).db)).toEqual({
      acao: "cancela",
      motivo: "fora_do_degrau",
    });
  });

  it("pausada, pulada, expirada e ensaio cancelam", async () => {
    for (const status of ["pausada_humano", "pausada_desligada", "pulada", "expirada"]) {
      const r = await conferirLinhaDeTriagem(
        linha,
        banco({ triagem: { data: { status, modo: "real" }, error: null } }).db,
      );
      expect(r, status).toEqual({ acao: "cancela", motivo: `triagem_${status}` });
    }
    const e = await conferirLinhaDeTriagem(
      linha,
      banco({ triagem: { data: { status: "ensaio", modo: "ensaio" }, error: null } }).db,
    );
    expect(e.acao).toBe("cancela");
  });

  it("telefone com cara de lid cancela, deixa o evento pulou e nunca deixa sair", async () => {
    for (const telefone of ["253386293268636", "253386293268636@lid", "447700900123", null]) {
      for (const status of ["ativa", "concluida", "entregue_equipe"]) {
        const b = banco({ telefone, triagem: { data: { status, modo: "real" }, error: null } });
        const r = await conferirLinhaDeTriagem(linha, b.db);
        expect(r, `${telefone} ${status}`).toEqual({ acao: "cancela", motivo: "sem_numero_alcancavel" });
        const insercao = b.chamadas.find((c) => c.tipo === "from" && c.nome === "whatsapp_triagem_eventos");
        expect(insercao).toMatchObject({
          inserido: {
            triagem_id: "t-1",
            conversa_id: "c-1",
            tipo: "pulou",
            detalhe: { motivo: "sem_numero_alcancavel" },
          },
        });
        expect(JSON.stringify(insercao)).not.toMatch(/2533|4477/);
      }
    }
  });

  it("celular brasileiro com ou sem 55 não é barrado", async () => {
    for (const telefone of ["96991112233", "5596991112233"]) {
      expect((await conferirLinhaDeTriagem(linha, banco({ telefone }).db)).acao).toBe("sai");
    }
  });

  it("não deu para ler a conversa: adia", async () => {
    expect(
      (await conferirLinhaDeTriagem(linha, banco({ conversa: { data: null, error: { message: "x" } } }).db)).acao,
    ).toBe("adia");
  });

  it("a equipe respondeu entre enfileirar e enviar: cancela", async () => {
    expect(await conferirLinhaDeTriagem(linha, banco({ humano: true }).db)).toEqual({
      acao: "cancela",
      motivo: "humano_na_conversa",
    });
  });

  it("a escada desceu: cancela", async () => {
    expect(await conferirLinhaDeTriagem(linha, banco({ degrau: false }).db)).toEqual({
      acao: "cancela",
      motivo: "fora_do_degrau",
    });
  });

  it("a triagem parou ou sumiu: cancela", async () => {
    expect(
      (
        await conferirLinhaDeTriagem(
          linha,
          banco({ triagem: { data: { status: "pausada_humano", modo: "real" }, error: null } }).db,
        )
      ).acao,
    ).toBe("cancela");
    expect(
      (await conferirLinhaDeTriagem(linha, banco({ triagem: { data: null, error: null } }).db))
        .motivo,
    ).toBe("triagem_nao_existe");
  });

  it("não deu para ler: adia, não cancela e não envia", async () => {
    expect(
      (
        await conferirLinhaDeTriagem(
          linha,
          banco({ triagem: { data: null, error: { message: "x" } } }).db,
        )
      ).acao,
    ).toBe("adia");
    expect((await conferirLinhaDeTriagem(linha, banco({ erroDegrau: true }).db)).acao).toBe("adia");
    expect((await conferirLinhaDeTriagem(linha, banco({ erroHumano: true }).db)).acao).toBe("adia");
    expect(
      (
        await conferirLinhaDeTriagem(linha, {
          from: () => {
            throw new Error("fora");
          },
        } as never)
      ).acao,
    ).toBe("adia");
  });

  it("linha sem triagem_id ou sem conversa não sai", async () => {
    expect(
      (await conferirLinhaDeTriagem({ conversa_id: "c", payload: {} }, banco({}).db)).acao,
    ).toBe("cancela");
    expect(
      (
        await conferirLinhaDeTriagem(
          { conversa_id: null, payload: { triagem_id: "t" } },
          banco({}).db,
        )
      ).acao,
    ).toBe("cancela");
  });

  it("pergunta ao banco com os nomes certos", async () => {
    const b = banco({});
    await conferirLinhaDeTriagem(linha, b.db);
    expect(b.chamadas.filter((c) => c.tipo === "rpc")).toEqual([
      {
        tipo: "rpc",
        nome: "_triagem_degrau_permite",
        params: { p_conversa: "c-1", p_modo: "real" },
      },
      { tipo: "rpc", nome: "_triagem_humano_na_conversa", params: { p_conversa: "c-1" } },
    ]);
  });

  it("cancelar usa a função do banco, que também apaga a mensagem que nunca saiu", async () => {
    const b = bancoFalso({
      rpcs: { _triagem_cancelar_pendentes: () => ({ data: 2, error: null }) },
    });
    expect(await cancelarFilaDaTriagem("c-1", b.db)).toBe(2);
    expect(b.chamadas[0]).toEqual({
      tipo: "rpc",
      nome: "_triagem_cancelar_pendentes",
      params: { p_conversa: "c-1" },
    });
    await expect(
      cancelarFilaDaTriagem(
        "c-1",
        bancoFalso({
          rpcs: { _triagem_cancelar_pendentes: () => ({ data: null, error: { message: "x" } }) },
        }).db,
      ),
    ).rejects.toThrow();
  });
});

describe("a varredura só roda com a triagem ligada", () => {
  function comConfig(estado: string | null, abertas: unknown[] = [], erroConfig = false) {
    return bancoFalso({
      tabelas: {
        whatsapp_triagem_config: erroConfig
          ? { data: null, error: { message: "x" } }
          : { data: estado === null ? null : { estado }, error: null },
        whatsapp_triagens: { data: abertas, error: null },
      },
      rpcs: { triagem_varrer: () => ({ data: { expiradas: 1 }, error: null }) },
    });
  }
  const chamouVarrer = (c: { tipo: string; nome: string }[]) =>
    c.some((x) => x.tipo === "rpc" && x.nome === "triagem_varrer");

  it("desligada e sem conversa aberta: não chama o banco para varrer", async () => {
    const b = comConfig("desligada");
    expect(await varrerTriagemSeLigada(b.db)).toEqual({ pulada: true, motivo: "desligada" });
    expect(chamouVarrer(b.chamadas)).toBe(false);
  });

  it("sem linha de configuração: também não varre", async () => {
    const b = comConfig(null);
    expect(await varrerTriagemSeLigada(b.db)).toEqual({ pulada: true, motivo: "sem_configuracao" });
    expect(chamouVarrer(b.chamadas)).toBe(false);
  });

  it("desligada com conversa aberta: varre para parar o que ficou aberto", async () => {
    const b = comConfig("desligada", [{ id: "t-1" }]);
    expect(await varrerTriagemSeLigada(b.db)).toEqual({ expiradas: 1 });
    expect(chamouVarrer(b.chamadas)).toBe(true);
  });

  it("ensaio, teste, parcial e ligada: varre", async () => {
    for (const estado of ["ensaio", "teste", "parcial", "ligada"]) {
      const b = comConfig(estado);
      expect(await varrerTriagemSeLigada(b.db), estado).toEqual({ expiradas: 1 });
      expect(chamouVarrer(b.chamadas), estado).toBe(true);
    }
  });

  it("estado ilegível ou banco que lança: varre, e nunca lança", async () => {
    expect(chamouVarrer(await (async () => { const b = comConfig(null, [], true); await varrerTriagemSeLigada(b.db); return b.chamadas; })())).toBe(true);
    await expect(
      varrerTriagemSeLigada({
        from: () => {
          throw new Error("fora");
        },
        rpc: () => {
          throw new Error("fora");
        },
      } as never),
    ).resolves.toEqual({ erro: true });
  });
});

describe("a varredura nunca lança", () => {
  it("devolve o que o banco devolveu", async () => {
    const b = bancoFalso({
      rpcs: { triagem_varrer: () => ({ data: { expiradas: 2 }, error: null }) },
    });
    expect(await varrerTriagem(b.db)).toEqual({ expiradas: 2 });
    expect(b.chamadas[0]).toEqual({ tipo: "rpc", nome: "triagem_varrer", params: {} });
  });
  it("erro do banco ou exceção viram { erro: true }", async () => {
    expect(
      await varrerTriagem(
        bancoFalso({
          rpcs: { triagem_varrer: () => ({ data: null, error: { message: "x", code: "42501" } }) },
        }).db,
      ),
    ).toEqual({ erro: true });
    expect(
      await varrerTriagem({
        rpc: () => {
          throw new Error("fora");
        },
      } as never),
    ).toEqual({ erro: true });
  });
});
