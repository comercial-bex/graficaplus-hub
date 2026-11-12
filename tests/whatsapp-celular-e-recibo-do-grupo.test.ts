import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classificarEventoZapi } from "../src/domain/whatsapp/evento-zapi";
import { hashDoSegredo } from "../src/domain/whatsapp/segredo-webhook";

/**
 * PORTA de entrada (12/11/2026): recibo das mensagens do grupo da equipe e mensagens mandadas
 * pelo celular da empresa (evento-zapi.ts e whatsapp-webhook.server.ts). Dados inventados.
 *
 *   recibo de grupo           status com grupo: true; só whatsapp_registrar_status
 *   READ_BY_ME de grupo       continua ignorado
 *   fromMe, phone "<n>@lid"   mensagem_do_celular; com conversa conhecida vira saída com o
 *                             telefone da conversa; sem conversa, ignorado e nada gravado
 *   fromMe + fromApi          continua ignorado (o eco da API não duplica)
 *   entrada com chatLid       ensina o lid DEPOIS do registro; falha não derruba o 200
 */

const SEGREDO = "segredo-de-teste-da-porta";
const LID = "111122223333444@lid";
const GRUPO = "120363000000000001-group";

const banco = vi.hoisted(() => {
  type Chamada = { tabela: string; metodo: string; args: unknown[] };
  const estado = {
    chamadas: [] as Chamada[],
    respostas: new Map<string, unknown>(),
    rpcs: [] as { nome: string; params: Record<string, unknown> | undefined }[],
    rpcRespostas: new Map<string, unknown>(),
    rpcLanca: new Set<string>(),
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
      if (estado.rpcLanca.has(nome)) return Promise.reject(new Error(`${nome} fora do ar`));
      return Promise.resolve(estado.rpcRespostas.get(nome) ?? { data: null, error: null });
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
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

const baseMensagem = {
  isStatusReply: false,
  waitingMessage: false,
  isEdit: false,
  isGroup: false,
  isNewsletter: false,
  instanceId: "INSTANCIA-TESTE",
  messageId: "MSG-0001",
  phone: "559600000001",
  fromMe: false,
  momment: 1794470400000,
  status: "RECEIVED",
  chatName: "Cliente Inventado",
  senderName: "Cliente Inventado",
  broadcast: false,
  type: "ReceivedCallback",
};

const doCelular = {
  ...baseMensagem,
  messageId: "MSG-CEL-0001",
  phone: LID,
  chatLid: LID,
  fromMe: true,
  fromApi: false,
  text: { message: "Segue o orçamento nº 123" },
};

const reciboDoGrupo = {
  type: "MessageStatusCallback",
  instanceId: "INSTANCIA-TESTE",
  isGroup: true,
  phone: GRUPO,
  participant: "559600000009",
  ids: ["AVISO-GRUPO-0001"],
  status: "READ",
  momment: 1794470460000,
};

let avisos: ReturnType<typeof vi.spyOn>;
let erros: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  banco.chamadas.length = 0;
  banco.rpcs.length = 0;
  banco.respostas.clear();
  banco.rpcRespostas.clear();
  banco.rpcLanca.clear();
  banco.responder("whatsapp_instancias.select", {
    data: { id: "inst-1", webhook_secret_hash: await hashDoSegredo(SEGREDO), ativa: true },
    error: null,
  });
  banco.responder("whatsapp_webhook_eventos.select", { data: null, error: null });
  banco.responder("whatsapp_webhook_eventos.insert", { data: { id: "evt-1" }, error: null });
  banco.rpcRespostas.set("whatsapp_registrar_mensagem", {
    data: { duplicada: false, mensagem_id: "msg-1", conversa_id: "conv-1" },
    error: null,
  });
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
  erros = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  avisos.mockRestore();
  erros.mockRestore();
});

function receber(payload: unknown): Promise<Response> {
  return processarWebhookZapi(
    new Request(`https://print.exemplo/api/whatsapp/webhook?token=${SEGREDO}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

const nomes = () => banco.rpcs.map((r) => r.nome);

describe("recibo do grupo: classificação", () => {
  it("MessageStatusCallback com isGroup vira status com grupo: true", () => {
    expect(classificarEventoZapi(reciboDoGrupo)).toEqual({
      tipo: "status",
      instanceId: "INSTANCIA-TESTE",
      ids: ["AVISO-GRUPO-0001"],
      status: "lida",
      momento: new Date(1794470460000),
      grupo: true,
    });
    expect(classificarEventoZapi({ ...reciboDoGrupo, status: "RECEIVED" })).toMatchObject({
      tipo: "status",
      status: "entregue",
      grupo: true,
    });
  });

  it("recibo de pessoa não ganha a marca de grupo", () => {
    const e = classificarEventoZapi({ ...reciboDoGrupo, isGroup: false, phone: "559600000001" });
    expect(e.tipo).toBe("status");
    expect(e).not.toHaveProperty("grupo");
  });

  it("READ_BY_ME do grupo continua ignorado", () => {
    expect(classificarEventoZapi({ ...reciboDoGrupo, status: "READ_BY_ME" })).toMatchObject({
      tipo: "ignorado",
    });
  });

  it("recibo de grupo sem ids continua ignorado", () => {
    expect(classificarEventoZapi({ ...reciboDoGrupo, ids: [] })).toMatchObject({
      tipo: "ignorado",
      motivo: "recibo sem ids",
    });
  });

  it("mensagem de grupo (não o recibo) continua ignorada", () => {
    expect(
      classificarEventoZapi({ ...baseMensagem, isGroup: true, phone: GRUPO, text: { message: "x" } }),
    ).toMatchObject({ tipo: "ignorado", motivo: "mensagem de grupo" });
  });
});

describe("recibo do grupo: webhook", () => {
  it("chama whatsapp_registrar_status e nunca whatsapp_registrar_mensagem; responde grupo: true", async () => {
    banco.rpcRespostas.set("whatsapp_registrar_status", {
      data: { mensagens: 0, avisos: 1 },
      error: null,
    });
    const r = await receber(reciboDoGrupo);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ tipo: "status", grupo: true });
    expect(nomes()).toEqual(["whatsapp_registrar_status"]);
    expect(banco.rpcs[0].params).toEqual({
      p_instancia_id: "inst-1",
      p_ids: ["AVISO-GRUPO-0001"],
      p_status: "lida",
      p_momento: new Date(1794470460000).toISOString(),
    });
  });

  it("não cria conversa nem lead: nenhum INSERT fora do histórico de eventos", async () => {
    await receber(reciboDoGrupo);
    expect(nomes()).not.toContain("whatsapp_registrar_mensagem");
    const inserts = banco.chamadas.filter((c) => c.metodo === "insert").map((c) => c.tabela);
    expect(inserts).toEqual(["whatsapp_webhook_eventos"]);
  });

  it("falha ao gravar o recibo do grupo: 200 com o erro no resultado (não vira 500 nem reenvio)", async () => {
    banco.rpcRespostas.set("whatsapp_registrar_status", { data: null, error: { message: "função ausente" } });
    const r = await receber(reciboDoGrupo);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ grupo: true, recibo_erro: "função ausente" });
  });

  it("READ_BY_ME do grupo: gravado no histórico e ignorado, sem função do banco", async () => {
    const r = await receber({ ...reciboDoGrupo, status: "READ_BY_ME" });
    expect(await r.json()).toMatchObject({ tipo: "ignorado" });
    expect(banco.rpcs).toHaveLength(0);
  });
});

describe("celular da empresa (phone '<n>@lid', fromMe, sem fromApi): classificação", () => {
  it("vira mensagem_do_celular com o chatLid e o conteúdo", () => {
    expect(classificarEventoZapi(doCelular)).toEqual({
      tipo: "mensagem_do_celular",
      instanceId: "INSTANCIA-TESTE",
      messageId: "MSG-CEL-0001",
      chatLid: LID,
      tipoMensagem: "texto",
      texto: "Segue o orçamento nº 123",
      legenda: null,
      midia: null,
      momento: new Date(1794470400000),
    });
  });

  it("sem chatLid válido, o lid vem do phone", () => {
    expect(classificarEventoZapi({ ...doCelular, chatLid: "lixo" })).toMatchObject({
      tipo: "mensagem_do_celular",
      chatLid: LID,
    });
  });

  it("documento do celular (o PDF do orçamento) traz a mídia", () => {
    const { text: _t, ...semTexto } = doCelular;
    void _t;
    expect(
      classificarEventoZapi({
        ...semTexto,
        document: {
          documentUrl: "https://midia.exemplo/orcamento-123.pdf",
          mimeType: "application/pdf",
          fileName: "orcamento-123.pdf",
        },
      }),
    ).toMatchObject({
      tipo: "mensagem_do_celular",
      tipoMensagem: "documento",
      midia: { url: "https://midia.exemplo/orcamento-123.pdf", nomeArquivo: "orcamento-123.pdf" },
    });
  });

  it("notificação de sistema do celular (REVOKE, mensagem apagada) é ignorada: não é resposta ao cliente", () => {
    const { text: _t, ...semTexto } = doCelular;
    void _t;
    expect(classificarEventoZapi({ ...semTexto, notification: "REVOKE" })).toMatchObject({
      tipo: "ignorado",
      motivo: "notificação de sistema do celular da empresa",
    });
    // sem texto, mídia nem notification: também é "sistema" e não vira saída
    expect(classificarEventoZapi(semTexto)).toMatchObject({ tipo: "ignorado" });
  });

  it("fromApi verdadeiro continua ignorado (não duplica o eco da API)", () => {
    expect(classificarEventoZapi({ ...doCelular, fromApi: true })).toMatchObject({
      tipo: "ignorado",
      motivo: expect.stringContaining("API"),
    });
  });

  it("ENTRADA com phone '@lid' continua 'remetente não é um telefone' (lid nunca vira lead)", () => {
    expect(classificarEventoZapi({ ...doCelular, fromMe: false })).toMatchObject({
      tipo: "ignorado",
      motivo: "remetente não é um telefone",
    });
  });

  it("phone de lid malformado com fromMe continua recusado", () => {
    expect(classificarEventoZapi({ ...doCelular, phone: "abc@lid", chatLid: null })).toMatchObject({
      tipo: "ignorado",
      motivo: "remetente não é um telefone",
    });
  });

  it("mensagem do cliente traz o chatLid; sem ele, null", () => {
    expect(
      classificarEventoZapi({ ...baseMensagem, chatLid: LID, text: { message: "oi" } }),
    ).toMatchObject({ tipo: "mensagem", telefone: "559600000001", chatLid: LID });
    expect(classificarEventoZapi({ ...baseMensagem, text: { message: "oi" } })).toMatchObject({
      tipo: "mensagem",
      chatLid: null,
    });
    expect(
      classificarEventoZapi({ ...baseMensagem, chatLid: "nao-e-lid", text: { message: "oi" } }),
    ).toMatchObject({ chatLid: null });
  });
});

describe("celular da empresa: webhook", () => {
  it("conversa conhecida: grava como saída, origem celular, com o telefone da conversa", async () => {
    banco.rpcRespostas.set("whatsapp_conversa_do_lid", {
      data: [{ conversa_id: "conv-1", telefone: "96900000001" }],
      error: null,
    });
    const r = await receber(doCelular);
    expect(r.status).toBe(200);
    expect(nomes()).toEqual(["whatsapp_conversa_do_lid", "whatsapp_registrar_mensagem"]);
    expect(banco.rpcs[0].params).toEqual({ p_instancia_id: "inst-1", p_chat_lid: LID });
    expect(banco.rpcs[1].params).toMatchObject({
      p_instancia_id: "inst-1",
      p_zapi_message_id: "MSG-CEL-0001",
      p_telefone: "96900000001",
      p_direcao: "saida",
      p_tipo: "texto",
      p_texto: "Segue o orçamento nº 123",
      p_nome_contato: null,
    });
    expect(banco.rpcs[1].params?.p_origem).toBeUndefined();
    const origem = banco.chamadas.find(
      (c) => c.tabela === "whatsapp_mensagens" && c.metodo === "update",
    );
    expect(origem?.args[0]).toEqual({ origem: "celular" });
    // Saída nunca ensina lid (só o cliente ensina).
    expect(nomes()).not.toContain("whatsapp_aprender_lid");
  });

  it("aceita a resposta da função como objeto único também", async () => {
    banco.rpcRespostas.set("whatsapp_conversa_do_lid", {
      data: { conversa_id: "conv-1", telefone: "96900000001" },
      error: null,
    });
    await receber(doCelular);
    expect(banco.rpcs[1]?.params).toMatchObject({ p_telefone: "96900000001", p_direcao: "saida" });
  });

  it("sem conversa conhecida: ignorado com o motivo; nenhuma mensagem gravada, nunca lead", async () => {
    banco.rpcRespostas.set("whatsapp_conversa_do_lid", { data: [], error: null });
    const r = await receber(doCelular);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      tipo: "mensagem_do_celular",
      ignorado: "mensagem do celular da empresa: chatLid sem conversa conhecida",
    });
    expect(nomes()).toEqual(["whatsapp_conversa_do_lid"]);
    expect(banco.chamadas.filter((c) => c.tabela === "whatsapp_mensagens")).toHaveLength(0);
  });

  it("erro ao procurar a conversa: 500, o evento fica para o reenvio", async () => {
    banco.rpcRespostas.set("whatsapp_conversa_do_lid", {
      data: null,
      error: { message: "falha de leitura" },
    });
    const r = await receber(doCelular);
    expect(r.status).toBe(500);
    expect(nomes()).not.toContain("whatsapp_registrar_mensagem");
    const fechamento = banco.chamadas.find(
      (c) => c.tabela === "whatsapp_webhook_eventos" && c.metodo === "update",
    );
    expect((fechamento?.args[0] as Record<string, unknown>).processado_em).toBeNull();
  });

  it("fromApi verdadeiro: gravado no histórico e ignorado, sem função do banco", async () => {
    const r = await receber({ ...doCelular, fromApi: true });
    expect(await r.json()).toMatchObject({ tipo: "ignorado" });
    expect(banco.rpcs).toHaveLength(0);
  });

  it("nunca chama a assistente de IA", async () => {
    banco.rpcRespostas.set("whatsapp_conversa_do_lid", {
      data: [{ conversa_id: "conv-1", telefone: "96900000001" }],
      error: null,
    });
    const corpo = await (await receber(doCelular)).json();
    expect(corpo).not.toHaveProperty("assistente");
  });
});

describe("a mensagem do cliente ensina o lid da conversa", () => {
  const doCliente = { ...baseMensagem, chatLid: LID, text: { message: "bom dia" } };

  it("chama whatsapp_aprender_lid DEPOIS do registro, com a conversa gravada", async () => {
    const r = await receber(doCliente);
    expect(r.status).toBe(200);
    expect(banco.rpcs[0].nome).toBe("whatsapp_registrar_mensagem");
    expect(banco.rpcs[0].params).toMatchObject({ p_direcao: "entrada" });
    const aprender = banco.rpcs.find((c) => c.nome === "whatsapp_aprender_lid");
    expect(aprender?.params).toEqual({ p_conversa_id: "conv-1", p_chat_lid: LID });
  });

  it("falha (erro devolvido) do aprender não derruba o 200", async () => {
    banco.rpcRespostas.set("whatsapp_aprender_lid", {
      data: null,
      error: { message: "lid já é de outra conversa" },
    });
    const r = await receber(doCliente);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, tipo: "mensagem" });
  });

  it("aprender devolve false (outro lid ou lid de outra conversa): 200 e rastro no log, sem telefone", async () => {
    banco.rpcRespostas.set("whatsapp_aprender_lid", { data: false, error: null });
    const r = await receber(doCliente);
    expect(r.status).toBe(200);
    const aviso = avisos.mock.calls.find((c) => String(c[0]).includes("lid da conversa não aprendido"));
    expect(aviso, "o log não registrou").toBeDefined();
    expect(JSON.stringify(aviso)).toContain("conv-1");
    expect(JSON.stringify(aviso)).not.toContain(baseMensagem.phone);
  });

  it("aprender devolve true: nenhum aviso", async () => {
    banco.rpcRespostas.set("whatsapp_aprender_lid", { data: true, error: null });
    await receber(doCliente);
    expect(avisos.mock.calls.find((c) => String(c[0]).includes("lid da conversa"))).toBeUndefined();
  });

  it("falha (exceção) do aprender não derruba o 200", async () => {
    banco.rpcLanca.add("whatsapp_aprender_lid");
    const r = await receber(doCliente);
    expect(r.status).toBe(200);
    expect(nomes()).toContain("whatsapp_aprender_lid");
  });

  it("sem chatLid, ou sem conversa gravada, não chama", async () => {
    await receber({ ...baseMensagem, text: { message: "bom dia" } });
    expect(nomes()).not.toContain("whatsapp_aprender_lid");

    banco.rpcs.length = 0;
    banco.rpcRespostas.set("whatsapp_registrar_mensagem", {
      data: { duplicada: false },
      error: null,
    });
    await receber({ ...doCliente, messageId: "MSG-0002" });
    expect(nomes()).not.toContain("whatsapp_aprender_lid");
  });
});
