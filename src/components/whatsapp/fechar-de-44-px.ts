/**
 * O "x" de fechar do Sheet e do Dialog do sistema tem 40 px (h-10 w-10), 4 px
 * abaixo do alvo de toque do dono (revisão da onda 1, 12/11/2026). Em vez de
 * mexer nos componentes compartilhados, quem abre gaveta ou diálogo da caixa
 * do WhatsApp acrescenta esta classe ao conteúdo: o seletor vence a classe do
 * botão (mais específico) e o "x" passa a 44 px. É só o botão que tem a classe
 * `absolute`, o do canto.
 */
export const FECHAR_DE_44_PX = "[&>button.absolute]:size-11";
