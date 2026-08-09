/**
 * Navegação por teclado entre as colunas do Kanban.
 *
 * O KeyboardSensor do dnd-kit desloca o item 25px por seta. Num quadro de
 * colunas de 320px isso nunca alcança a coluna vizinha, e a tecla parecia não
 * fazer nada — apesar de o dnd-kit anunciar ao leitor de tela "use the arrow
 * keys to move the item". Cada seta horizontal precisa saltar uma coluna inteira.
 *
 * A parte que erra é a aritmética de índice e de centro; ela vive aqui, separada
 * do dnd-kit, para poder ser testada sem navegador.
 */

export type ColunaAlvo = {
  id: string;
  left: number;
  right: number;
  width: number;
  top: number;
};

export type Direcao = 1 | -1;

const centro = (c: ColunaAlvo) => c.left + c.width / 2;

/** Colunas na ordem em que aparecem na tela (esquerda para a direita). */
export function ordenarColunas(colunas: ColunaAlvo[]): ColunaAlvo[] {
  return [...colunas].sort((a, b) => a.left - b.left);
}

/**
 * Índice da coluna sob o cartão. Quando o cartão está entre duas — meio de um
 * salto, ou solto numa faixa vazia — devolve a de centro mais próximo, para a
 * seta seguinte continuar de onde o usuário está vendo o cartão.
 */
export function indiceColunaAtual(colunas: ColunaAlvo[], centroCartao: number): number {
  if (colunas.length === 0) return -1;

  const sob = colunas.findIndex((c) => centroCartao >= c.left && centroCartao <= c.right);
  if (sob !== -1) return sob;

  return colunas.reduce(
    (maisProxima, coluna, i) =>
      Math.abs(centroCartao - centro(coluna)) <
      Math.abs(centroCartao - centro(colunas[maisProxima]))
        ? i
        : maisProxima,
    0,
  );
}

/**
 * Coluna de destino de uma seta. null nas pontas: na primeira coluna a seta
 * esquerda não faz nada, e o cartão não escapa da faixa do quadro.
 */
export function proximaColuna(
  colunas: ColunaAlvo[],
  centroCartao: number,
  direcao: Direcao,
): ColunaAlvo | null {
  const ordenadas = ordenarColunas(colunas);
  const atual = indiceColunaAtual(ordenadas, centroCartao);
  if (atual === -1) return null;
  return ordenadas[atual + direcao] ?? null;
}

/**
 * Posição a devolver ao dnd-kit: canto superior esquerdo do cartão para que ele
 * fique centralizado na coluna de destino. O deslocamento vertical afasta do
 * cabeçalho da coluna, para a colisão cair sobre a área de soltar.
 */
export function coordenadaNaColuna(destino: ColunaAlvo, larguraCartao: number) {
  return {
    x: centro(destino) - larguraCartao / 2,
    y: destino.top + 8,
  };
}
