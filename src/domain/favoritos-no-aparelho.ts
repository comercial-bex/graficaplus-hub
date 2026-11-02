/**
 * Favoritos guardados no aparelho de quem usa (01/11/2026): menu, produtos da
 * escolha do orçamento e relatórios usam a mesma regra. A estrela é preferência
 * da pessoa, não regra da gráfica, então fica no `localStorage`, por e-mail, e
 * nunca vai para o banco.
 */

export const LIMITE_DE_FAVORITOS = 24;

export function chaveDosFavoritos(prefixo: string, email: string | null | undefined): string {
  return `${prefixo}:${(email ?? "").trim().toLowerCase() || "sem-email"}`;
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

export function lerFavoritos(chave: string, armazem: Pick<Storage, "getItem"> | null | undefined): string[] {
  try {
    const bruto = armazem?.getItem(chave);
    return bruto ? normalizarFavoritos(JSON.parse(bruto)) : [];
  } catch {
    return [];
  }
}

export function gravarFavoritos(chave: string, lista: string[], armazem: Pick<Storage, "setItem"> | null | undefined): void {
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

/** O `localStorage` quando há navegador; no servidor, nada. */
export function armazemDoNavegador(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}
