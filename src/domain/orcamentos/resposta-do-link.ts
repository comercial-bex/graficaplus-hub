/**
 * O link do cliente e a resposta dele (17/11/2026, onda 1 de orçamentos).
 *
 * Quem decide se o cliente pode responder é a função do banco `responder_orcamento_publico`: só enviado, sem
 * OS e dentro da validade. A server function só repassa o pedido e traduz a resposta. Este arquivo NÃO
 * reimplementa a regra para gravar; ele só (1) traduz o `codigo` devolvido pelo banco em texto para o cliente e
 * (2) deduz, para a página, a mesma situação a mostrar antes de o cliente escrever o nome, para não oferecer
 * um botão que o banco vai recusar. Na dúvida o banco decide de novo a cada resposta.
 */

export type SituacaoDoLink =
  | "aceita"
  | "aprovado"
  | "recusado"
  | "vencido"
  | "encerrado"
  | "nao_liberado"
  | "ja_virou_pedido";

export const MENSAGEM_LINK_INDISPONIVEL = "Não foi possível registrar sua resposta agora. Fale com a equipe.";

/** Texto por `codigo` do banco, no tom do cliente. */
export const TEXTO_POR_CODIGO: Record<string, string> = {
  ok: "Resposta registrada.",
  ja_aprovado: "Este orçamento já foi aprovado. Não precisa responder de novo.",
  ja_virou_pedido: "Este orçamento já virou pedido e está em produção.",
  vencido: "A validade deste orçamento acabou. Fale com a equipe para receber um novo.",
  encerrado: "Este orçamento já foi encerrado. Fale com a equipe se quiser retomar.",
  nao_liberado: "Este orçamento ainda não foi liberado para resposta. Fale com a equipe.",
  nao_encontrado: "Este link não existe mais. Fale com a equipe para receber um novo.",
  decisao_invalida: "Não foi possível registrar sua resposta.",
  dados_invalidos: "Informe seu nome completo para registrar a resposta.",
};

export interface RespostaDoLink {
  ok: boolean;
  codigo: string;
  status: string | null;
  mensagem: string;
}

/** Traduz o jsonb do banco. Formato inesperado falha fechado: nunca conta como resposta registrada. */
export function interpretarRespostaDoBanco(bruto: unknown): RespostaDoLink {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, codigo: "indisponivel", status: null, mensagem: MENSAGEM_LINK_INDISPONIVEL };
  }
  const r = bruto as Record<string, unknown>;
  const codigo = typeof r.codigo === "string" ? r.codigo : "";
  const status = typeof r.status === "string" ? r.status : null;
  if (r.ok === true && codigo === "ok") return { ok: true, codigo, status, mensagem: TEXTO_POR_CODIGO.ok };
  return {
    ok: false,
    codigo: codigo || "indisponivel",
    status,
    mensagem: TEXTO_POR_CODIGO[codigo] ?? MENSAGEM_LINK_INDISPONIVEL,
  };
}

const MS_DIA = 86_400_000;

/** Data de Brasília no formato AAAA-MM-DD. */
export function diaEmBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Último dia em que o link responde: o dia do envio em Brasília mais `validade_dias`. Conta do envio
 * (na falta dele, da criação) e o último dia vale inteiro.
 */
export function validoAteDoLink(o: { enviado_em?: string | null; created_at?: string | null; validade_dias?: number | null }): string | null {
  const base = o.enviado_em ?? o.created_at ?? null;
  if (!base) return null;
  const t = new Date(base);
  if (!Number.isFinite(t.getTime())) return null;
  const dias = Number(o.validade_dias ?? 7);
  const [a, m, d] = diaEmBrasilia(t).split("-").map(Number);
  const fim = new Date(Date.UTC(a, m - 1, d) + (Number.isFinite(dias) ? dias : 7) * MS_DIA);
  return fim.toISOString().slice(0, 10);
}

/** Situação mostrada na página, deduzida só para exibição. */
export function situacaoDoLink(
  o: { status: string; os_id?: string | null; enviado_em?: string | null; created_at?: string | null; validade_dias?: number | null },
  agora: Date,
): SituacaoDoLink {
  if (o.status === "convertido" || o.os_id) return "ja_virou_pedido";
  if (o.status === "aprovado") return "aprovado";
  if (o.status === "rejeitado") return "recusado";
  if (o.status === "expirado") return "vencido";
  if (o.status === "rascunho") return "nao_liberado";
  if (o.status !== "enviado") return "encerrado";
  const ate = validoAteDoLink(o);
  if (ate && diaEmBrasilia(agora) > ate) return "vencido";
  return "aceita";
}

/** A página tolera servidor antigo que não manda `situacao`: deduz do status. */
export function situacaoParaAPagina(o: { status: string; situacao?: SituacaoDoLink | null }): SituacaoDoLink {
  if (o.situacao) return o.situacao;
  if (o.status === "aprovado" || o.status === "convertido") return "aprovado";
  if (o.status === "rejeitado") return "recusado";
  if (o.status === "expirado") return "vencido";
  if (o.status === "rascunho") return "nao_liberado";
  if (o.status === "enviado") return "aceita";
  return "encerrado";
}

/** O texto do Card de mensagem, ou null quando o cliente pode responder ou o orçamento já está aprovado. */
export function mensagemDaSituacao(s: SituacaoDoLink): { titulo: string; texto: string } | null {
  switch (s) {
    case "aceita":
    case "aprovado":
      return null;
    case "recusado":
      return { titulo: "Orçamento recusado", texto: "Este orçamento foi marcado como recusado. Fale com a equipe se quiser retomar." };
    case "vencido":
      return { titulo: "Validade encerrada", texto: TEXTO_POR_CODIGO.vencido };
    case "nao_liberado":
      return { titulo: "Ainda não liberado", texto: TEXTO_POR_CODIGO.nao_liberado };
    case "ja_virou_pedido":
      return { titulo: "Já virou pedido", texto: TEXTO_POR_CODIGO.ja_virou_pedido };
    default:
      return { titulo: "Orçamento encerrado", texto: TEXTO_POR_CODIGO.encerrado };
  }
}
