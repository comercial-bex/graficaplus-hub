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

/**
 * "processado_com_falha" é o evento que ENTROU (a mensagem foi gravada) mas
 * deixou algo para trás — a cópia da mídia, por exemplo. Antes ele aparecia
 * como "processado" e o motivo só voltava ao Z-API na resposta HTTP, que
 * ninguém lê: foi assim que um PDF de cliente ficou no bucket sem linha em
 * `arquivos` e sem ninguém saber (06/10/2026).
 */
export type SituacaoEvento = "processado" | "processado_com_falha" | "erro" | "pendente";

export const ROTULO_SITUACAO: Record<SituacaoEvento, string> = {
  processado: "Processado",
  processado_com_falha: "Processado com falha",
  erro: "Com erro",
  pendente: "Pendente",
};

export function situacaoDoEvento(e: Pick<EventoGravado, "processado_em" | "erro">): SituacaoEvento {
  if (e.processado_em && e.erro) return "processado_com_falha";
  if (e.erro) return "erro";
  return e.processado_em ? "processado" : "pendente";
}

/** O evento trouxe mídia (imagem, documento, áudio, vídeo ou figurinha)? */
export function eventoTemMidia(payload: unknown): boolean {
  const p = obj(payload);
  if (p.type !== "ReceivedCallback") return false;
  return !!(
    obj(p.image).imageUrl ||
    obj(p.document).documentUrl ||
    obj(p.audio).audioUrl ||
    obj(p.video).videoUrl ||
    obj(p.sticker).stickerUrl
  );
}

/* ------------------------------------------------------------------ */
/* As duas medidas permanentes da entrada                              */
/* ------------------------------------------------------------------ */

/**
 * O que a função `whatsapp_medidas_de_entrada` do banco devolve.
 *
 *   recibos_sem_mensagem  READ_BY_ME (a empresa leu no celular) cujo id não
 *                         tem evento `msg:<id>`: a mensagem chegou no aparelho
 *                         e NUNCA chegou ao sistema. Em 06/10/2026 era 1
 *                         ("Gratidão", 17:35 UTC) — o webhook caiu na loteria
 *                         de DNS que havia até esse dia.
 *   midias_sem_copia      mensagens com link de mídia do Z-API e sem cópia no
 *                         nosso armazenamento. O link vence em 30 dias.
 *
 * Os dois números certos são ZERO. Qualquer coisa acima é mensagem de cliente
 * que o sistema deve e não tem.
 */
export type MedidasDeEntrada = {
  recibos_sem_mensagem: number;
  midias_sem_copia: number;
  recibos: { id: string; telefone: string | null; momento: string | null }[];
  medido_em: string;
};

export function lerMedidasDeEntrada(valor: unknown): MedidasDeEntrada {
  const v = obj(valor);
  const n1 = Number(v.recibos_sem_mensagem);
  const n2 = Number(v.midias_sem_copia);
  if (!Number.isInteger(n1) || !Number.isInteger(n2) || typeof v.medido_em !== "string") {
    throw new Error("a função whatsapp_medidas_de_entrada devolveu um formato inesperado");
  }
  const recibos = Array.isArray(v.recibos)
    ? v.recibos.map((r) => {
        const o = obj(r);
        return {
          id: String(o.id ?? ""),
          telefone: typeof o.telefone === "string" ? o.telefone : null,
          momento: typeof o.momento === "string" ? o.momento : null,
        };
      })
    : [];
  return { recibos_sem_mensagem: n1, midias_sem_copia: n2, recibos, medido_em: v.medido_em };
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
    // Dois casos com a mesma cara no banco e remédios de frase diferente.
    // Instância que nunca recebeu evento nunca foi pareada: o lembrete é
    // "falta escanear", e ele fica no topo de toda tela, para administrador e
    // gestor, até alguém fazer — é o passo que destrava recepção, resposta e
    // os avisos automáticos aos clientes, que hoje esperam na fila.
    alertas.push(
      instancia.ultimo_evento_at
        ? {
            nivel: "critico",
            titulo: "WhatsApp desconectado",
            detalhe: "O celular saiu do Z-API. Nenhuma mensagem entra ou sai até ler o QR Code de novo no painel deles.",
          }
        : {
            nivel: "critico",
            titulo: "Falta escanear o QR Code do WhatsApp",
            detalhe:
              "A instância está cadastrada, mas o celular da gráfica ainda não foi pareado no Z-API. Enquanto isso nenhuma mensagem entra ou sai — nem os avisos automáticos aos clientes. Escaneie o QR Code no painel do Z-API com o WhatsApp da empresa e clique em Verificar no Monitor.",
          },
    );
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
