import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * O RECEPTOR DO WEBHOOK exercido de verdade, com o banco, o armazenamento e a
 * rede trocados por dublês. Os eventos são os que o Z-API mandou de verdade em
 * 05 e 06/10/2026 (tests/fixtures/zapi-eventos-06-10.json).
 *
 * O que se segura:
 *   presença e status@broadcast   200 sem INSERT em whatsapp_webhook_eventos
 *   fromMe + fromApi              gravado e ignorado: nada vai à função do banco
 *   fromMe sem fromApi            vira saída (p_direcao = 'saida')
 *   hydratedTemplate              vira texto, com o texto montado
 *   phone com 14 dígitos (lid)    "remetente não é um telefone"
 *   cópia da mídia que falha      o motivo fica na mensagem, no evento (com
 *                                 processado_em) e em whatsapp_logs — e a
 *                                 resposta é 200, porque a mensagem entrou
 */

const SEGREDO = "segredo-do-webhook-de-teste";

const banco = vi.hoisted(() => {
  type Chamada = { tabela: string; metodo: string; args: unknown[] };
  const estado = {
    chamadas: [] as Chamada[],
    respostas: new Map<string, unknown>(),
    rpcs: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    rpcResposta: { data: null as unknown, error: null as unknown },
    listaDoBucket: [] as { name: string; metadata: { size: number } }[],
    responder(chave: string, resposta: unknown) {
      estado.respostas.set(chave, resposta);
    },
    from(tabela: string) {
      let verbo = "select";
      const cadeia: Record<string, unknown> = {};
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
        cadeia[m] = (...args: unknown[]) => {
          if (m === "insert" || m === "update" || m === "delete") verbo = m;
          estado.chamadas.push({ tabela, metodo: m, args });
          return cadeia;
        };
      }
      cadeia.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(
          estado.respostas.get(`${tabela}.${verbo}`) ?? { data: null, error: null },
        ).then(resolve, reject);
      return cadeia;
    },
    rpc(nome: string, params?: Record<string, unknown>) {
      estado.rpcs.push({ nome, params });
      return Promise.resolve(estado.rpcResposta);
    },
    storage: {
      from: () => ({
        list: async () => ({ data: estado.listaDoBucket, error: null }),
        upload: async () => ({ data: null, error: null }),
      }),
    },
  };
  return estado;
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (tabela: string) => banco.from(tabela),
    rpc: (nome: string, params?: Record<string, unknown>) => banco.rpc(nome, params),
    storage: banco.storage,
  },
}));

import { processarWebhookZapi } from "../src/lib/api/whatsapp-webhook.server";

const EVENTOS = JSON.parse(
  readFileSync("tests/fixtures/zapi-eventos-06-10.json", "utf8"),
) as Record<string, Record<string, unknown>>;

let fetchOriginal: typeof fetch;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  banco.chamadas.length = 0;
  banco.rpcs.length = 0;
  banco.respostas.clear();
  banco.listaDoBucket = [];
  banco.rpcResposta = { data: { duplicada: false }, error: null };
  banco.responder("whatsapp_instancias.select", {
    data: { id: "inst-1", webhook_secret_hash: await hashDoSegredo(SEGREDO), ativa: true },
    error: null,
  });
  // O evento nunca existiu antes; o INSERT devolve um id.
  banco.responder("whatsapp_webhook_eventos.select", { data: null, error: null });
  banco.responder("whatsapp_webhook_eventos.insert", { data: { id: "evt-1" }, error: null });
  fetchOriginal = globalThis.fetch;
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  erros.mockRestore();
});

