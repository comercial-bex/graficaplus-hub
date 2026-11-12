import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CABECALHO_DO_DESPACHANTE } from "../src/domain/whatsapp/despachante";

/**
 * SERVIDOR da cobrança: rota POST /api/whatsapp/cobrar e a rodada (whatsapp-cobranca.server.ts),
 * com banco falso. A REGRA (src/domain/whatsapp/cobranca.ts) é trocada aqui por um dublê simples
 * de propósito: este arquivo prende o que o SERVIDOR faz com a decisão (quando lê, o que registra,
 * a trava do destino); o comportamento da regra é preso em tests/whatsapp-cobranca.test.ts.
 *
 * Dados inventados: nenhum telefone nem nome de cliente real.
 */

const banco = vi.hoisted(() => {
  const estado = {
    chamadas: [] as { tabela: string; metodo: string; args?: unknown }[],
    respostas: new Map<string, unknown>(),
    /** resposta por chamada para um RPC (fila: a primeira chamada leva a primeira) */
    filas: new Map<string, unknown[]>(),
    responder(tabela: string, resposta: unknown) {
      estado.respostas.set(tabela, resposta);
    },
    from(tabela: string) {
      const cadeia: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "eq", "lt", "lte", "or", "order", "limit", "maybeSingle", "in", "single"]) {
        cadeia[m] = (args?: unknown) => {
          estado.chamadas.push({ tabela, metodo: m, args });
          return cadeia;
        };
      }
      cadeia.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(estado.respostas.get(tabela) ?? { data: null, error: null }).then(resolve, reject);
      return cadeia;
    },
    rpc(nome: string, args?: unknown) {
      const chave = `rpc:${nome}`;
      estado.chamadas.push({ tabela: chave, metodo: "rpc", args });
      const fila = estado.filas.get(chave);
      if (fila && fila.length > 0) return Promise.resolve(fila.shift());
      return Promise.resolve(estado.respostas.get(chave) ?? { data: null, error: null });
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => banco.from(tabela),
    rpc: (nome: string, args?: unknown) => banco.rpc(nome, args),
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "sem sessão" } }) },
  },
}));

// A rota: createFileRoute devolve as opções, e o teste chama o handler POST como o servidor chamaria.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opcoes: unknown) => ({ options: opcoes }),
}));

/** Dublê da regra: "dentro do horário" e "cobra quem tem numero COBRA-*" controlados pelo teste. */
const regra = vi.hoisted(() => ({ dentro: true, lancar: false }));
vi.mock("@/domain/whatsapp/cobranca", () => {
  const configDaCobranca = (l: Record<string, any>) => {
    const modo = ["desligada", "ensaio", "ligada"].includes(l.cobranca_modo) ? l.cobranca_modo : "desligada";
    const grupo = (l.grupo_equipe_id ?? "").trim();
    return {
      modo,
      minPedido: l.cobranca_min_pedido,
      minOrcamento: l.cobranca_min_orcamento,
      minGestor: l.cobranca_min_gestor,
      horario: { inicio: "08:00", fim: "18:00", dias: [1, 2, 3, 4, 5], sabado: false, sabadoFim: "12:00" },
      ligadaEm: l.cobranca_ligada_em ? new Date(l.cobranca_ligada_em) : null,
      ensaioDesde: l.cobranca_ensaio_desde ? new Date(l.cobranca_ensaio_desde) : null,
      grupoDestino: l.grupo_equipe_ativo && /^\d{10,}-group$/.test(grupo) ? grupo : null,
    };
  };
  return {
    configDaCobranca,
    corteDaCobranca: (cfg: any) => (cfg.modo === "ligada" ? cfg.ligadaEm : cfg.modo === "ensaio" ? cfg.ensaioDesde : null),
    dentroDoHorarioUtil: () => regra.dentro,
    decidirCobranca: (p: any) => {
      if (regra.lancar) throw new Error("regra quebrada");
      return p.numero.startsWith("COBRA")
        ? { cobrar: true, nivel: 1, motivo: "pedido_sem_orcamento", minutosUteis: 250, orcamento: null, pedidoEm: p.abertoEm }
        : { cobrar: false, motivo: "ainda_no_prazo" };
    },
    numeroParaMencao: (t: any) => {
      const d = String(t ?? "").replace(/\D/g, "");
      return d.length >= 10 ? (d.startsWith("55") ? d : `55${d}`) : null;
    },
    quemCitar: (p: any) => [{ id: `pessoa-${p.atendimentoId}`, nome: "Ana", papel: "responsavel", mencao: "5596991112233" }],
    agruparNaAbertura: (itens: any[], minimo = 4) =>
      itens.length >= minimo
        ? [{ texto: `${itens.length} orçamentos pendentes`, mencionar: ["5596991112233"], itens, agrupada: true }]
        : itens.map((i) => ({ texto: `Orçamento pendente ${i.pendencia.numero}`, mencionar: ["5596991112233"], itens: [i], agrupada: false })),
  };
});

