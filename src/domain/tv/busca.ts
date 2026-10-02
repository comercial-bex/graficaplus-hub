/**
 * As regras da busca do painel, sem rede: o que cada resposta da rota
 * significa para a TV e quanto esperar antes da próxima tentativa.
 *
 * O contrato de `GET /api/tv/painel` (tv-painel.server.ts):
 *   200  o jsonb do painel
 *   401  {erro:"tv_nao_pareada" | "tv_revogada"}  → apagar o crachá e voltar
 *        ao pareamento, dizendo o motivo
 *   503  {erro:"banco_indisponivel"}              → NÃO apagar o crachá; manter
 *        o último dado esmaecido e avisar SEM CONEXÃO
 *   outro status, rede fora, JSON ilegível        → o mesmo que 503
 *
 * Nova tentativa: 5 s depois da primeira falha, 15 s depois da segunda, e daí
 * em diante no ritmo normal (intervalo_s). A busca só acontece com a aba
 * visível — isso é do hook, não daqui.
 */

import { VERSAO_DO_PAINEL, lerPainel, type PainelDaOficina } from "./painel";

export type RespostaDaBusca =
  | { tipo: "painel"; painel: PainelDaOficina }
  | { tipo: "recusada"; motivo: "tv_nao_pareada" | "tv_revogada" }
  | { tipo: "contrato"; motivo: string }
  | { tipo: "servidor"; motivo: string };

/**
 * Lê status + corpo (já decodificado, ou `undefined` se o JSON não veio) e
 * diz o que a TV faz. Nunca devolve "painel" com dado que não passou em
 * `lerPainel`: falha de contrato é erro nomeado, não tela vazia.
 */
export function interpretarResposta(status: number, corpo: unknown): RespostaDaBusca {
  if (status === 401) {
    const erro =
      corpo && typeof corpo === "object" ? (corpo as { erro?: unknown }).erro : undefined;
    // 401 com motivo desconhecido: ainda é "sem crachá válido" — o servidor
    // recusou; mas sem nomear o motivo a tela diz o genérico.
    return { tipo: "recusada", motivo: erro === "tv_revogada" ? "tv_revogada" : "tv_nao_pareada" };
  }
  if (status === 200) {
    const leitura = lerPainel(corpo);
    if (leitura.ok) return { tipo: "painel", painel: leitura.painel };
    return { tipo: "contrato", motivo: leitura.motivo };
  }
  if (status === 503) return { tipo: "servidor", motivo: "servidor sem resposta (503)" };
  return { tipo: "servidor", motivo: `resposta inesperada do servidor (HTTP ${status})` };
}

export const ESPERA_APOS_FALHA_MS = [5_000, 15_000] as const;

/**
 * Quanto esperar antes da tentativa seguinte, dado quantas falhas seguidas já
 * houve: 5 s, 15 s, depois o intervalo normal. `intervaloS` vem do painel;
 * sem painel ainda, vale 60.
 */
export function esperaAteAProximaBuscaMs(
  falhasSeguidas: number,
  intervaloS: number | null,
): number {
  const intervalo = intervaloS && intervaloS > 0 ? intervaloS : 60;
  if (falhasSeguidas <= 0) return intervalo * 1000;
  return ESPERA_APOS_FALHA_MS[falhasSeguidas - 1] ?? intervalo * 1000;
}

/** Recusa (401) e contrato não melhoram repetindo em 5 s: só a próxima rodada tenta de novo. */
export function valeTentarDeNovo(
  resposta: RespostaDaBusca["tipo"],
  falhasSeguidas: number,
): boolean {
  return resposta === "servidor" && falhasSeguidas < ESPERA_APOS_FALHA_MS.length;
}

/** A versão que a tela entende — para a mensagem de contrato dizer qual é. */
export const VERSAO_QUE_A_TELA_LE = VERSAO_DO_PAINEL;