function receber(payload: unknown, token = SEGREDO): Promise<Response> {
  return processarWebhookZapi(
    new Request(`https://print.exemplo/api/whatsapp/webhook?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

const inserts = (tabela: string) =>
  banco.chamadas.filter((c) => c.tabela === tabela && c.metodo === "insert");
const updates = (tabela: string) =>
  banco.chamadas.filter((c) => c.tabela === tabela && c.metodo === "update");

describe("menos barulho: 200 sem gravar", () => {
  it("presença (fulano ficou online) não entra no histórico", async () => {
    const r = await receber(EVENTOS.presenca);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, registrado: false });
    expect(inserts("whatsapp_webhook_eventos")).toHaveLength(0);
    expect(banco.rpcs).toHaveLength(0);
  });

  it("recibo de status@broadcast não entra no histórico", async () => {
    const r = await receber(EVENTOS.recibo_status_broadcast);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ registrado: false });
    expect(inserts("whatsapp_webhook_eventos")).toHaveLength(0);
  });

  it("… mas só DEPOIS de conferir o token: com token errado, 401 e nada é dito", async () => {
    const r = await receber(EVENTOS.presenca, "errado");
    expect(r.status).toBe(401);
    expect(inserts("whatsapp_webhook_eventos")).toHaveLength(0);
  });

  it("recibo de gente (READ_BY_ME de um número) continua sendo gravado", async () => {
    const r = await receber(EVENTOS.recibo_sem_mensagem);
    expect(r.status).toBe(200);
    expect(inserts("whatsapp_webhook_eventos")).toHaveLength(1);
    // READ_BY_ME não é status do enum: o evento fica, e é ignorado no processamento.
    expect(await r.json()).toMatchObject({ tipo: "ignorado" });
  });
});

describe("quem mandou e o que mandou", () => {
  // Sem o hydratedTemplate: aqui o remetente é gente, não um modelo de empresa.
  const { hydratedTemplate: _modelo, ...base } = EVENTOS.modelo_claro;
  void _modelo;

  it("fromMe + fromApi: gravado e ignorado — quem enviou já registrou", async () => {
    const r = await receber({ ...base, fromMe: true, fromApi: true, text: { message: "oi" } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      tipo: "ignorado",
      ignorado: expect.stringContaining("API"),
    });
    expect(inserts("whatsapp_webhook_eventos")).toHaveLength(1);
    expect(banco.rpcs).toHaveLength(0);
  });

  it("fromMe sem fromApi (digitada no celular): vira saída", async () => {
    const r = await receber({
      ...base,
      fromMe: true,
      fromApi: false,
      text: { message: "chegou?" },
    });
    expect(r.status).toBe(200);
    const [chamada] = banco.rpcs;
    expect(chamada.nome).toBe("whatsapp_registrar_mensagem");
    expect(chamada.params).toMatchObject({
      p_direcao: "saida",
      p_tipo: "texto",
      p_texto: "chegou?",
      p_nome_contato: null,
    });
    // Gente de verdade: sem origem 'automacao' (o gatilho da caixa v3 marca 'celular').
    expect(chamada.params?.p_origem).toBeUndefined();
  });

  it("mensagem de modelo (hydratedTemplate) entra como texto, no formato do dono, com origem 'automacao'", async () => {
    await receber(EVENTOS.modelo_claro);
    const [chamada] = banco.rpcs;
    // 'automacao': a função do banco não abre lead e o gatilho da caixa v3
    // não abre atendimento — modelo de empresa não é cliente.
    expect(chamada.params).toMatchObject({
      p_direcao: "entrada",
      p_tipo: "texto",
      p_origem: "automacao",
    });
    expect(chamada.params?.p_texto).toBe(
      "Bloqueio de Linha\n\nOlá! Este é o canal oficial da Claro.✅\n\n*Sua linha pode ser bloqueada* por falta de recarga.\n\nRealize uma recarga de qualquer valor para continuar usando seu número.",
    );
  });

  it("phone com 14 dígitos (o lid cru) não é telefone: ignorado, sem função do banco", async () => {
    const r = await receber(EVENTOS.modelo_kwai_com_lid_no_phone);
    expect(await r.json()).toMatchObject({
      tipo: "ignorado",
      ignorado: "remetente não é um telefone",
    });
    expect(banco.rpcs).toHaveLength(0);
  });
});

describe("mídia que não copiou deixa rastro", () => {
  it("link fora do ar: a mensagem entra (200), e o motivo vai para a mensagem, o evento e o log", async () => {
    banco.rpcResposta = {
      data: {
        duplicada: false,
        mensagem_id: "msg-1",
        conversa_id: "conv-1",
        cliente_id: null,
        os_id: null,
      },
      error: null,
    };
    globalThis.fetch = (async () =>
      new Response("não encontrado", { status: 404 })) as typeof fetch;

    const r = await receber(EVENTOS.documento_pdf);
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.midia_erro).toContain("404");

    // whatsapp_mensagens.erro
    const naMensagem = updates("whatsapp_mensagens").map(
      (c) => c.args[0] as Record<string, unknown>,
    );
    expect(naMensagem.some((u) => typeof u.erro === "string" && u.erro.includes("404"))).toBe(true);

    // whatsapp_webhook_eventos: processado_em preenchido E erro preenchido
    const noEvento = updates("whatsapp_webhook_eventos").map(
      (c) => c.args[0] as Record<string, unknown>,
    );
    const fechamento = noEvento.find((u) => "processado_em" in u);
    expect(fechamento?.processado_em).toBeTruthy();
    expect(String(fechamento?.erro)).toContain("cópia da mídia falhou");

    // whatsapp_logs, com tipo do enum e sem inventar valor
    const logs = inserts("whatsapp_logs").map((c) => c.args[0] as Record<string, unknown>);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tipo: "erro",
      sucesso: false,
      mensagem_id: "msg-1",
      conversa_id: "conv-1",
    });
  });

  it("cópia que já está no bucket é reaproveitada: nada de segundo upload nem segunda linha em arquivos", async () => {
    banco.rpcResposta = {
      data: {
        duplicada: false,
        mensagem_id: "msg-1",
        conversa_id: "conv-1",
        cliente_id: null,
        os_id: null,
      },
      error: null,
    };
    // O objeto da tentativa anterior, com o nome limpo e o tamanho do PDF real.
    banco.listaDoBucket = [
      { name: "1791308158221-exonera_o_e_nomea_o.pdf", metadata: { size: 977421 } },
    ];
    banco.responder("arquivos.select", { data: { id: "arq-1" }, error: null });
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { "content-length": "977421", "content-type": "application/pdf" },
      })) as typeof fetch;

    const r = await receber(EVENTOS.documento_pdf);
    expect(await r.json()).toMatchObject({ midia: "reaproveitada" });
    expect(inserts("arquivos")).toHaveLength(0);
    const ligacao = updates("whatsapp_mensagens").map((c) => c.args[0] as Record<string, unknown>);
    expect(ligacao[0]).toMatchObject({
      storage_path: "inst-1/conv-1/1791308158221-exonera_o_e_nomea_o.pdf",
      arquivo_id: "arq-1",
      erro: null,
    });
  });
});
