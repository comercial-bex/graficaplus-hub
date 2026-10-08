/**
 * O despachante: quem aciona o envio do WhatsApp sem ninguém clicar.
 *
 * DOIS DESPACHANTES, O MESMO CONSUMIDOR.
 *
 * 1. O do navegador (`despachante-de-avisos.tsx`): cada aba visível de quem
 *    tem `whatsapp.reply` chama POST /api/whatsapp/enviar a cada 2 minutos.
 *    Existe desde 02/10/2026, quando o banco não tinha `pg_cron` nem `pg_net`.
 *    Só funciona com o sistema aberto: medido em 06/10, o aviso "orçamento
 *    aprovado" levou de 36 min a 2 h 14 para sair, e à noite não saía.
 *
 * 2. O do servidor (`/api/whatsapp/despachar`, migração de 06/10/2026): um
 *    job do `pg_cron` chama a rota a cada 2 minutos, 24 h, com o token que
 *    mora no Vault do banco e em DESPACHANTE_TOKEN no servidor. Sem a
 *    variável a rota responde 503 e o despachante do navegador segue
 *    valendo — nada depende de o servidor estar ligado para o aviso sair.
 *
 * Várias abas, várias pessoas e o servidor, ao mesmo tempo: o consumidor
 * RESERVA cada linha antes de mandar (`pendente` → `enviando` só se ainda
 * estava pendente), então duas chamadas simultâneas não mandam o mesmo
 * aviso duas vezes.
 */

/** De quanto em quanto tempo cada aba visível chama o envio. */
export const INTERVALO_DO_DESPACHANTE_MS = 2 * 60_000;

/**
 * A aba confere a decisão a cada 15 segundos — barato, sem chamar o
 * servidor. A chamada em si respeita INTERVALO_DO_DESPACHANTE_MS (2 min).
 */
export const CONFERIR_A_CADA_MS = 15_000;

/** O cabeçalho em que o despachante do servidor manda o token (nunca na URL). */
export const CABECALHO_DO_DESPACHANTE = "x-despachante-token";

/** A frase do 503 quando não há token do despachante em lugar nenhum (variável nem Vault). */
export const DESPACHANTE_DESLIGADO = "despachante do servidor desligado";

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
