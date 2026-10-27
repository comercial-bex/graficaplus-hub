import type { Botao } from "@/domain/whatsapp/zapi-envio";

/**
 * Os botões que acompanham o Pix do sinal (27/10/2026): só Pix, sem pagamento na entrega.
 * Resposta rápida (`send-button-list`, até 3): o cliente toca e o sistema responde.
 *
 * O Z-API avisa que botão depende do que o WhatsApp permite no momento. Por isso o envio tem
 * texto de reserva e a reação aceita também a palavra digitada: nada depende do botão aparecer.
 */
export type AcaoDoBotaoDoPix = "paguei" | "orcamento" | "equipe";

export const BOTOES_DO_PIX: ReadonlyArray<Botao & { acao: AcaoDoBotaoDoPix }> = [
  { id: "pix_paguei", rotulo: "Já paguei", acao: "paguei" },
  { id: "pix_orcamento", rotulo: "Ver orçamento", acao: "orcamento" },
  { id: "pix_equipe", rotulo: "Falar com a equipe", acao: "equipe" },
];

export const TEXTO_DOS_BOTOES_DO_PIX = "Precisa de mais alguma coisa? 👇";

const sem = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** O texto que a resposta de um botão (ou a mesma frase digitada) carrega → a ação. */
export function acaoDoBotaoDoPix(resposta: string | null | undefined): AcaoDoBotaoDoPix | null {
  const t = sem(resposta ?? "");
  if (!t) return null;
  for (const b of BOTOES_DO_PIX) if (sem(b.rotulo) === t) return b.acao;
  return null;
}

/** Quando o Z-API recusa botão, o mesmo menu vai como texto e a pessoa responde digitando. */
export function textoDeReservaDosBotoes(texto: string, botoes: ReadonlyArray<Botao>): string {
  return `${texto}\n\nÉ só responder com: ${botoes.map((b) => `*${b.rotulo}*`).join(", ")}.`;
}

export const RESPOSTAS_DO_PIX: Record<AcaoDoBotaoDoPix, (a: { numero: number; link: string | null }) => string> = {
  paguei: () =>
    "Ótimo! Me manda a foto ou o PDF do comprovante por aqui que eu confiro e libero o seu pedido. 🧾",
  orcamento: ({ numero, link }) =>
    link
      ? `Aqui está o orçamento nº ${numero}. Você confere os itens e aprova por este link:\n${link}`
      : `Já te mando o orçamento nº ${numero} por aqui.`,
  equipe: () => "Certo! Já avisei a equipe. Alguém responde por aqui em instantes. 🙌",
};
