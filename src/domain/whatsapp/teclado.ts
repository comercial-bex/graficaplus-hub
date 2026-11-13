/**
 * O teclado da caixa do WhatsApp, no jeito do WhatsApp (onda 1, 12/11/2026).
 * Dono: CONVERSA. A MOLDURA usa `escFechaAConversa` para fechar a conversa.
 *
 * As regras (decisão do dono):
 *   - Enter envia; Shift+Enter quebra a linha; Ctrl+Enter (Cmd+Enter) também envia.
 *   - Em aparelho de toque (pointer: coarse) o Enter quebra a linha; envia-se
 *     pelo botão.
 *   - Durante a composição de acento (isComposing) o Enter nunca envia.
 *   - Com a lista do "/" (respostas rápidas) aberta, Enter escolhe e NUNCA
 *     envia. Texto que começa com "/" não sai sem confirmação: no laboratório
 *     de 11/11, "/pix" + Ctrl+Enter mandou "/pix" literal ao cliente.
 *   - Esc fecha a camada de cima (menu, gaveta, diálogo); sem nada por cima,
 *     fecha a conversa.
 *   - Letra solta nunca faz ação (saíram R, T, E e N: a R assumia a conversa
 *     de outra pessoa sem perguntar). Letra digitada fora de qualquer campo
 *     vai para a caixa de texto.
 */

/** Foco num campo de texto: atalho nenhum pode roubar a letra que se digita. */
export function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * Há uma camada aberta por cima (diálogo, gaveta por cima, menu, lista)? O
 * Radix marca cada uma com o papel; a gaveta encaixada do modo largo não é
 * camada (a moldura cuida dela à parte).
 */
export function haCamadaPorCima(doc: Pick<Document, "querySelector"> | null | undefined): boolean {
  if (!doc) return false;
  return !!doc.querySelector(
    "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']",
  );
}

/** O que a tela precisa saber de uma tecla (o KeyboardEvent nativo serve). */
export type Tecla = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  /** 229 = o navegador ainda está compondo (Safari não marca isComposing no Enter final). */
  keyCode?: number;
};

export type OndeEsta = {
  /** A lista do "/" está aberta com pelo menos uma resposta. */
  listaDaBarraAberta: boolean;
  /** Aparelho de toque (matchMedia("(pointer: coarse)")). */
  toque: boolean;
  /** O que está escrito na caixa. */
  texto: string;
  /** Modo nota interna: a nota nunca vai ao cliente, então "/" não pede confirmação. */
  nota?: boolean;
};

/**
 * Texto que começa com "/" não sai sem confirmação (no modo mensagem): no
 * laboratório de 11/11 o "/pix" foi ao cliente literal. Nota interna não vai ao
 * cliente e escreve "/" à vontade.
 */
export function precisaConfirmarBarra(texto: string, nota = false): boolean {
  return !nota && texto.trimStart().startsWith("/");
}

/**
 * O que o Enter faz na caixa de resposta.
 *   deixar            não interfere (composição de acento em curso)
 *   quebrar_linha     deixa o campo quebrar a linha
 *   enviar            impede o padrão e envia
 *   escolher_resposta impede o padrão e põe a resposta rápida marcada
 *   confirmar_barra   impede o padrão e pergunta antes de mandar texto que começa com "/"
 *   ignorar           impede o padrão e não faz nada (caixa vazia)
 */
export type AcaoDoEnter =
  | "deixar"
  | "quebrar_linha"
  | "enviar"
  | "escolher_resposta"
  | "confirmar_barra"
  | "ignorar";

export function oQueOEnterFaz(t: Tecla, o: OndeEsta): AcaoDoEnter {
  if (t.key !== "Enter") return "deixar";
  if (t.isComposing || t.keyCode === 229) return "deixar";
  if (o.listaDaBarraAberta) return "escolher_resposta";
  const comando = t.ctrlKey || t.metaKey;
  if (!comando && (t.shiftKey || t.altKey)) return "quebrar_linha";
  if (!comando && o.toque) return "quebrar_linha";
  if (!o.texto.trim()) return "ignorar";
  if (precisaConfirmarBarra(o.texto, o.nota)) return "confirmar_barra";
  return "enviar";
}

/** Elementos em que o espaço já faz algo (aperta, abre, toca): o atalho "letra vai para a caixa" não o toma. */
const TAGS_QUE_USAM_O_ESPACO = new Set(["BUTTON", "A", "SUMMARY", "VIDEO", "AUDIO", "INPUT", "SELECT"]);
const PAPEIS_QUE_USAM_O_ESPACO = new Set([
  "button",
  "slider",
  "switch",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "link",
  "combobox",
  "spinbutton",
]);

/**
 * Revisão da onda 1 (12/11/2026): o espaço sozinho era engolido com o foco em
 * <summary>, <video>, <audio> e papéis como slider e switch (a gaveta encaixada
 * deixava de abrir os blocos, o vídeo da bolha deixava de tocar). Agora vale
 * a regra larga: foco em qualquer coisa que se opera pelo teclado fica com ela.
 */
function alvoUsaOEspaco(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (TAGS_QUE_USAM_O_ESPACO.has(el.tagName)) return true;
  const papel = el.getAttribute?.("role") ?? "";
  if (PAPEIS_QUE_USAM_O_ESPACO.has(papel)) return true;
  const indice = el.getAttribute?.("tabindex");
  return indice != null && indice !== "" && indice !== "-1";
}