import { Route } from "../src/routes/api.whatsapp.cobrar";
import { DESTINO_RECUSADO, rodadaDeCobranca } from "../src/lib/api/whatsapp-cobranca.server";

const TOKEN = "um-token-que-so-o-teste-conhece-cobranca-123456";
const GRUPO = "120363000000000001-group";
const AGORA = new Date("2026-11-12T14:00:00.000Z"); // quinta, 11h em Macapá
const CORTE = "2026-11-10T12:00:00.000Z";

const CONFIG = "whatsapp_configuracoes";
const PENDENCIAS = "rpc:whatsapp_cobranca_pendencias";
const EQUIPE = "rpc:whatsapp_cobranca_equipe";
const REGISTRAR = "rpc:whatsapp_cobranca_registrar";

function configuracao(extra: Record<string, unknown> = {}) {
  return {
    horario_inicio: "08:00:00",
    horario_fim: "18:00:00",
    dias_semana: [1, 2, 3, 4, 5],
    grupo_equipe_id: GRUPO,
    grupo_equipe_ativo: true,
    cobranca_modo: "ensaio",
    cobranca_min_pedido: 240,
    cobranca_min_orcamento: 120,
    cobranca_min_gestor: 240,
    cobranca_sabado: false,
    cobranca_sabado_fim: "12:00:00",
    cobranca_ligada_em: CORTE,
    cobranca_ensaio_desde: CORTE,
    ...extra,
  };
}

function pendencia(numero: string, i = 0) {
  return {
    atendimento_id: `00000000-0000-4000-8000-00000000000${i}`,
    numero,
    conversa_id: `10000000-0000-4000-8000-00000000000${i}`,
    aberto_em: "2026-11-11T12:00:00.000Z",
    fechado_em: null,
    fila: "comercial",
    conversa_status: "aberta",
    resp_atendimento_id: null,
    resp_conversa_id: null,
    cliente_nome: "Cliente Inventado",
    pediu_por_palavra_em: "2026-11-11T12:05:00.000Z",
    pediu_por_marca_em: null,
    orcamentos: [],
    envios_na_conversa: [],
    dispensado_em: null,
    lead_status: null,
    cobrancas: [],
  };
}

const chamou = (tabela: string) => banco.chamadas.filter((c) => c.tabela === tabela);

let silencio: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  banco.chamadas.length = 0;
  banco.respostas.clear();
  banco.filas.clear();
  regra.dentro = true;
  regra.lancar = false;
  vi.unstubAllEnvs();
  vi.stubEnv("DESPACHANTE_TOKEN", TOKEN);
  silencio = vi.spyOn(console, "error").mockImplementation(() => {});
  banco.responder(CONFIG, { data: configuracao(), error: null });
  banco.responder(PENDENCIAS, { data: [], error: null });
  banco.responder(EQUIPE, { data: [], error: null });
  banco.responder(REGISTRAR, { data: { registrada: true, motivo: null }, error: null });
});

afterEach(() => {
  silencio.mockRestore();
  vi.unstubAllEnvs();
});

function pedir(token?: string): Promise<Response> {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set(CABECALHO_DO_DESPACHANTE, token);
  const post = (Route as any).options.server.handlers.POST as (a: { request: Request }) => Promise<Response>;
  return post({ request: new Request("https://print.exemplo/api/whatsapp/cobrar", { method: "POST", headers, body: "{}" }) });
}

