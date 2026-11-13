/**
 * O menu lateral lembra a escolha da pessoa (onda 1 da caixa do WhatsApp,
 * 12/11/2026, decisão 4 do dono). Dono: MOLDURA.
 *
 * O `SidebarProvider` grava o cookie `sidebar_state` (`true` ou `false`, por 7
 * dias) a cada vez que o menu abre ou recolhe, mas até 12/11/2026 nunca o
 * lia: toda tela nova nascia com o menu aberto (328 px) e, a 1280 px de
 * janela, tomava 26% da largura de quem tinha recolhido na tela anterior.
 */

const NOME_DO_COOKIE = "sidebar_state";

/**
 * Procura `sidebar_state=true|false` entre os pares do `document.cookie`.
 * Qualquer outra coisa (cookie ausente, vazio, valor estranho) devolve `null`
 * e quem chama usa o padrão da tela.
 */
export function lerEstadoDoMenu(cookie: string): boolean | null {
  if (typeof cookie !== "string" || !cookie) return null;
  for (const par of cookie.split(";")) {
    const i = par.indexOf("=");
    if (i < 0) continue;
    if (par.slice(0, i).trim() !== NOME_DO_COOKIE) continue;
    const valor = par.slice(i + 1).trim();
    if (valor === "true") return true;
    if (valor === "false") return false;
    return null;
  }
  return null;
}

/** O estado gravado no navegador; `null` fora do navegador (testes em node) ou sem cookie. */
export function lerEstadoDoMenuNoNavegador(): boolean | null {
  if (typeof document === "undefined") return null;
  try {
    return lerEstadoDoMenu(document.cookie);
  } catch {
    // Cookies bloqueados: o menu nasce como sempre nasceu.
    return null;
  }
}
