/**
 * Favoritos de produto na escolha do orçamento (01/11/2026), no mesmo jeito dos
 * favoritos do menu: a estrela de cada pessoa fica no aparelho dela
 * (`localStorage`), por e-mail, e aparece como o primeiro atalho da escolha.
 *
 * Não vai para o banco de propósito: é preferência de quem vende, não regra
 * da gráfica. O "Mais vendidos" continua vindo dos itens gravados.
 */

export const PREFIXO_DOS_FAVORITOS_DE_PRODUTO = "bexprint:orcamento:produtos-favoritos";
export const LIMITE_DE_FAVORITOS = 24;

export function chaveDosFavoritosDeProduto(email: string | null | undefined): string {
  return `${PREFIXO_DOS_FAVORITOS_DE_PRODUTO}:${(email ?? "").trim().toLowerCase() || "sem-email"}`;
}

/** Lista gravada, limpa: só textos, sem repetição, até o limite. Qualquer lixo vira lista vazia. */
export function normalizarFavoritos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set<string>();
  for (const v of valor) {
    if (typeof v === "string" && v.trim() && !vistos.has(v)) vistos.add(v);
    if (vistos.size >= LIMITE_DE_FAVORITOS) break;
  }
  return [...vistos];
}

export function lerFavoritosDeProduto(chave: string, armazem: Pick<Storage, "getItem"> | null | undefined): string[] {
  try {
    const bruto = armazem?.getItem(chave);
    return bruto ? normalizarFavoritos(JSON.parse(bruto)) : [];
  } catch {
    return [];
  }
}

export function gravarFavoritosDeProduto(
  chave: string,
  lista: string[],
  armazem: Pick<Storage, "setItem"> | null | undefined,
): void {
  try {
    armazem?.setItem(chave, JSON.stringify(normalizarFavoritos(lista)));
  } catch {
    // Armazenamento bloqueado (aba privada, cota): a estrela vale só até fechar a tela.
  }
}

/** Estrela tocada: entra na frente da lista, ou sai se já estava. */
export function alternarFavorito(lista: string[], id: string): string[] {
  return lista.includes(id) ? lista.filter((x) => x !== id) : normalizarFavoritos([id, ...lista]);
}