describe("a porta", () => {
  it("sem token ou token errado: 401 e nada é lido", async () => {
    for (const errado of [undefined, "", "outro-token", TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const r = await pedir(errado);
      expect(r.status, String(errado)).toBe(401);
      const corpo = await r.json();
      expect(corpo).toEqual({ ok: false, erro: "token inválido" });
      expect(JSON.stringify(corpo)).not.toContain(TOKEN);
    }
    expect(banco.chamadas).toEqual([]);
  });

  it("sem token configurado no servidor nem no Vault: 401, e só pergunta ao banco se há segredo", async () => {
    vi.stubEnv("DESPACHANTE_TOKEN", "");
    banco.responder("rpc:whatsapp_despachante_token_situacao", { data: "sem_segredo", error: null });
    expect((await pedir(TOKEN)).status).toBe(401);
    expect(banco.chamadas.map((c) => c.tabela)).toEqual(["rpc:whatsapp_despachante_token_situacao"]);
  });

  it("token certo: roda a rodada e responde o resultado", async () => {
    const r = await pedir(TOKEN);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: true, modo: "ensaio" });
    expect(chamou(CONFIG).length).toBeGreaterThan(0);
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
    expect(JSON.stringify(silencio.mock.calls)).not.toContain(TOKEN);
  });

  it("a rodada lançou: 500 com o erro", async () => {
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1)], error: null });
    regra.lancar = true;
    const r = await pedir(TOKEN);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, erro: "regra quebrada" });
  });

  it("linha com data quebrada vira erro da rodada (ok false), sem derrubar a rota", async () => {
    banco.responder(PENDENCIAS, { data: [{ ...pendencia("COBRA-1"), aberto_em: "isto não é data" }], error: null });
    const r = await pedir(TOKEN);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.ok).toBe(false);
    expect(chamou(REGISTRAR)).toEqual([]);
  });
});

