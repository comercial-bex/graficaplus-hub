/**
 * O PostgREST corta cada resposta em 1.000 linhas, e `.limit(2000)` não passa disso: o que passar de mil linhas
 * some sem aviso. Este leitor pede página por página com `range`, até a página vir incompleta.
 */
export const LINHAS_POR_PAGINA = 1000;
/** Proteção contra laço sem fim se o banco devolver página cheia para sempre. */
export const MAXIMO_DE_LINHAS = 200_000;

/**
 * Lê TODAS as linhas de uma consulta. A consulta precisa ter ordem total (uma coluna única no fim) para as páginas
 * não repetirem nem pularem linha. Erro de qualquer página lança: página perdida é dado perdido, e a tela precisa
 * mostrar a falha em vez de uma lista curta.
 */
export async function lerTodasAsLinhas<T>(
  pagina: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  porPagina = LINHAS_POR_PAGINA,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; todas.length < MAXIMO_DE_LINHAS; de += porPagina) {
    const { data, error } = await pagina(de, de + porPagina - 1);
    if (error) throw new Error(error.message);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < porPagina) break;
  }
  return todas;
}
