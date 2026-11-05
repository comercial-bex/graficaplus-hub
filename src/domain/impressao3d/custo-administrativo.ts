import { D, type Decimal } from "./decimal";

function valorValido(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Embalagem do item 3D (decisão do dono, 05/11/2026): é OPCIONAL e separada.
 * Desligada, vale 0 mesmo com valor sugerido. Ligada, cobra o valor UMA vez por
 * item 3D, qualquer que seja a quantidade de peças. Valor inválido ou negativo = 0.
 */
export function custoDeEmbalagemDoItem({
  incluir,
  valor,
}: {
  incluir: boolean;
  valor: number | string | null | undefined;
}): Decimal {
  return D(incluir ? valorValido(valor) : 0);
}

/** Mantido para quem ainda importa o nome antigo: cobra o valor uma vez por item. */
export function custoAdministrativoDoLote(
  custoAdmin: number | string | null | undefined,
  _quantidade?: number | null,
): Decimal {
  return custoDeEmbalagemDoItem({ incluir: true, valor: custoAdmin });
}

/**
 * Restaura a escolha de embalagem de uma peça gravada. Peças novas guardam
 * embalagem_incluida/embalagem_valor; peças antigas só têm custo_admin, que
 * liga a opção quando é maior que zero.
 */
export function embalagemGravada(inputs: Record<string, unknown> | null | undefined): {
  incluida: boolean;
  valor: number;
} {
  const ci = inputs ?? {};
  if (typeof ci.embalagem_incluida === "boolean") {
    return { incluida: ci.embalagem_incluida, valor: valorValido(ci.embalagem_valor) };
  }
  const legado = valorValido(ci.custo_admin);
  return { incluida: legado > 0, valor: legado };
}
