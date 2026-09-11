/**
 * Evento do Z-API → o que o sistema faz com ele.
 *
 * Esta é a porta de entrada do WhatsApp, e ela nunca funcionou. Conferido em
 * 11/09/2026: zero instâncias, zero conversas, zero mensagens, zero leads. O
 * receptor existia, mas como `createServerFn` — função interna do app, com URL
 * de hash e envelope próprio. O Z-API manda o JSON dele para uma URL fixa; não
 * havia URL nenhuma para colar no painel.
 *
 * QUEM DECIDE É O `type`, NUNCA O `status`
 * O Z-API manda `status: "RECEIVED"` em DOIS eventos diferentes: no recibo de
 * entrega (`MessageStatusCallback`) e na mensagem que o cliente escreve
 * (`ReceivedCallback`). No Bex Lite, um atalho que classificava pelo `status`
 * jogou fora toda mensagem recebida durante sete semanas, respondendo 200 — o
 * Z-API dava por entregue e nada alertava. Aqui o `status` só é lido DEPOIS que
 * o `type` disse que é um recibo.
 *
 * O RECIBO TRAZ `ids`, NÃO `messageId`
 * O `MessageStatusCallback` manda uma LISTA (`ids: [...]`). O receptor antigo
 * lia `payload.messageId` — campo que esse evento não tem —, então nenhum
 * recibo casaria com mensagem nenhuma.
 *
 * GRUPO NÃO É CLIENTE
 * Mensagem de grupo chega com `isGroup: true` e o id do grupo no `phone`. Sem o
 * filtro, cada grupo em que o número da empresa está viraria um "Lead WhatsApp
 * 120363...". Canal (`isNewsletter`) e lista de transmissão, idem.
 *
 * Formatos conferidos na documentação do Z-API em 11/09/2026.
 */

export type TipoMensagem =
  | "texto"
  | "imagem"
  | "documento"
  | "audio"
  | "video"
  | "sticker"
  | "localizacao"
  | "contato"
  | "sistema";

/** Os valores do enum `whatsapp_mensagem_status`. */
export type StatusMensagem = "recebida" | "pendente" | "enviada" | "entregue" | "lida" | "falha";

export type Midia = { url: string; mimeType: string | null; nomeArquivo: string | null };

export type EventoZapi =
  | {
      tipo: "mensagem";
      instanceId: string;
      messageId: string;
      telefone: string;
      /** enviada do próprio celular da empresa — é saída, não vira lead */
      deMim: boolean;
      nome: string | null;
      tipoMensagem: TipoMensagem;
      texto: string | null;
      legenda: string | null;
      midia: Midia | null;
      momento: Date | null;
    }
  | { tipo: "status"; instanceId: string; ids: string[]; status: StatusMensagem; momento: Date | null }
  | { tipo: "conexao"; instanceId: string; conectado: boolean; momento: Date | null }
  | { tipo: "ignorado"; instanceId: string | null; motivo: string };

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function momento(v: unknown): Date | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Recibo do Z-API → status do enum. O que não se reconhece devolve null, e o
 * evento é ignorado — gravar a string crua quebraria o enum, e chutar um status
 * seria afirmar uma entrega que ninguém confirmou.
 */
export function mapearStatusZapi(status: unknown): StatusMensagem | null {
  switch (typeof status === "string" ? status.toUpperCase() : "") {
    case "SENT":
      return "enviada";
    // No recibo, RECEIVED é "chegou no aparelho do destinatário".
    case "RECEIVED":
    case "DELIVERED":
      return "entregue";
    case "READ":
    case "PLAYED":
      return "lida";
    case "FAILED":
    case "ERROR":
      return "falha";
    default:
      return null;
  }
}

/**
 * Telefone de pessoa: só dígitos. Id de grupo (`120363...-group`, `...@g.us`),
 * canal (`@newsletter`) e lista de transmissão (`@broadcast`) não são pessoa.
 */
function telefoneDePessoa(phone: unknown): string | null {
  const p = texto(phone);
  if (!p) return null;
  if (/[@-]/.test(p)) return null;
  const digitos = p.replace(/\D/g, "");
  return digitos.length >= 10 ? digitos : null;
}

