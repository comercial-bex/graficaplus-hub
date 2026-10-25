/**
 * Faixa por área da tabela de terceirizados: "acima de 6 m² o m² sai por R$ 27,90".
 *
 * DECISÃO (24/10/2026): a faixa é PROGRESSIVA e vale POR LINHA do orçamento.
 *   - Progressiva: os primeiros `acimaDeM2` saem ao preço cheio e só o que passa disso sai
 *     ao preço menor. Com o desconto sobre a linha inteira, 6,02 m² custava R$ 11,44 a MENOS
 *     que 6,00 m² (adesivo TOP): o pedido maior ficava mais barato que o menor.
 *   - Por linha: o preço aparece na própria linha e não muda quando outra linha é editada.
 *     Dividir um pedido em duas linhas nunca sai mais barato que uma linha só.
 *
 * O banco faz a mesma conta em `tg_item_precificar_por_area`; esta função só antecipa na tela,
 * com o mesmo arredondamento (2 casas no valor, 3 na área).
 */

export type FaixaPorArea = {
  /** m² da linha a partir de onde vale o preço menor */
  acimaDeM2: number;
  /** R$/m² do que passa de `acimaDeM2` */
  precoAcima: number;
};

const arred = (n: number, casas: number) => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Valor da linha inteira (todas as peças), em R$. */
export function valorDaLinhaPorArea(
  areaDaLinhaM2: number,
  precoM2: number,
  faixa?: FaixaPorArea | null,
): number {
  if (!faixa || areaDaLinhaM2 <= faixa.acimaDeM2) return arred(areaDaLinhaM2 * precoM2, 2);
  const ate = faixa.acimaDeM2 * precoM2;
  const acima = (areaDaLinhaM2 - faixa.acimaDeM2) * faixa.precoAcima;
  return arred(ate + acima, 2);
}

/** Preço médio por m² da linha, para mostrar ao cliente. */
export function precoMedioDoM2(
  areaDaLinhaM2: number,
  precoM2: number,
  faixa?: FaixaPorArea | null,
): number {
  if (areaDaLinhaM2 <= 0) return precoM2;
  return arred(valorDaLinhaPorArea(areaDaLinhaM2, precoM2, faixa) / areaDaLinhaM2, 2);
}
