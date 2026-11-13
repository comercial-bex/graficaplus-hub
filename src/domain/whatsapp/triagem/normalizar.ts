/**
 * Normalização do que o contato escreve, para comparar com o quadro de respostas.
 *
 * Regra do projeto (seção 1.7): minúsculas, sem acento, sem pontuação, letras
 * repetidas três ou mais vezes reduzidas a uma, espaços únicos. Emojis viram
 * marcas: polegar para cima, ok e certo viram `emojiok`; polegar para baixo e
 * xis viram `emojinao`; qualquer outro emoji some.
 *
 * Dígitos não são reduzidos (CEP 00000-000 precisa continuar com os zeros).
 */

export const MARCA_OK = "emojiok";
export const MARCA_NAO = "emojinao";

// seletor de variação e tons de pele, escritos como alternativas para não cair em classe de caracteres
const MODIFICADORES = "(?:\\u{FE0F}|\\u{1F3FB}|\\u{1F3FC}|\\u{1F3FD}|\\u{1F3FE}|\\u{1F3FF})*";
const EMOJI_OK = new RegExp(
  `(?:\\u{1F44D}|\\u{1F44C}|\\u{2705}|\\u{2714}|\\u{1F918}|\\u{1F64C}|\\u{1F44F})${MODIFICADORES}`,
  "gu",
);
const EMOJI_NAO = new RegExp(`(?:\\u{1F44E}|\\u{274C}|\\u{26D4}|\\u{1F6AB})${MODIFICADORES}`, "gu");
const EMOJI_QUALQUER = new RegExp(
  "\\p{Extended_Pictographic}|\\u{FE0F}|\\u{200D}|\\u{1F3FB}|\\u{1F3FC}|\\u{1F3FD}|\\u{1F3FE}|\\u{1F3FF}",
  "gu",
);

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizarTexto(texto: string | null | undefined): string {
  if (!texto) return "";
  let t = texto
    .normalize("NFC")
    .replace(EMOJI_OK, ` ${MARCA_OK} `)
    .replace(EMOJI_NAO, ` ${MARCA_NAO} `);
  t = t.replace(EMOJI_QUALQUER, " ");
  t = semAcento(t).toLowerCase();
  // pontuação, símbolos e underscore viram espaço; letras e dígitos ficam
  t = t.replace(/[^a-z0-9]+/g, " ");
  // letras (não dígitos) repetidas 3+ vezes viram uma só: "simmm" -> "sim"
  t = t.replace(/([a-z])\1{2,}/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  // a mesma marca de emoji em fila vale uma vez
  t = t.replace(new RegExp(`\\b(${MARCA_OK}|${MARCA_NAO})(?: \\1)+\\b`, "g"), "$1");
  return t;
}

export function contarPalavras(normalizado: string): number {
  return normalizado ? normalizado.split(" ").length : 0;
}

/** A mensagem inteira é só emoji de polegar/ok/não (ou vazia depois de tirar os emojis)? */
export function ehSoMarcaDeEmoji(normalizado: string): boolean {
  return normalizado === MARCA_OK || normalizado === MARCA_NAO;
}
