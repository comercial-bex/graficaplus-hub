/** Sem acento e em minúsculas: quem digita "ilhos" ou "acrilico" acha do mesmo jeito. */
export function textoDeBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O produto casa com a busca pelo próprio texto ou por um nome que o cliente também usa. */
export function casaComABusca(texto: string, apelidos: readonly string[], termo: string): boolean {
  const t = textoDeBusca(termo.trim());
  if (!t) return false;
  return textoDeBusca(`${texto} ${apelidos.join(" ")}`).includes(t);
}
