/**
 * O visor de fotos da conversa (onda 1, 12/11/2026, dono MIDIA): andar entre
 * as fotos com as setas, parar no começo e no fim, o contador e o Esc.
 */

/** A próxima foto; no fim da lista fica onde está (não dá a volta). */
export function proximaFoto(indice: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, indice + 1);
}

/** A foto anterior; no começo da lista fica onde está. */
export function fotoAnterior(indice: number, _total: number): number {
  return Math.max(0, indice - 1);
}

/** "3 de 12". Uma foto só não mostra contador. */
export function contadorDeFotos(indice: number, total: number): string | null {
  if (total <= 1) return null;
  return `${Math.min(indice, total - 1) + 1} de ${total}`;
}

/** Onde a foto da bolha está na lista; fora da lista, -1. */
export function indiceDaFoto(fotos: readonly { id: string }[], id: string): number {
  return fotos.findIndex((f) => f.id === id);
}

export type PassoDoVisor = { indice: number; fechar: boolean; tratada: boolean };

/**
 * O que cada tecla faz no visor. Esc fecha. Seta para a direita e para a
 * esquerda andam (sem dar a volta). Home e End vão ao começo e ao fim.
 * `tratada` diz se o visor consumiu a tecla (aí quem chama dá `preventDefault`).
 */
export function teclaDoVisor(tecla: string, indice: number, total: number): PassoDoVisor {
  switch (tecla) {
    case "Escape":
      return { indice, fechar: true, tratada: true };
    case "ArrowRight":
      return { indice: proximaFoto(indice, total), fechar: false, tratada: true };
    case "ArrowLeft":
      return { indice: fotoAnterior(indice, total), fechar: false, tratada: true };
    case "Home":
      return { indice: 0, fechar: false, tratada: true };
    case "End":
      return { indice: Math.max(0, total - 1), fechar: false, tratada: true };
    default:
      return { indice, fechar: false, tratada: false };
  }
}
