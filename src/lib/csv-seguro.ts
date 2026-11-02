/**
 * Impede que um texto vire fórmula ao abrir o CSV no Excel/Planilhas.
 * Textos começando com = + - @ (ou tab/CR) ganham um apóstrofo na frente.
 * Números puros (ex.: "-12,50") ficam como estão.
 */
export function neutralizarFormula(valor: unknown): string {
  const s = valor === null || valor === undefined ? "" : String(valor);
  if (typeof valor === "number") return s;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d[\d.,]*$/.test(s)) return `'${s}`;
  return s;
}
