/**
 * Os DDDs do Brasil e o celular brasileiro de verdade (26/11/2026).
 *
 * Antes, "celular brasileiro" era só o FORMATO `[1-9][1-9]9[0-9]{8}`: qualquer DDD servia. O Suriname (`+597 712 3456`,
 * 10 dígitos) ganhava um nono dígito, virava `59977123456` e passava por celular com "DDD 59", que não existe: o envio
 * saía para `5559977123456`. Com a lista oficial, o 59 não é DDD e esse número deixa de ser tratado como brasileiro.
 *
 * Em 26/11/2026 nenhum número cadastrado (clientes, leads, conversas, usuários, parceiros: 455 conferidos) tinha DDD fora
 * da lista, então exigir a lista não muda nenhum dado existente. O banco repete a MESMA lista em
 * `public.celular_br_valido` (migração 20261126100000): mudou aqui, muda lá (um teste compara os dois textos).
 */

/** DDDs oficiais do Brasil (Anatel). */
export const DDDS_BRASIL = [
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
] as const;

const DDDS = new Set<string>(DDDS_BRASIL);

export function ehDddDoBrasil(ddd: string): boolean {
  return DDDS.has(ddd);
}

/**
 * Celular brasileiro já na chave (sem o 55): 11 dígitos, DDD que existe e o 9 na frente do número.
 * Espelha `public.celular_br_valido` no banco.
 */
export function ehCelularBrasileiro(chave: string | null | undefined): boolean {
  return !!chave && /^[0-9]{11}$/.test(chave) && DDDS.has(chave.slice(0, 2)) && chave[2] === "9";
}
