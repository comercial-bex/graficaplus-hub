/**
 * O despachante: quem aciona o envio do WhatsApp sem ninguém clicar.
 *
 * Sem `pg_cron` e sem `pg_net` no projeto, o banco não chama nada sozinho, e
 * a função `process-automations` não tem quem a dispare. Os avisos ao cliente
 * (`notificacoes_fila`) ficavam esperando alguém responder uma conversa para
 * pegar carona no POST /api/whatsapp/enviar. Desde 02/10/2026, com o WhatsApp
 * conectado, o dono decidiu: os avisos saem na hora. Quem os leva é o próprio
 * sistema aberto na tela de quem atende — cada aba visível de quem tem
 * `whatsapp.reply` chama o envio a cada 2 minutos.
 *
 * Várias abas, várias pessoas: o consumidor RESERVA cada linha antes de
 * mandar (`pendente` → `enviando` só se ainda estava pendente), então duas
 * chamadas ao mesmo tempo não mandam o mesmo aviso duas vezes.
 */

/** De quanto em quanto tempo cada aba visível chama o envio. */
export const INTERVALO_DO_DESPACHANTE_MS = 2 * 60_000;

/** A aba confere a decisão a cada tanto — barato, sem chamar o servidor. */
export const CONFERIR_A_CADA_MS = 15_000;

export type EstadoDoDespachante = {
  temPermissao: boolean;
  abaVisivel: boolean;
  /** Uma chamada por vez: a anterior ainda não voltou. */
  emAndamento: boolean;
  /** Quando a última chamada COMEÇOU (ms); null = ainda não chamou nesta aba. */
  ultimaChamadaEm: number | null;
  agora: number;
  intervaloMs?: number;
};

/** Chamar o envio agora? */
export function deveChamarAgora(e: EstadoDoDespachante): boolean {
  if (!e.temPermissao) return false;
  // Aba escondida não chama: o pedido do dono é "com o sistema aberto", e dez
  // abas esquecidas em segundo plano não podem virar dez despachantes.
  if (!e.abaVisivel) return false;
  if (e.emAndamento) return false;
  if (e.ultimaChamadaEm === null) return true; // logo ao montar
  return e.agora - e.ultimaChamadaEm >= (e.intervaloMs ?? INTERVALO_DO_DESPACHANTE_MS);
}

/* ------------------------------------------------------------------ */
/* Nova tentativa e linha presa                                        */
/* ------------------------------------------------------------------ */

/**
 * Espera antes da próxima tentativa de um aviso que falhou sem ser definitivo
 * (rede, Z-API fora do ar): 1, 5, 15 e depois 60 minutos. Sem espera, o
 * despachante de 2 em 2 minutos gastaria as cinco tentativas em dez minutos de
 * instabilidade — e o aviso viraria "falhou" por pressa.
 */
export const ESPERAS_EM_MINUTOS = [1, 5, 15, 60] as const;

/** `tentativas` é a contagem JÁ incluindo a que acabou de falhar (1, 2, 3…). */
export function minutosAteAProximaTentativa(tentativas: number): number {
  const i = Math.min(Math.max(Math.trunc(tentativas), 1), ESPERAS_EM_MINUTOS.length) - 1;
  return ESPERAS_EM_MINUTOS[i];
}

export function proximaTentativaEm(agora: Date, tentativas: number): string {
  return new Date(agora.getTime() + minutosAteAProximaTentativa(tentativas) * 60_000).toISOString();
}

/**
 * Linha em `enviando` há mais que isso: a rodada que a reservou morreu no meio
 * (aba fechada, servidor reiniciado). Ela volta para `pendente` no começo da
 * rodada seguinte.
 */
export const PRESA_APOS_MS = 10 * 60_000;

export function limiteDePresa(agora: Date): string {
  return new Date(agora.getTime() - PRESA_APOS_MS).toISOString();
}
