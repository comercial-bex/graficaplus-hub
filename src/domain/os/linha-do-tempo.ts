/**
 * A linha do tempo da OS: quem levou a OS a cada etapa, quando, e quanto tempo ela
 * ficou ali (pedido do dono, 15/11/2026: "responsabilizando também por cada etapa").
 *
 * Vem de `os_status_historico`, que o banco grava em toda troca de status com quem
 * mudou (`mudou_por`). O tempo de cada passo vai da troca dele até a troca seguinte;
 * o último conta até agora.
 */

export type TrocaDeStatus = {
  status_anterior: string | null;
  status_novo: string;
  mudou_em: string;
  mudou_por: string | null;
};

export type PassoDaLinha = {
  status: string;
  /** Quem levou a OS a este status; nulo = o sistema. */
  por: string | null;
  em: string;
  /** Minutos neste status (até a troca seguinte, ou até agora no atual). */
  minutos: number;
  atual: boolean;
  /** Primeiro registro: a OS nasceu aqui. */
  abertura: boolean;
};

export function linhaDoTempo(trocas: readonly TrocaDeStatus[], agora: Date = new Date()): PassoDaLinha[] {
  const ordem = [...trocas].sort((a, b) => a.mudou_em.localeCompare(b.mudou_em));
  return ordem.map((t, i) => {
    const fim = i + 1 < ordem.length ? new Date(ordem[i + 1].mudou_em) : agora;
    const minutos = Math.max(0, Math.floor((fim.getTime() - new Date(t.mudou_em).getTime()) / 60_000));
    return {
      status: t.status_novo,
      por: t.mudou_por,
      em: t.mudou_em,
      minutos,
      atual: i === ordem.length - 1,
      abertura: t.status_anterior === null,
    };
  });
}

/** "45 min", "3h", "3h 20min", "2d 4h". */
export function duracaoEmPalavras(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return resto > 0 && horas < 10 ? `${horas}h ${resto}min` : `${horas}h`;
  }
  const dias = Math.floor(horas / 24);
  const h = horas % 24;
  return h > 0 ? `${dias}d ${h}h` : `${dias}d`;
}
