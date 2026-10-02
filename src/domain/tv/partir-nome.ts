/**
 * Nome de produto que não cabe na linha de baixo da fila NÃO é cortado: as
 * primeiras palavras sobem para a linha de cima, depois da etiqueta de prazo.
 *
 * Um trabalho na fila tem duas linhas. Em cima, "#205 ⚠ 2d" ocupa pouco; em
 * baixo, o nome do produto tem a largura toda (334 px a 24 px). Medido no
 * catálogo real em 01/10/2026: 12 dos 31 nomes passam de 334 px. Em vez de
 * reticências, a cabeça do nome ("Banner") sobe para a linha de cima e o
 * resto ("com bastão e corda") fica embaixo, inteiro.
 *
 * A regra é a da maquete (função partirNomes): sobe o MENOR número de palavras
 * que faz o resto caber embaixo, desde que a cabeça caiba em cima. Se nem
 * assim couber, fica inteiro embaixo, com reticências, e conta como cortado.
 *
 * `medir` é injetado: na tela é o `measureText` de um canvas com a fonte da
 * parede; no teste é uma régua fixa. Domínio puro.
 */

export type Medidor = (texto: string, fonte: string) => number;

/** As fontes das duas linhas, iguais ao CSS da fila (`.item .ca` e `.item .p`). */
export const FONTE_DA_CABECA =
  "500 24px Montserrat, system-ui, -apple-system, 'Segoe UI', sans-serif";
export const FONTE_DO_NOME = FONTE_DA_CABECA;

export type NomePartido = {
  /** o que sobe para a linha de cima; null quando o nome cabe inteiro embaixo */
  cabeca: string | null;
  /** o que fica na linha de baixo */
  resto: string;
  /** nem partindo coube: a linha de baixo vai sair com reticências */
  cortado: boolean;
};

/** Folga para a diferença entre o canvas e o texto desenhado (subpixel, hinting). */
const FOLGA_PX = 2;

export function partirNome(
  nome: string,
  medidas: {
    /** largura útil da linha de baixo (a coluna por dentro: 334 px) */
    larguraDaLinha: number;
    /** quanto da linha de cima ainda está livre, já descontado o vão antes da cabeça */
    livreNaLinhaDeCima: number;
    medir: Medidor;
  },
): NomePartido {
  const { larguraDaLinha, livreNaLinhaDeCima, medir } = medidas;
  const inteiro = nome.trim();
  if (medir(inteiro, FONTE_DO_NOME) + FOLGA_PX <= larguraDaLinha) {
    return { cabeca: null, resto: inteiro, cortado: false };
  }
  const palavras = inteiro.split(/\s+/);
  for (let k = 1; k < palavras.length; k++) {
    const cabeca = palavras.slice(0, k).join(" ");
    const resto = palavras.slice(k).join(" ");
    // a cabeça já não cabe na linha de cima: mais palavras só pioram
    if (medir(cabeca, FONTE_DA_CABECA) + FOLGA_PX > livreNaLinhaDeCima) break;
    if (medir(resto, FONTE_DO_NOME) + FOLGA_PX <= larguraDaLinha) {
      return { cabeca, resto, cortado: false };
    }
  }
  return { cabeca: null, resto: inteiro, cortado: true };
}
