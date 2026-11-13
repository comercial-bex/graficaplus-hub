/**
 * O tocador de voz da bolha (onda 1, 12/11/2026, dono MIDIA): velocidade em
 * ciclo, duração formatada, clique na barra e "um áudio por vez".
 */

export const VELOCIDADES = [1, 1.5, 2] as const;

/** 1x, depois 1,5x, depois 2x, e volta para 1x. Valor estranho volta para 1x. */
export function proximaVelocidade(atual: number): number {
  const i = VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]);
  if (i < 0) return VELOCIDADES[0];
  return VELOCIDADES[(i + 1) % VELOCIDADES.length];
}

/** "1x", "1,5x", "2x" (vírgula decimal). */
export function rotuloDaVelocidade(v: number): string {
  return `${String(v).replace(".", ",")}x`;
}

/** "0:07", "1:05", "12:03". Sem duração conhecida (NaN, infinito, negativo), "0:00". */
export function formatarDuracao(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return "0:00";
  const total = Math.floor(segundos);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Quanto do áudio já passou, de 0 a 1. */
export function fracaoTocada(atual: number, duracao: number): number {
  if (!Number.isFinite(duracao) || duracao <= 0 || !Number.isFinite(atual)) return 0;
  return Math.min(1, Math.max(0, atual / duracao));
}

/** O clique na barra (x do ponteiro, borda esquerda e largura da barra) vira uma posição de 0 a 1. */
export function fracaoDoClique(x: number, esquerda: number, largura: number): number {
  if (!(largura > 0)) return 0;
  return Math.min(1, Math.max(0, (x - esquerda) / largura));
}

/** O que o navegador precisa ter para mudar a velocidade sem mudar a voz. */
export type ElementoDeAudio = {
  playbackRate: number;
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
  pause(): void;
};

/** Muda a velocidade MANTENDO o tom (sem voz de esquilo nem de monstro). */
export function aplicarVelocidade(el: ElementoDeAudio, v: number) {
  el.playbackRate = v;
  el.preservesPitch = true;
  // Safari mais antigo só conhece o nome com prefixo.
  el.webkitPreservesPitch = true;
}

/**
 * Um áudio por vez: ao começar um, o que estava tocando pausa. Cada tocador
 * se registra ao dar play e se solta ao pausar ou sair da tela.
 */
export function criarRegistroDeAudio() {
  let atual: ElementoDeAudio | null = null;
  return {
    tocar(el: ElementoDeAudio) {
      if (atual && atual !== el) atual.pause();
      atual = el;
    },
    soltar(el: ElementoDeAudio) {
      if (atual === el) atual = null;
    },
    get tocando() {
      return atual;
    },
  };
}

export const registroDeAudio = criarRegistroDeAudio();

/** O formato do arquivo de voz do WhatsApp: Ogg com Opus (o Safari antigo não toca). */
export const MIME_DA_VOZ = 'audio/ogg; codecs="opus"';

/**
 * O aparelho diz que NÃO toca este formato (`canPlayType` devolve vazio).
 * Só vale para Ogg: outro formato segue para o tocador e o erro de carga, se
 * vier, mostra o aviso.
 */
export function aparelhoNaoTocaOgg(
  nome: string,
  canPlayType: (mime: string) => string,
): boolean {
  if (!/\.(ogg|oga|opus)$/i.test(nome)) return false;
  return canPlayType(MIME_DA_VOZ) === "";
}
