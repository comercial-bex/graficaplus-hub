import { describe, expect, it } from "vitest";
import {
  chaveDoEvento,
  classificarEventoZapi,
  mapearStatusZapi,
} from "../src/domain/whatsapp/evento-zapi";

// Formatos da documentação do Z-API (developer.z-api.io), conferidos em
// 11/09/2026. O telefone é de Macapá SEM o nono dígito, que é como o WhatsApp
// entrega números de DDD >= 31.
const base = {
  isStatusReply: false,
  connectedPhone: "5596991234567",
  waitingMessage: false,
  isEdit: false,
  isGroup: false,
  isNewsletter: false,
  instanceId: "3C4F2A9B1D",
  messageId: "3EB0C767D26A1D2B8F42",
  phone: "559681234567",
  fromMe: false,
  momment: 1788992400000,
  status: "RECEIVED",
  chatName: "Max Lima",
  senderName: "Max Lima",
  participantPhone: null,
  broadcast: false,
  type: "ReceivedCallback",
};

describe("quem decide é o type, nunca o status", () => {
  it("mensagem do cliente com status RECEIVED é MENSAGEM", () => {
    // O defeito do Bex Lite: classificar pelo status mandava esta mensagem
    // para o atalho de recibo, e ela sumia com 200 OK por sete semanas.
    const e = classificarEventoZapi({ ...base, text: { message: "Oi, quero um orçamento" } });
    expect(e.tipo).toBe("mensagem");
    if (e.tipo === "mensagem") {
      expect(e.texto).toBe("Oi, quero um orçamento");
      expect(e.telefone).toBe("559681234567");
      expect(e.deMim).toBe(false);
      expect(e.nome).toBe("Max Lima");
    }
  });

  it("recibo com status RECEIVED é RECIBO de entrega", () => {
    const e = classificarEventoZapi({
      instanceId: "3C4F2A9B1D",
      status: "RECEIVED",
      ids: ["3EB0AAAA", "3EB0BBBB"],
      momment: 1788992400000,
      phoneDevice: 0,
      phone: "559681234567",
      type: "MessageStatusCallback",
      isGroup: false,
    });
    expect(e).toMatchObject({ tipo: "status", status: "entregue", ids: ["3EB0AAAA", "3EB0BBBB"] });
  });
});

describe("o recibo traz uma LISTA de ids", () => {
  it("lê ids[], que é o que o evento manda", () => {
    // O receptor antigo lia payload.messageId — campo que o recibo não tem.
    const e = classificarEventoZapi({
      instanceId: "X",
      type: "MessageStatusCallback",
      status: "READ",
      ids: ["A1"],
    });
    expect(e).toMatchObject({ tipo: "status", ids: ["A1"], status: "lida" });
  });

  it("recibo sem ids é ignorado, não vira atualização vazia", () => {
    const e = classificarEventoZapi({ instanceId: "X", type: "MessageStatusCallback", status: "READ" });
    expect(e.tipo).toBe("ignorado");
  });

  it("status desconhecido não é gravado cru no enum", () => {
    const e = classificarEventoZapi({
      instanceId: "X",
      type: "MessageStatusCallback",
      status: "SOMETHING_NEW",
      ids: ["A1"],
    });
    expect(e.tipo).toBe("ignorado");
  });
});

describe("mapeamento dos recibos", () => {
  it("cada status do Z-API vira um valor do enum", () => {
    expect(mapearStatusZapi("SENT")).toBe("enviada");
    expect(mapearStatusZapi("RECEIVED")).toBe("entregue");
    expect(mapearStatusZapi("READ")).toBe("lida");
    expect(mapearStatusZapi("PLAYED")).toBe("lida");
    expect(mapearStatusZapi("FAILED")).toBe("falha");
  });

  it("READ_BY_ME fica de fora: é a empresa lendo, não o cliente", () => {
    expect(mapearStatusZapi("READ_BY_ME")).toBeNull();
    expect(mapearStatusZapi(undefined)).toBeNull();
  });
});

describe("grupo, canal e transmissão não viram lead", () => {
  it("mensagem de grupo é ignorada", () => {
    const e = classificarEventoZapi({
      ...base,
      isGroup: true,
      phone: "120363019502650977-group",
      text: { message: "bom dia" },
    });
    expect(e).toMatchObject({ tipo: "ignorado", motivo: "mensagem de grupo" });
  });

  it("id de grupo sem a flag também não passa como telefone", () => {
    const e = classificarEventoZapi({ ...base, phone: "120363019502650977-group", text: { message: "x" } });
    expect(e.tipo).toBe("ignorado");
  });

  it("canal e lista de transmissão são ignorados", () => {
    expect(classificarEventoZapi({ ...base, isNewsletter: true, text: { message: "x" } }).tipo).toBe(
      "ignorado",
    );
    expect(classificarEventoZapi({ ...base, broadcast: true, text: { message: "x" } }).tipo).toBe(
      "ignorado",
    );
  });

  it("reação a mensagem não é mensagem", () => {
    const e = classificarEventoZapi({
      ...base,
      reaction: { value: "👍", referencedMessage: { messageId: "Z" } },
    });
    expect(e.tipo).toBe("ignorado");
  });
});

