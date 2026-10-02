/**
 * Listas que não cabem NÃO rolam nem cortam linha pela metade: mostram só
 * linhas inteiras e trocam de página a cada PAGINA_S segundos — e só com dado
 * ao vivo (fora do AO VIVO nada se move na parede).
 *
 * Os números vêm da grade medida na maquete (desenho v2.1): dentro da coluna
 * sobram 287 px para a fila sem a faixa de aviso e 231 px com ela; cada
 * trabalho tem 57 px. Logo 5 trabalhos inteiros sem faixa, 4 com. O palco é
 * fixo em 1920×1080, então a conta é a mesma em qualquer TV.
 */

export const PAGINA_S = 8;
export const ALTURA_DO_TRABALHO_PX = 57;
export const TRABALHOS_POR_PAGINA = { semFaixa: 5, comFaixa: 4 } as const;

export function trabalhosPorPagina(temFaixa: boolean): number {
  return temFaixa ? TRABALHOS_POR_PAGINA.comFaixa : TRABALHOS_POR_PAGINA.semFaixa;
}

/** Parte a lista em páginas de `porPagina` itens; lista vazia dá uma página vazia. */
export function paginar<T>(itens: readonly T[], porPagina: number): T[][] {
  const tamanho = Math.max(1, Math.floor(porPagina));
  if (itens.length === 0) return [[]];
  const paginas: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) paginas.push(itens.slice(i, i + tamanho));
  return paginas;
}

/** A página a mostrar no tique `tique` (0, 1, 2…): dá a volta quando acaba. */
export function paginaDoTique(tique: number, totalDePaginas: number): number {
  if (totalDePaginas <= 1) return 0;
  return ((tique % totalDePaginas) + totalDePaginas) % totalDePaginas;
}

/**
 * O letreiro: cartões de larguras diferentes num trilho de `util` px, com vão
 * de `vao` px entre eles. Se tudo cabe, uma página só. Se não, cada página
 * recebe os cartões que cabem INTEIROS, deixando `reservaDaMarca` px para o
 * "1/2" à direita. As saídas de hoje vêm primeiro na lista, então ficam na
 * primeira página.
 */
export function agruparPorLargura(
  larguras: readonly number[],
  util: number,
  vao = 12,
  reservaDaMarca = 76,
): number[][] {
  if (larguras.length === 0) return [[]];
  const total = larguras.reduce((s, w) => s + w, 0) + vao * Math.max(0, larguras.length - 1);
  if (total <= util) return [larguras.map((_, i) => i)];
  const grupos: number[][] = [[]];
  let usado = 0;
  larguras.forEach((w, i) => {
    const atual = grupos[grupos.length - 1];
    const precisa = w + (atual.length ? vao : 0);
    if (usado + precisa > util - reservaDaMarca && atual.length) {
      grupos.push([i]);
      usado = w + vao;
      return;
    }
    atual.push(i);
    usado += w + vao;
  });
  return grupos;
}