describe("a rodada", () => {
  it("desligada: não lê pendências nem equipe", async () => {
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "desligada" }), error: null });
    const r = await rodadaDeCobranca(AGORA);
    expect(r).toMatchObject({ ok: true, modo: "desligada", parada: "desligada", registrados: 0 });
    expect(chamou(PENDENCIAS)).toEqual([]);
    expect(chamou(EQUIPE)).toEqual([]);
    expect(chamou(REGISTRAR)).toEqual([]);
  });

  it("modo desconhecido vira desligada (a regra decide) e nada é lido", async () => {
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "turbo" }), error: null });
    const r = await rodadaDeCobranca(AGORA);
    expect(r.parada).toBe("desligada");
    expect(chamou(PENDENCIAS)).toEqual([]);
  });

  it("fora do horário: não lê pendências nem decide", async () => {
    regra.dentro = false;
    const r = await rodadaDeCobranca(AGORA);
    expect(r).toMatchObject({ ok: true, parada: "fora_do_horario" });
    expect(chamou(PENDENCIAS)).toEqual([]);
    expect(chamou(REGISTRAR)).toEqual([]);
  });

  it("erro ao ler a configuração: erro, nunca 'desligada'", async () => {
    banco.responder(CONFIG, { data: null, error: { message: "permission denied" } });
    const r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
    expect(r.parada).toBeNull();
    expect(r.erros.join(" ")).toContain("permission denied");
  });

  it("ensaio: registra com p_modo 'ensaio' e os cinco parâmetros", async () => {
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1), pendencia("ESPERA-2", 2)], error: null });
    const r = await rodadaDeCobranca(AGORA);
    expect(r).toMatchObject({ ok: true, modo: "ensaio", pendencias: 2, registrados: 1, naoCobradas: { ainda_no_prazo: 1 } });
    expect(chamou(PENDENCIAS)[0].args).toEqual({ p_desde: CORTE });
    const [registro] = chamou(REGISTRAR);
    const args = registro.args as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_agrupada", "p_itens", "p_mencionar", "p_modo", "p_texto"]);
    expect(args.p_modo).toBe("ensaio");
    expect(args.p_agrupada).toBe(false);
    expect(args.p_itens).toEqual([
      {
        atendimento_id: "00000000-0000-4000-8000-000000000001",
        conversa_id: "10000000-0000-4000-8000-000000000001",
        orcamento_id: null,
        nivel: 1,
        motivo: "pedido_sem_orcamento",
        minutos_uteis: 250,
        // sem o telefone da pessoa: o histórico guarda só id, nome, papel e se faltava telefone
        citados: [{ id: "pessoa-00000000-0000-4000-8000-000000000001", nome: "Ana", papel: "responsavel", sem_telefone: false }],
      },
    ]);
  });

  it("nenhum parâmetro de destino: quem escolhe o destino é o banco (grupo_equipe_destino)", async () => {
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "ligada" }), error: null });
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1)], error: null });
    await rodadaDeCobranca(AGORA);
    const args = chamou(REGISTRAR)[0].args as Record<string, unknown>;
    expect(args.p_modo).toBe("ligada");
    expect(JSON.stringify(args)).not.toContain(GRUPO);
    expect(Object.keys(args).some((k) => /destino|destinatario|telefone|phone/.test(k))).toBe(false);
  });

  it("trava: no ligada, grupo que não casa ^\\d{10,}-group$ ou desligado recusa a rodada inteira", async () => {
    const casos: Record<string, unknown>[] = [
      { grupo_equipe_id: "5596991112233" },
      { grupo_equipe_id: "96991112233" },
      { grupo_equipe_id: "" },
      { grupo_equipe_id: null },
      { grupo_equipe_id: "120363000000000001-group-x" },
      { grupo_equipe_id: "abc-group" },
      { grupo_equipe_ativo: false },
    ];
    for (const caso of casos) {
      banco.chamadas.length = 0;
      banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "ligada", ...caso }), error: null });
      banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1)], error: null });
      const r = await rodadaDeCobranca(AGORA);
      expect(r.ok, JSON.stringify(caso)).toBe(false);
      expect(r.erros, JSON.stringify(caso)).toEqual([DESTINO_RECUSADO]);
      expect(chamou(REGISTRAR), JSON.stringify(caso)).toEqual([]);
      expect(chamou(PENDENCIAS), JSON.stringify(caso)).toEqual([]);
    }
  });

  it("trava: no ensaio o grupo errado não impede o registro (nada sai do banco no ensaio)", async () => {
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "ensaio", grupo_equipe_id: "5596991112233" }), error: null });
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1)], error: null });
    const r = await rodadaDeCobranca(AGORA);
    expect(r.registrados).toBe(1);
    expect((chamou(REGISTRAR)[0].args as any).p_modo).toBe("ensaio");
  });

  it("sem data de corte: diz que parou, não pede pendências com p_desde nulo", async () => {
    banco.responder(CONFIG, { data: configuracao({ cobranca_ensaio_desde: null }), error: null });
    const r = await rodadaDeCobranca(AGORA);
    expect(r).toMatchObject({ ok: true, parada: "sem_corte" });
    expect(chamou(PENDENCIAS)).toEqual([]);
  });

  it("grava como a rodada terminou: falha vira ok:false com o erro; desligada sem erro não grava", async () => {
    const GRAVAR = "rpc:whatsapp_cobranca_rodada_gravar";
    // falha de leitura das pendências
    banco.responder(PENDENCIAS, { data: null, error: { message: "timeout" } });
    let r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
    expect(chamou(GRAVAR)).toHaveLength(1);
    expect(chamou(GRAVAR)[0].args).toMatchObject({ p_ok: false });
    expect(String((chamou(GRAVAR)[0].args as any).p_erro)).toContain("pendências");

    // grupo recusado no modo ligada: erro gravado
    banco.chamadas.length = 0;
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "ligada", grupo_equipe_ativo: false }), error: null });
    r = await rodadaDeCobranca(AGORA);
    expect(chamou(GRAVAR)[0].args).toMatchObject({ p_ok: false, p_erro: DESTINO_RECUSADO });

    // rodada boa: p_ok true, sem erro
    banco.chamadas.length = 0;
    banco.responder(CONFIG, { data: configuracao(), error: null });
    banco.responder(PENDENCIAS, { data: [], error: null });
    r = await rodadaDeCobranca(AGORA);
    expect(chamou(GRAVAR)[0].args).toEqual({ p_ok: true, p_parada: null, p_erro: null });

    // fora do horário também grava (mostra que o job está vivo)
    banco.chamadas.length = 0;
    regra.dentro = false;
    try {
      r = await rodadaDeCobranca(AGORA);
    } finally {
      regra.dentro = true;
    }
    expect(chamou(GRAVAR)[0].args).toEqual({ p_ok: true, p_parada: "fora_do_horario", p_erro: null });

    // desligada e sem erro: nada a gravar
    banco.chamadas.length = 0;
    banco.responder(CONFIG, { data: configuracao({ cobranca_modo: "desligada" }), error: null });
    await rodadaDeCobranca(AGORA);
    expect(chamou(GRAVAR)).toEqual([]);

    // falha ao gravar o resultado não derruba a rodada
    banco.chamadas.length = 0;
    banco.responder(CONFIG, { data: configuracao(), error: null });
    banco.responder(PENDENCIAS, { data: [], error: null });
    banco.responder(GRAVAR, { data: null, error: { message: "sem permissão" } });
    r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(true);
  });

  it("deduplicação: 'ja_registrada' do banco conta à parte e não é erro", async () => {
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1), pendencia("COBRA-2", 2)], error: null });
    banco.filas.set(REGISTRAR, [
      { data: { registrada: false, motivo: "ja_registrada" }, error: null },
      { data: { registrada: true, motivo: null, fila_id: null, cobrancas: 1 }, error: null },
    ]);
    const r = await rodadaDeCobranca(AGORA);
    expect(r).toMatchObject({ ok: true, registrados: 1, jaRegistrados: 1, erros: [] });
  });

  it("modo mudou no meio da rodada: para sem registrar o resto", async () => {
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1), pendencia("COBRA-2", 2)], error: null });
    banco.filas.set(REGISTRAR, [{ data: { registrada: false, motivo: "modo_mudou" }, error: null }]);
    const r = await rodadaDeCobranca(AGORA);
    expect(r.parada).toBe("modo_mudou");
    expect(chamou(REGISTRAR)).toHaveLength(1);
  });

  it("erro ao registrar um envio vai para erros e o próximo segue", async () => {
    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1), pendencia("COBRA-2", 2)], error: null });
    banco.filas.set(REGISTRAR, [{ data: null, error: { message: "cobrança recusada: o destino não é o grupo da equipe" } }]);
    const r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
    expect(r.registrados).toBe(1);
    expect(r.erros.join(" ")).toContain("COBRA-1");
    expect(chamou(REGISTRAR)).toHaveLength(2);
  });

  it("4 vencendo juntas: um registro agrupado com os 4 itens", async () => {
    banco.responder(PENDENCIAS, {
      data: [1, 2, 3, 4].map((i) => pendencia(`COBRA-${i}`, i)),
      error: null,
    });
    const r = await rodadaDeCobranca(AGORA);
    expect(r.registrados).toBe(1);
    const registros = chamou(REGISTRAR);
    expect(registros).toHaveLength(1);
    const args = registros[0].args as any;
    expect(args.p_agrupada).toBe(true);
    expect(args.p_itens).toHaveLength(4);
  });

  it("3 vencendo juntas: três registros", async () => {
    banco.responder(PENDENCIAS, { data: [1, 2, 3].map((i) => pendencia(`COBRA-${i}`, i)), error: null });
    await rodadaDeCobranca(AGORA);
    expect(chamou(REGISTRAR)).toHaveLength(3);
  });

  it("falha do banco nas pendências ou na equipe aparece como erro, nunca como zero pendências", async () => {
    banco.responder(PENDENCIAS, { data: null, error: { message: "function does not exist" } });
    let r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("pendências");
    expect(chamou(REGISTRAR)).toEqual([]);

    banco.responder(PENDENCIAS, { data: [pendencia("COBRA-1", 1)], error: null });
    banco.responder(EQUIPE, { data: null, error: { message: "timeout" } });
    r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("equipe");
    expect(chamou(REGISTRAR)).toEqual([]);

    banco.responder(EQUIPE, { data: [], error: null });
    banco.responder(PENDENCIAS, { data: null, error: null });
    r = await rodadaDeCobranca(AGORA);
    expect(r.ok).toBe(false);
  });
});

