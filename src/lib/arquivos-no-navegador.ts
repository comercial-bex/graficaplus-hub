/**
 * Pequenos gestos do navegador que as telas repetem: baixar um texto como arquivo e copiar um texto.
 * Só rodam no navegador (clique de uma pessoa); no servidor devolvem `false` sem fazer nada.
 */

/** Baixa `conteudo` como arquivo. O CSV leva o BOM no próprio texto, então o tipo já traz o charset. */
export function baixarTexto(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8"): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Dá um instante para o navegador começar o download antes de soltar o endereço.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Copia para a área de transferência. Falso quando o navegador recusa (sem permissão, página insegura). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** Id curto para itens guardados no aparelho. `randomUUID` quando existe; senão, relógio e sorteio. */
export function novoIdLocal(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
