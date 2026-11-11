/**
 * Aritmética inteira do motor de encaixe.
 *
 * Unidade interna: DÉCIMO DE MILÍMETRO (1 = 0,1 mm; 1 m = 10 000). Toda medida
 * que entra no motor é um inteiro nessa unidade. Motivo: em ponto flutuante,
 * Math.floor(0.3 / 0.1) é 2 (o quociente vira 2.9999999999999996) e uma
 * coluna de adesivo some da conta sem nenhum aviso.
 *
 * Nada neste arquivo usa operador bit a bit: `| 0` e `>> 0` truncam em 32 bits
 * e uma bobina de 50 m já passa de 2^19 unidades (áreas passam de 2^31).
 */

export const UNIDADES_POR_MM = 10;
export const UNIDADES_POR_METRO = 10_000;

/** Maior inteiro que o JavaScript guarda sem perder o último algarismo. */
export const INTEIRO_SEGURO = Number.MAX_SAFE_INTEGER;

export function ehInteiroSeguro(n: number): boolean {
  return Number.isSafeInteger(n);
}

/** ⌊a / b⌋ para a ≥ 0 e b > 0, só com resto inteiro (nunca depende do arredondamento da divisão). */
export function divPiso(a: number, b: number): number {
  const resto = a % b;
  return (a - resto) / b;
}

/** ⌈a / b⌉ para a ≥ 0 e b > 0. */
export function divTeto(a: number, b: number): number {
  const resto = a % b;
  return (a - resto) / b + (resto > 0 ? 1 : 0);
}

export function mdc(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** ⌊√n⌋ exato para n ≥ 0 inteiro seguro (corrige o erro de 1 do Math.sqrt). */
export function raizPiso(n: number): number {
  if (n < 2) return n;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** ⌈√n⌉ exato. */
export function raizTeto(n: number): number {
  const r = raizPiso(n);
  return r * r === n ? r : r + 1;
}

/**
 * Converte milímetros (pode ter uma casa decimal) em décimos de milímetro.
 * Math.round e não Math.floor: 1.13 * 100 dá 112.99999999999999.
 * Devolve null se o valor não for múltiplo de 0,1 mm (não arredonda em silêncio).
 */
export function dmmDeMm(mm: number): number | null {
  if (!Number.isFinite(mm)) return null;
  const bruto = mm * UNIDADES_POR_MM;
  const r = Math.round(bruto);
  return Math.abs(bruto - r) < 1e-6 ? r : null;
}

export function dmmDeMetros(m: number): number | null {
  if (!Number.isFinite(m)) return null;
  const bruto = m * UNIDADES_POR_METRO;
  const r = Math.round(bruto);
  return Math.abs(bruto - r) < 1e-6 ? r : null;
}

/**
 * "1,06" ou "1.06" (metros) para décimos de milímetro SEM passar por float:
 * lê os algarismos como texto. parseFloat("1,06") é 1 (para na vírgula).
 */
export function dmmDeTextoEmMetros(texto: string): number | null {
  const t = texto.trim().replace(/\s+/g, "");
  const m = /^(\d{1,6})(?:[.,](\d{1,4}))?$/.exec(t);
  if (!m) return null;
  const inteira = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(4, "0");
  return inteira * UNIDADES_POR_METRO + Number(frac);
}

/** Texto "1,0600 m" para mostrar ao usuário (só exibição; o motor nunca lê isto de volta). */
export function metrosEmTexto(dmm: number, casas = 3): string {
  const sinal = dmm < 0 ? "-" : "";
  const abs = Math.abs(dmm);
  const inteiros = divPiso(abs, UNIDADES_POR_METRO);
  const resto = abs - inteiros * UNIDADES_POR_METRO; // 0..9999
  const frac = String(resto).padStart(4, "0").slice(0, casas);
  return `${sinal}${inteiros},${frac}`;
}

/** m² (exato, como texto) a partir de duas medidas em dmm: 1 m² = 10^8 dmm². */
export function m2EmTexto(areaDmm2: number, casas = 4): string {
  const base = 100_000_000;
  const inteiros = divPiso(areaDmm2, base);
  const resto = areaDmm2 - inteiros * base;
  const frac = String(resto).padStart(8, "0").slice(0, casas);
  return `${inteiros},${frac}`;
}
