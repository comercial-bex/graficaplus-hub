import { D, type Decimal } from "./decimal";

/**
 * Custo adm./embalagem do lote (decisão do dono, 05/11/2026): vale POR PEDIDO,
 * cobrado UMA vez por item 3D, qualquer que seja a quantidade de peças.
 * A quantidade é ignorada de propósito; vazia ou 0 também cobra uma vez.
 */
export function custoAdministrativoDoLote(custoAdmin: number | string | null | undefined, _quantidade?: number | null): Decimal {
  const v = Number(custoAdmin);
  return D(Number.isFinite(v) && v > 0 ? v : 0);
}
