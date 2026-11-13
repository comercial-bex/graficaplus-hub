import { useSyncExternalStore } from "react";

/**
 * Telas que ocupam a janela inteira abaixo da barra do topo, sem a página
 * rolar: quem rola é o que está dentro delas (a lista e as mensagens da caixa
 * do WhatsApp). Dono: MOLDURA (onda 1, 12/11/2026).
 *
 * O layout autenticado (route.tsx) troca a casca `min-h-screen` por uma de
 * altura fixa (`h-dvh`), põe o <main> em coluna com `min-h-0` e tira o recuo;
 * a barra de abas do hub (abas-da-tela.tsx) fica na versão compacta. As outras
 * telas continuam como estão.
 */
const TELAS_CHEIAS = new Set(["/whatsapp"]);

export function ehTelaCheia(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TELAS_CHEIAS.has(p);
}

/**
 * "Esconder as abas do hub": no celular, com a conversa aberta, a barra de abas
 * some e a conversa ocupa TUDO abaixo do topo (cabeçalho de 64 px, mensagens e
 * caixa de texto sempre à vista). A barra vive no layout (route.tsx) e a
 * conversa aberta é estado da tela; este estado mínimo liga os dois sem a tela
 * conhecer o layout. Ao fechar a conversa (ou sair da tela), volta.
 */
let escondidas = false;
const ouvintes = new Set<() => void>();

export function definirAbasEscondidas(valor: boolean): void {
  if (escondidas === valor) return;
  escondidas = valor;
  for (const avisar of ouvintes) avisar();
}

function assinar(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

export function useAbasEscondidas(): boolean {
  return useSyncExternalStore(
    assinar,
    () => escondidas,
    () => false,
  );
}