function conteudo(p: Json): {
  tipoMensagem: TipoMensagem;
  texto: string | null;
  legenda: string | null;
  midia: Midia | null;
} {
  const image = obj(p.image);
  if (image) {
    const url = texto(image.imageUrl);
    return {
      tipoMensagem: "imagem",
      texto: null,
      legenda: texto(image.caption),
      midia: url ? { url, mimeType: texto(image.mimeType), nomeArquivo: null } : null,
    };
  }
  const document = obj(p.document);
  if (document) {
    const url = texto(document.documentUrl);
    return {
      tipoMensagem: "documento",
      texto: null,
      legenda: texto(document.caption) ?? texto(document.title),
      midia: url
        ? { url, mimeType: texto(document.mimeType), nomeArquivo: texto(document.fileName) }
        : null,
    };
  }
  const audio = obj(p.audio);
  if (audio) {
    const url = texto(audio.audioUrl);
    return {
      tipoMensagem: "audio",
      texto: null,
      legenda: null,
      midia: url ? { url, mimeType: texto(audio.mimeType), nomeArquivo: null } : null,
    };
  }
  const video = obj(p.video);
  if (video) {
    const url = texto(video.videoUrl);
    return {
      tipoMensagem: "video",
      texto: null,
      legenda: texto(video.caption),
      midia: url ? { url, mimeType: texto(video.mimeType), nomeArquivo: null } : null,
    };
  }
  const sticker = obj(p.sticker);
  if (sticker) {
    const url = texto(sticker.stickerUrl);
    return {
      tipoMensagem: "sticker",
      texto: null,
      legenda: null,
      midia: url ? { url, mimeType: texto(sticker.mimeType), nomeArquivo: null } : null,
    };
  }
  const location = obj(p.location);
  if (location) {
    const onde =
      texto(location.address) ??
      (location.latitude != null && location.longitude != null
        ? `${location.latitude}, ${location.longitude}`
        : null);
    return { tipoMensagem: "localizacao", texto: onde, legenda: texto(location.url), midia: null };
  }
  const contact = obj(p.contact);
  if (contact) {
    return { tipoMensagem: "contato", texto: texto(contact.displayName), legenda: null, midia: null };
  }
  const text = obj(p.text);
  if (text) {
    return { tipoMensagem: "texto", texto: texto(text.message), legenda: null, midia: null };
  }
  // Resposta de botão ou de lista: o cliente escolheu uma opção — é texto.
  const botao = obj(p.buttonsResponseMessage) ?? obj(p.listResponseMessage);
  if (botao) {
    return {
      tipoMensagem: "texto",
      texto: texto(botao.message) ?? texto(botao.title),
      legenda: null,
      midia: null,
    };
  }
  return { tipoMensagem: "sistema", texto: null, legenda: null, midia: null };
}

export function classificarEventoZapi(payload: unknown): EventoZapi {
  const p = obj(payload);
  if (!p) return { tipo: "ignorado", instanceId: null, motivo: "corpo não é um objeto JSON" };

  const instanceId = texto(p.instanceId);
  const tipo = texto(p.type);
  if (!instanceId) return { tipo: "ignorado", instanceId: null, motivo: "evento sem instanceId" };

  switch (tipo) {
    case "ReceivedCallback": {
      if (p.isGroup === true) return { tipo: "ignorado", instanceId, motivo: "mensagem de grupo" };
      if (p.isNewsletter === true) return { tipo: "ignorado", instanceId, motivo: "mensagem de canal" };
      if (p.broadcast === true) {
        return { tipo: "ignorado", instanceId, motivo: "lista de transmissão" };
      }
      if (obj(p.reaction)) return { tipo: "ignorado", instanceId, motivo: "reação a mensagem" };
      // Mensagem ainda cifrada: o conteúdo não veio. Gravar agora faria a
      // versão legível, com o mesmo messageId, ser descartada como repetida.
      if (p.waitingMessage === true) {
        return { tipo: "ignorado", instanceId, motivo: "mensagem ainda cifrada no aparelho" };
      }

      const messageId = texto(p.messageId);
      const telefone = telefoneDePessoa(p.phone);
      if (!messageId) return { tipo: "ignorado", instanceId, motivo: "mensagem sem messageId" };
      if (!telefone) return { tipo: "ignorado", instanceId, motivo: "remetente não é um telefone" };

      return {
        tipo: "mensagem",
        instanceId,
        messageId,
        telefone,
        deMim: p.fromMe === true,
        nome: texto(p.senderName) ?? texto(p.chatName),
        ...conteudo(p),
        momento: momento(p.momment),
      };
    }

    case "MessageStatusCallback": {
      if (p.isGroup === true) return { tipo: "ignorado", instanceId, motivo: "recibo de grupo" };
      const ids = Array.isArray(p.ids)
        ? p.ids.filter((i): i is string => typeof i === "string" && i.trim() !== "")
        : [];
      if (ids.length === 0) return { tipo: "ignorado", instanceId, motivo: "recibo sem ids" };
      const status = mapearStatusZapi(p.status);
      if (!status) {
        return { tipo: "ignorado", instanceId, motivo: `recibo com status ${String(p.status)}` };
      }
      return { tipo: "status", instanceId, ids, status, momento: momento(p.momment) };
    }

    case "ConnectedCallback":
      return { tipo: "conexao", instanceId, conectado: true, momento: momento(p.momment) };

    case "DisconnectedCallback":
      return { tipo: "conexao", instanceId, conectado: false, momento: momento(p.momment) };

    default:
      return { tipo: "ignorado", instanceId, motivo: `tipo ${tipo ?? "ausente"} não tratado` };
  }
}

/**
 * Chave de idempotência do evento. O Z-API reenvia quando não recebe 200 a
 * tempo; sem chave, a mesma mensagem entraria duas vezes e o contador de não
 * lidas subiria em dobro.
 *
 * A mensagem cifrada tem chave própria (`espera:`) para não bloquear a versão
 * legível, que chega depois com o MESMO messageId.
 */
export function chaveDoEvento(payload: unknown): string | null {
  const p = obj(payload);
  if (!p) return null;
  const tipo = texto(p.type) ?? "sem-tipo";
  const messageId = texto(p.messageId);
  if (tipo === "ReceivedCallback" && messageId) {
    return `${p.waitingMessage === true ? "espera" : "msg"}:${messageId}`;
  }
  if (tipo === "MessageStatusCallback" && Array.isArray(p.ids)) {
    const ids = p.ids.filter((i): i is string => typeof i === "string").sort();
    if (ids.length > 0) return `status:${String(p.status)}:${ids.join(",")}`;
  }
  const quando = p.momment != null ? String(p.momment) : null;
  return quando ? `${tipo}:${quando}` : null;
}