describe("o conteúdo de cada tipo de mensagem", () => {
  it("imagem traz a URL da mídia e a legenda", () => {
    const e = classificarEventoZapi({
      ...base,
      image: { mimeType: "image/jpeg", imageUrl: "https://z-api.io/img.jpg", caption: "arte aprovada?" },
    });
    expect(e).toMatchObject({
      tipo: "mensagem",
      tipoMensagem: "imagem",
      legenda: "arte aprovada?",
      midia: { url: "https://z-api.io/img.jpg", mimeType: "image/jpeg" },
    });
  });

  it("documento guarda o nome do arquivo", () => {
    const e = classificarEventoZapi({
      ...base,
      document: {
        documentUrl: "https://z-api.io/doc.pdf",
        mimeType: "application/pdf",
        title: "logo",
        fileName: "logo-vetor.pdf",
      },
    });
    expect(e).toMatchObject({
      tipoMensagem: "documento",
      midia: { nomeArquivo: "logo-vetor.pdf" },
    });
  });

  it("áudio, vídeo e figurinha viram mídia do tipo certo", () => {
    expect(classificarEventoZapi({ ...base, audio: { audioUrl: "https://a", mimeType: "audio/ogg" } }))
      .toMatchObject({ tipoMensagem: "audio" });
    expect(classificarEventoZapi({ ...base, video: { videoUrl: "https://v" } })).toMatchObject({
      tipoMensagem: "video",
    });
    expect(classificarEventoZapi({ ...base, sticker: { stickerUrl: "https://s" } })).toMatchObject({
      tipoMensagem: "sticker",
    });
  });

  it("localização vira texto legível", () => {
    const e = classificarEventoZapi({
      ...base,
      location: { latitude: 0.03, longitude: -51.06, address: "Av. FAB, Macapá", url: "" },
    });
    expect(e).toMatchObject({ tipoMensagem: "localizacao", texto: "Av. FAB, Macapá" });
  });

  it("resposta de botão é texto", () => {
    const e = classificarEventoZapi({ ...base, buttonsResponseMessage: { message: "Aprovar arte" } });
    expect(e).toMatchObject({ tipoMensagem: "texto", texto: "Aprovar arte" });
  });
});

describe("mensagem enviada do próprio celular", () => {
  it("fromMe vira saída, sem nome de remetente virando lead", () => {
    const e = classificarEventoZapi({ ...base, fromMe: true, text: { message: "Seu pedido está pronto" } });
    expect(e).toMatchObject({ tipo: "mensagem", deMim: true });
  });
});

describe("mensagem ainda cifrada", () => {
  it("é ignorada, para não bloquear a versão legível", () => {
    const e = classificarEventoZapi({ ...base, waitingMessage: true });
    expect(e.tipo).toBe("ignorado");
  });

  it("tem chave própria, diferente da mensagem legível com o mesmo messageId", () => {
    expect(chaveDoEvento({ ...base, waitingMessage: true })).toBe("espera:3EB0C767D26A1D2B8F42");
    expect(chaveDoEvento(base)).toBe("msg:3EB0C767D26A1D2B8F42");
  });
});

describe("conexão", () => {
  it("conectou e desconectou", () => {
    expect(classificarEventoZapi({ type: "ConnectedCallback", instanceId: "X", connected: true }))
      .toMatchObject({ tipo: "conexao", conectado: true });
    expect(
      classificarEventoZapi({ type: "DisconnectedCallback", instanceId: "X", disconnected: true }),
    ).toMatchObject({ tipo: "conexao", conectado: false });
  });
});

describe("corpo inválido não derruba o receptor", () => {
  it("devolve ignorado com o motivo", () => {
    expect(classificarEventoZapi(null).tipo).toBe("ignorado");
    expect(classificarEventoZapi("texto").tipo).toBe("ignorado");
    expect(classificarEventoZapi({ type: "ReceivedCallback" })).toMatchObject({
      tipo: "ignorado",
      motivo: "evento sem instanceId",
    });
  });

  it("tipo desconhecido é ignorado e diz qual era", () => {
    const e = classificarEventoZapi({ type: "PresenceChatCallback", instanceId: "X" });
    expect(e).toMatchObject({ tipo: "ignorado", motivo: "tipo PresenceChatCallback não tratado" });
  });
});

describe("chave de idempotência", () => {
  it("o mesmo recibo, com ids em outra ordem, tem a mesma chave", () => {
    const a = chaveDoEvento({ type: "MessageStatusCallback", status: "READ", ids: ["B", "A"] });
    const b = chaveDoEvento({ type: "MessageStatusCallback", status: "READ", ids: ["A", "B"] });
    expect(a).toBe(b);
  });

  it("status diferentes do mesmo id têm chaves diferentes", () => {
    // Entregue e lida são dois eventos: o segundo não pode ser barrado como
    // repetição do primeiro.
    const entregue = chaveDoEvento({ type: "MessageStatusCallback", status: "RECEIVED", ids: ["A"] });
    const lida = chaveDoEvento({ type: "MessageStatusCallback", status: "READ", ids: ["A"] });
    expect(entregue).not.toBe(lida);
  });
});
