/**
 * Abrir arquivo do portal — o mesmo gesto nas duas portas.
 *
 * A página logada pede o caminho ao banco (`portal_meu_objeto`) e assina pelo
 * Storage com a sessão do cliente; a página por link pede a URL assinada à rota
 * de servidor. Os blocos do portal só conhecem `ObterUrl`.
 */

export type AlvoDoArquivo = {
  tipo: "arquivo" | "documento";
  id: string;
  nome: string;
  para: "ver" | "baixar";
};

/** Devolve a URL assinada do arquivo. Erro sobe com o motivo. */
export type ObterUrl = (alvo: AlvoDoArquivo) => Promise<string>;

/**
 * Abre a aba ANTES de esperar a URL: celular bloqueia `window.open` que vem
 * depois de um `await`, e o clique em "Baixar" parecia não fazer nada.
 */
export async function abrirEmNovaAba(obter: () => Promise<string>): Promise<void> {
  const janela = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const url = await obter();
    if (janela) janela.location.href = url;
    else window.location.assign(url);
  } catch (e) {
    janela?.close();
    throw e;
  }
}
