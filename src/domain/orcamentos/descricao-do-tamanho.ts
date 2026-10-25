const num = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** "0,8 × 1,6 m · 1,28 m²" — a medida em metros e a área, para o cartão de tamanho. */
export function descricaoDoTamanho(
  largura: number | null | undefined,
  altura: number | null | undefined,
): string | undefined {
  const l = Number(largura);
  const a = Number(altura);
  if (!(l > 0) || !(a > 0)) return undefined;
  const area = Math.round(l * a * 1000) / 1000;
  return `${num(l)} × ${num(a)} m · ${num(area)} m²`;
}
