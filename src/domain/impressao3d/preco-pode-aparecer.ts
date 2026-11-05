/**
 * O preço da calculadora 3D só aparece quando a peça tem os quatro dados que definem o custo
 * (05/11/2026). Sem eles a tela mostrava ~R$ 24 só de custo administrativo e mão de obra padrão,
 * e o vendedor podia passar esse número ao cliente. Título e cliente não entram nesta conta.
 */
export function precoPodeAparecer(p: {
  maquinaId: string | null | undefined;
  materialId: string | null | undefined;
  gramas: number;
  tempoMinutos: number;
}): boolean {
  return !!p.maquinaId && !!p.materialId && p.gramas > 0 && p.tempoMinutos > 0;
}
