/**
 * Diagnóstico dos webhooks do Z-API a partir dos eventos gravados.
 *
 * Cada campo do painel do Z-API manda um `type` diferente. Olhando quais
 * tipos já chegaram, dá para dizer qual campo está colado e qual não está.
 */

export type EventoGravado = {
  id: string;
  created_at: string;
  processado_em: string | null;
  erro: string | null;
  payload: unknown;
};

export type WebhookZapi = "receber" | "status" | "conectar" | "desconectar";

export const WEBHOOKS: { chave: WebhookZapi; rotulo: string; tipo: string }[] = [
  { chave: "receber", rotulo: "Ao receber", tipo: "ReceivedCallback" },
  { chave: "status", rotulo: "Receber status da mensagem", tipo: "MessageStatusCallback" },
  { chave: "conectar", rotulo: "Ao conectar", tipo: "ConnectedCallback" },
  { chave: "desconectar", rotulo: "Ao desconectar", tipo: "DisconnectedCallback" },
];

const ROTULO_TIPO: Record<string, string> = {
  ReceivedCallback: "Mensagem recebida",
  MessageStatusCallback: "Status da mensagem",
  ConnectedCallback: "Conectou",
  DisconnectedCallback: "Desconectou",
  PresenceChatCallback: "Presença",
  DeliveryCallback: "Envio",
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function tipoDoEvento(payload: unknown): string {
  const t = obj(payload).type;
  return typeof t === "string" ? t : "desconhecido";
}

export function rotuloDoTipo(tipo: string): string {
  return ROTULO_TIPO[tipo] ?? tipo;
}

export type SituacaoEvento = "processado" | "erro" | "pendente";

export function situacaoDoEvento(e: Pick<EventoGravado, "processado_em" | "erro">): SituacaoEvento {
  if (e.erro) return "erro";
  return e.processado_em ? "processado" : "pendente";
}

/** Uma linha curta com o que ajuda a entender o evento. */
export function detalheDoEvento(payload: unknown): string {
  const p = obj(payload);
  const partes: string[] = [];
  const tel = p.phone;
  if (typeof tel === "string") partes.push(`tel. ${tel}`);
  if (p.fromMe === true) partes.push("enviada pela empresa");
  if (p.isGroup === true) partes.push("grupo (ignorado)");
  if (typeof p.status === "string") partes.push(`status ${p.status}`);
  const texto = obj(p.text).message;
  if (typeof texto === "string") partes.push(`“${texto.slice(0, 60)}${texto.length > 60 ? "…" : ""}”`);
  if (obj(p.image).imageUrl) partes.push("imagem");
  if (obj(p.document).documentUrl) partes.push("documento");
  if (obj(p.audio).audioUrl) partes.push("áudio");
  if (typeof p.error === "string" && p.error) partes.push(`erro Z-API: ${p.error}`);
  return partes.join(" · ") || "—";
}

export type EstadoWebhook = {
  chave: WebhookZapi;
  rotulo: string;
  ultimo: string | null;
  total: number;
  erros: number;
  /** Chegou evento deste tipo depois do início do teste. */
  noTeste: boolean;
};

export function estadoDosWebhooks(eventos: EventoGravado[], desde?: string | null): EstadoWebhook[] {
  return WEBHOOKS.map((w) => {
    const deste = eventos.filter((e) => tipoDoEvento(e.payload) === w.tipo);
    const ultimo = deste.reduce<string | null>((m, e) => (!m || e.created_at > m ? e.created_at : m), null);
    return {
      chave: w.chave,
      rotulo: w.rotulo,
      ultimo,
      total: deste.length,
      erros: deste.filter((e) => e.erro).length,
      noTeste: !!desde && deste.some((e) => e.created_at >= desde),
    };
  });
}

export type Alerta = { nivel: "critico" | "atencao"; titulo: string; detalhe: string };

/** Sem nenhum evento por este tempo, o webhook provavelmente parou. */
export const SILENCIO_HORAS = 24;

export function alertasDaConexao(
  instancia: { conectado: boolean | null; status: string | null; ultimo_evento_at: string | null; ativa: boolean | null } | null,
  errosRecentes: number,
  agora: Date = new Date(),
): Alerta[] {
  if (!instancia || instancia.ativa === false) return [];
  const alertas: Alerta[] = [];
  if (instancia.conectado === false || instancia.status === "desconectada") {
    alertas.push({
      nivel: "critico",
      titulo: "WhatsApp desconectado",
      detalhe: "O celular saiu do Z-API. Nenhuma mensagem entra ou sai até ler o QR Code de novo no painel deles.",
    });
  }
  if (instancia.ultimo_evento_at) {
    const horas = (agora.getTime() - new Date(instancia.ultimo_evento_at).getTime()) / 36e5;
    if (horas >= SILENCIO_HORAS) {
      alertas.push({
        nivel: "atencao",
        titulo: "Webhook sem eventos",
        detalhe: `Nenhum evento do Z-API há ${Math.floor(horas)} h. Confira os webhooks no painel deles e rode a verificação no Monitor.`,
      });
    }
  }
  if (errosRecentes > 0) {
    alertas.push({
      nivel: "atencao",
      titulo: "Eventos com falha",
      detalhe: `${errosRecentes} evento(s) nas últimas 24 h chegaram mas não foram processados. Veja o histórico no Monitor.`,
    });
  }
  return alertas;
}