describe("os arquivos do servidor", () => {
  const rota = readFileSync("src/routes/api.whatsapp.cobrar.ts", "utf8");
  const servidor = readFileSync("src/lib/api/whatsapp-cobranca.server.ts", "utf8");

  it("a rota importa o .server dentro do handler e só tem POST", () => {
    const estaticos = [...rota.matchAll(/^import\s[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(estaticos).toEqual(["@tanstack/react-router"]);
    expect(rota).toMatch(/await import\("@\/lib\/api\/whatsapp-enviar\.server"\)/);
    expect(rota).toMatch(/await import\("@\/lib\/api\/whatsapp-cobranca\.server"\)/);
    expect(rota).toMatch(/tokenDoServidorConfere\(request\)/);
    expect(rota).not.toMatch(/\bGET\s*:\s*async/);
  });

  it("a rodada não fala com o Z-API nem escolhe destino", () => {
    expect(servidor).not.toMatch(/api\.z-api\.io|fetch\(|send-text|montarEnvio/);
    expect(servidor).not.toMatch(/p_destino|p_destinatario|enfileirar_notificacao/);
  });
});

/**
 * O CONSUMIDOR da fila de avisos (processarAvisosAoCliente, pela rodada do despachante) com o
 * banco falso e o fetch trocado: nada sai para a rede. Prende a passagem de `variaveis.mencionar`
 * para o `mentioned` e a TERCEIRA trava (cobranca_orcamento só para grupo).
 */
describe("o consumidor da fila passa a menção", () => {
  type Pedido = { url: string; corpo: Record<string, unknown> };
  let pedidos: Pedido[] = [];

  function linhaDaFila(
    destinatario: string,
    variaveis: Record<string, unknown>,
    evento = "cobranca_orcamento",
    template = evento,
  ) {
    return {
      id: "20000000-0000-4000-8000-000000000001",
      canal: "whatsapp",
      destinatario,
      evento,
      template,
      variaveis,
      tentativas: 0,
      max_tentativas: 5,
      created_at: AGORA.toISOString(),
    };
  }

  async function despachar(linha: ReturnType<typeof linhaDaFila>) {
    vi.stubEnv("ZAPI_TOKEN", "zapi-token-do-teste");
    vi.stubEnv("ZAPI_CLIENT_TOKEN", "");
    banco.responder("whatsapp_instancias", { data: { id: "inst-1", zapi_instance_id: "INST", conectado: true }, error: null });
    banco.responder(CONFIG, { data: configuracao(), error: null });
    banco.responder(EQUIPE, {
      data: [
        { id: "p1", nome: "Ana", telefone: "(96) 99111-2233", papeis: ["vendedor"] },
        { id: "p2", nome: "Bruno", telefone: "(96) 99444-5566", papeis: ["gestor"] },
      ],
      error: null,
    });
    banco.responder("notificacoes_fila", { data: [linha], error: null });
    banco.responder("notificacao_templates", {
      data: [
        { evento: "cobranca_orcamento", corpo: "{{texto}}", ativo: true },
        { evento: "orcamento_enviado", corpo: "Olá {{cliente}}.", ativo: true },
        { evento: "aviso_grupo_equipe", corpo: "{{texto}}", ativo: true },
      ],
      error: null,
    });
    const { despacharPeloServidor } = await import("../src/lib/api/whatsapp-enviar.server");
    const headers = new Headers({ [CABECALHO_DO_DESPACHANTE]: TOKEN });
    return despacharPeloServidor(new Request("https://print.exemplo/api/whatsapp/despachar", { method: "POST", headers, body: "{}" }));
  }

  beforeEach(() => {
    // O consumidor mede a idade da cobrança pelo relógio: trava a data em AGORA.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    pedidos = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        pedidos.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? "{}")) });
        return new Response(JSON.stringify({ messageId: "MSG-1" }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const A = "5596991112233";
  const B = "5596994445566";
  const TEXTO = `⏰ Orçamento pendente · WA-2611-0109\nCliente: Cliente Inventado\n@${A} @${B}`;

  it("variaveis.mencionar vira mentioned quando o destino é grupo (só números válidos)", async () => {
    await despachar(linhaDaFila(GRUPO, { texto: TEXTO, mencionar: [A, B, "lixo", 123] }));
    const envio = pedidos.find((p) => p.url.endsWith("/send-text"));
    expect(envio, "o aviso não saiu").toBeDefined();
    expect(envio!.corpo.phone).toBe(GRUPO);
    expect(envio!.corpo.mentioned).toEqual([A, B]);
    expect(String(envio!.corpo.message)).toContain(`@${A}`);
    // Aviso de grupo não vira conversa.
    expect(chamou("rpc:whatsapp_registrar_mensagem")).toEqual([]);
  });

  it("aviso de grupo sem mencionar continua sem mentioned", async () => {
    await despachar(linhaDaFila(GRUPO, { texto: "Cliente novo" }, "aviso_grupo_equipe"));
    const envio = pedidos.find((p) => p.url.endsWith("/send-text"));
    expect(envio?.corpo).toEqual({ phone: GRUPO, message: "Cliente novo" });
  });

  it("aviso a pessoa com mencionar nas variáveis: o corpo não leva mentioned", async () => {
    await despachar(linhaDaFila("96991112233", { cliente: "Fulano", mencionar: [A] }, "orcamento_enviado"));
    const envio = pedidos.find((p) => p.url.endsWith("/send-text"));
    expect(envio, "o aviso não saiu").toBeDefined();
    expect(envio?.corpo).toEqual({ phone: "5596991112233", message: "Olá Fulano." });
  });

  it("terceira trava: cobranca_orcamento para destino que não é grupo falha sem chamar o Z-API", async () => {
    for (const destino of ["96991112233", "5596991112233", "", "abc-group"]) {
      pedidos = [];
      banco.chamadas.length = 0;
      await despachar(linhaDaFila(destino, { texto: TEXTO, mencionar: [A] }));
      expect(pedidos, destino).toEqual([]);
      const falha = chamou("notificacoes_fila").find(
        (c) => c.metodo === "update" && (c.args as { status?: string })?.status === "falhou",
      );
      expect(falha?.args, destino).toEqual({ status: "falhou", ultimo_erro: "o aviso do grupo só vai para o grupo da equipe" });
    }
  });

  it("terceira trava olha também o modelo: outro evento com template cobranca_orcamento não passa para cliente", async () => {
    for (const destino of ["96991112233", "5596991112233"]) {
      pedidos = [];
      banco.chamadas.length = 0;
      await despachar(linhaDaFila(destino, { texto: "texto escolhido por quem escreveu na fila" }, "x", "cobranca_orcamento"));
      expect(pedidos, destino).toEqual([]);
      const falha = chamou("notificacoes_fila").find(
        (c) => c.metodo === "update" && (c.args as { status?: string })?.status === "falhou",
      );
      expect(falha, destino).toBeDefined();
    }
    // o aviso de cliente novo tem a mesma trava
    pedidos = [];
    await despachar(linhaDaFila("5596991112233", { texto: "x" }, "y", "aviso_grupo_equipe"));
    expect(pedidos).toEqual([]);
  });

  it("cobrança com mais de 30 minutos na fila é cancelada e não sai", async () => {
    banco.chamadas.length = 0;
    const velha = { ...linhaDaFila(GRUPO, { texto: TEXTO, mencionar: [A] }), created_at: "2026-11-12T13:00:00.000Z" };
    await despachar(velha);
    expect(pedidos).toEqual([]);
    const cancelou = chamou("notificacoes_fila").find((c) => (c.args as { status?: string })?.status === "cancelado");
    expect((cancelou?.args as { ultimo_erro?: string }).ultimo_erro).toContain("vencida");
  });

  it("cobrança na fila fora do horário útil é cancelada e não sai", async () => {
    regra.dentro = false;
    try {
      banco.chamadas.length = 0;
      await despachar(linhaDaFila(GRUPO, { texto: TEXTO, mencionar: [A] }));
      expect(pedidos).toEqual([]);
      const cancelou = chamou("notificacoes_fila").find((c) => (c.args as { status?: string })?.status === "cancelado");
      expect((cancelou?.args as { ultimo_erro?: string }).ultimo_erro).toContain("fora do horário");
    } finally {
      regra.dentro = true;
    }
  });

  it("quem saiu da equipe deixa de ser citado na hora do envio", async () => {
    const SAIU = "5596977778888";
    await despachar(linhaDaFila(GRUPO, { texto: `Cliente\n@${A} @${SAIU}`, mencionar: [A, SAIU] }));
    const envio = pedidos.find((p) => p.url.endsWith("/send-text"));
    expect(envio, "o aviso não saiu").toBeDefined();
    expect(envio!.corpo.mentioned).toEqual([A]);
    expect(String(envio!.corpo.message)).toContain(`@${A}`);
    expect(String(envio!.corpo.message)).not.toContain(SAIU);
  });

  it("sem conseguir ler a equipe a cobrança não sai: volta para a fila", async () => {
    banco.chamadas.length = 0;
    banco.responder(CONFIG, { data: configuracao(), error: null });
    // despachar() responde a equipe de novo; usa a fila de respostas para vencer
    banco.filas.set(EQUIPE, [{ data: null, error: { message: "timeout" } }]);
    await despachar(linhaDaFila(GRUPO, { texto: TEXTO, mencionar: [A] }));
    expect(pedidos).toEqual([]);
    const volta = chamou("notificacoes_fila").find((c) =>
      String((c.args as { ultimo_erro?: string })?.ultimo_erro ?? "").includes("equipe"),
    );
    expect((volta?.args as { ultimo_erro?: string }).ultimo_erro).toContain("equipe");
  });
});