/**
 * A letra digitada fora de qualquer campo vai para a caixa de texto (como no
 * WhatsApp). Só caractere que se escreve: Ctrl ou Cmd fazem atalho (Ctrl+K,
 * Ctrl+B); Ctrl+Alt é o AltGr do teclado ABNT2 do Windows e escreve ("/" e
 * "?" saem por ele). Espaço num botão ou link continua apertando o botão.
 */
export function letraVaiParaACaixa(
  t: Tecla & { repeat?: boolean },
  alvo: EventTarget | null,
  camadaPorCima: boolean,
): boolean {
  if (camadaPorCima || digitando(alvo)) return false;
  if (t.isComposing || t.keyCode === 229) return false;
  if (t.key.length !== 1) return false;
  if (t.metaKey) return false;
  if (t.ctrlKey && !t.altKey) return false;
  if (t.key === " " && alvoUsaOEspaco(alvo)) return false;
  return true;
}

/**
 * Esc sem ninguém para consumir fecha a conversa (a moldura faz isso). Quem
 * consome o Esc antes (a lista do "/", a busca na conversa, o Radix ao fechar
 * menu, gaveta ou diálogo) chama preventDefault, e este Esc não fecha nada.
 */
export function escFechaAConversa(
  t: Pick<Tecla, "key" | "isComposing" | "keyCode"> & { defaultPrevented: boolean },
  doc: Pick<Document, "querySelector"> | null | undefined,
): boolean {
  if (t.key !== "Escape" || t.defaultPrevented) return false;
  if (t.isComposing || t.keyCode === 229) return false;
  return !haCamadaPorCima(doc);
}

/** A lista que a tela "Atalhos do teclado" mostra (menu de três pontos). */
export const ATALHOS_DO_TECLADO: readonly { teclas: string; faz: string }[] = [
  { teclas: "Enter", faz: "Envia a mensagem." },
  { teclas: "Shift + Enter", faz: "Quebra a linha." },
  { teclas: "Ctrl + Enter (Cmd + Enter no Mac)", faz: "Também envia a mensagem." },
  { teclas: "Enter no celular", faz: "Quebra a linha. Para enviar, toque no botão Enviar." },
  {
    teclas: "/ no começo da caixa",
    faz: "Abre as respostas rápidas. Setas escolhem, Enter ou Tab colocam, Esc fecha.",
  },
  {
    teclas: "Esc",
    faz: "Fecha o que está aberto por cima. Sem nada por cima, fecha a conversa (o rascunho fica guardado).",
  },
  { teclas: "Letra fora da caixa", faz: "Vai direto para a caixa de texto da conversa aberta." },
  { teclas: "Ctrl + K", faz: "Procura uma tela do sistema." },
  { teclas: "Ctrl + B", faz: "Recolhe ou abre o menu lateral." },
];

/** O que uma tecla faz com a lista do "/" aberta. */
export type AcaoDaLista = "descer" | "subir" | "escolher" | "fechar";

/**
 * Teclado da lista de respostas rápidas do "/": setas andam, Enter e Tab
 * escolhem, Esc fecha. Enter NUNCA envia com a lista aberta (a mesma regra de
 * `oQueOEnterFaz`). Durante a composição de acento não interfere.
 */
export function oQueATeclaFazNaLista(
  t: Pick<Tecla, "key" | "isComposing" | "keyCode" | "shiftKey">,
): AcaoDaLista | null {
  if (t.isComposing || t.keyCode === 229) return null;
  switch (t.key) {
    case "ArrowDown":
      return "descer";
    case "ArrowUp":
      return "subir";
    case "Enter":
      return "escolher";
    case "Tab":
      return t.shiftKey ? null : "escolher";
    case "Escape":
      return "fechar";
    default:
      return null;
  }
}

/** O próximo item marcado da lista (em círculo). */
export function andarNaLista(atual: number, total: number, sentido: 1 | -1): number {
  if (total <= 0) return 0;
  const base = Math.min(Math.max(atual, 0), total - 1);
  return (base + sentido + total) % total;
}

/** A caixa de texto cresce até esta quantidade de linhas e depois rola por dentro. */
export const LINHAS_DA_CAIXA = 6;
/** Altura de uma linha (text-base com leading-6) e recuo vertical da caixa (18 de padding e 2 de borda), em px. */
export const LINHA_DA_CAIXA_PX = 24;
export const RECUO_DA_CAIXA_PX = 20;
/** O alvo de toque mínimo: a caixa de uma linha não fica menor que isto. */
export const ALTURA_MINIMA_DA_CAIXA_PX = 44;

/** A altura (px) da caixa de texto, dado o `scrollHeight` do conteúdo: de uma linha a seis. */
export function alturaDaCaixa(alturaDoConteudo: number): number {
  const maxima = LINHAS_DA_CAIXA * LINHA_DA_CAIXA_PX + RECUO_DA_CAIXA_PX;
  if (!Number.isFinite(alturaDoConteudo)) return ALTURA_MINIMA_DA_CAIXA_PX;
  return Math.min(Math.max(alturaDoConteudo, ALTURA_MINIMA_DA_CAIXA_PX), maxima);
}
