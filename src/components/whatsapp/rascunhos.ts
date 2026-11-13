import { useCallback, useSyncExternalStore } from "react";

/**
 * O rascunho de cada conversa, como no WhatsApp (onda 1, 12/11/2026). Dono:
 * CONVERSA. A MOLDURA lê (`useRascunhos`) para escrever "Rascunho:" na linha
 * da lista.
 *
 * Até aqui o texto era estado da ConversaAberta, que é montada de novo a cada
 * troca de conversa (`key={selecionada.id}`): trocar de conversa apagava o que
 * se começou a escrever. Agora o texto mora num mapa fora da tela, por
 * conversa, e uma cópia vai para o sessionStorage (a aba recarregada não
 * perde). O sessionStorage pode não existir ou recusar (aba anônima, cota,
 * teste em node): cada leitura e escrita está num try/catch e o mapa em
 * memória continua valendo.
 */

const CHAVE = "wa-rascunhos";
const VAZIO: ReadonlyMap<string, string> = new Map();

let mapa: Map<string, string> | null = null;
let foto: ReadonlyMap<string, string> = VAZIO;
const ouvintes = new Set<() => void>();

function carregar(): Map<string, string> {
  if (mapa) return mapa;
  mapa = new Map();
  try {
    const bruto = globalThis.sessionStorage?.getItem(CHAVE);
    if (bruto) {
      const lido = JSON.parse(bruto) as unknown;
      if (lido && typeof lido === "object") {
        for (const [id, texto] of Object.entries(lido as Record<string, unknown>)) {
          if (typeof texto === "string" && texto.trim()) mapa.set(id, texto);
        }
      }
    }
  } catch {
    // Sem sessionStorage (ou com lixo dentro): fica só a memória.
  }
  foto = new Map(mapa);
  return mapa;
}

function guardar(m: Map<string, string>) {
  try {
    const comLetra = [...m].filter(([, texto]) => texto.trim());
    globalThis.sessionStorage?.setItem(CHAVE, JSON.stringify(Object.fromEntries(comLetra)));
  } catch {
    // Cota cheia ou armazenamento bloqueado: a memória basta até recarregar.
  }
}

/**
 * A chave do rascunho: a mensagem ao cliente usa o id da conversa; a nota
 * interna tem chave própria. Antes (12/11/2026, revisão da onda 1) os dois
 * dividiam o texto e o modo recomeçava como "mensagem" ao trocar de conversa:
 * a nota voltava dentro da caixa do cliente e o Enter a mandava de verdade. A
 * linha da lista só lê a chave da mensagem, então nota não aparece como
 * "Rascunho:".
 */
export function chaveDoRascunho(conversaId: string, nota: boolean): string {
  return nota ? `${conversaId}:nota` : conversaId;
}

/** O rascunho da conversa ("" quando não há). */
export function lerRascunho(conversaId: string): string {
  return carregar().get(conversaId) ?? "";
}

/**
 * Grava o rascunho como está (quem digitou um espaço ou uma linha em branco
 * não os perde); texto vazio apaga (enviou, ou apagou tudo). Só rascunho com
 * letra vai para o sessionStorage e aparece na lista (`resumoDoRascunho`).
 */
export function gravarRascunho(conversaId: string, texto: string): void {
  const m = carregar();
  const antes = m.get(conversaId) ?? "";
  if (texto === antes) return;
  if (texto) m.set(conversaId, texto);
  else m.delete(conversaId);
  foto = new Map(m);
  guardar(m);
  for (const avisar of ouvintes) avisar();
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

function lerFoto(): ReadonlyMap<string, string> {
  carregar();
  return foto;
}

function lerFotoNoServidor(): ReadonlyMap<string, string> {
  return VAZIO;
}

/** Todos os rascunhos (a lista mostra "Rascunho:" na conversa que tem). */
export function useRascunhos(): ReadonlyMap<string, string> {
  return useSyncExternalStore(assinar, lerFoto, lerFotoNoServidor);
}

/** O rascunho de uma conversa e o jeito de mudá-lo. */
export function useRascunho(conversaId: string): [string, (texto: string) => void] {
  const todos = useRascunhos();
  const mudar = useCallback((texto: string) => gravarRascunho(conversaId, texto), [conversaId]);
  return [todos.get(conversaId) ?? "", mudar];
}

/**
 * A primeira linha com letra do rascunho, curta, para a linha da lista ("" =
 * não mostrar "Rascunho:").
 */
export function resumoDoRascunho(texto: string, maximo = 60): string {
  const linha = texto.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return linha.length > maximo ? `${linha.slice(0, maximo - 1).trimEnd()}…` : linha;
}
