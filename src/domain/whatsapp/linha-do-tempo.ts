import type { EventoDaConversa, MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";

/**
 * A linha do tempo da conversa aberta, em regras puras. Dono: CONVERSA (onda 1,
 * 12/11/2026). A CONVERSA acrescenta aqui o separador de dia ("Hoje", "Ontem",
 * "12/11/2026"), o agrupamento das bolhas seguidas e o divisor "Mensagens não
 * lidas". O que outros já usam (não mudar a assinatura sem avisar no relatório):
 *   - `tiqueDaMensagem` e `rotuloDoTique`: a MOLDURA mostra o tique da última
 *     mensagem na linha da lista;
 *   - `partesComRealce`: a MIDIA marca a busca na conversa dentro do texto da
 *     bolha (ConteudoDaBolha, prop `realce`).
 */

/**
 * O tique da mensagem que a EMPRESA mandou, como no WhatsApp:
 *   relogio  na fila, ainda não saiu (status "pendente")
 *   enviada  um tique
 *   entregue dois tiques
 *   lida     dois tiques azuis
 *   falha    alerta (não saiu; o motivo vai embaixo, na bolha)
 * Mensagem do cliente não tem tique.
 */
export type Tique = "relogio" | "enviada" | "entregue" | "lida" | "falha";

export function tiqueDaMensagem(m: Pick<MensagemDaCaixa, "direcao" | "status">): Tique | null {
  if (m.direcao !== "saida") return null;
  switch (m.status) {
    case "pendente":
      return "relogio";
    case "enviada":
      return "enviada";
    case "entregue":
      return "entregue";
    case "lida":
      return "lida";
    case "falha":
      return "falha";
    default:
      // Situação que a tela não conhece: sem tique é melhor que tique errado
      // ("enviada" para o que não saiu seria o botão que finge que fez).
      return null;
  }
}

/** O nome do tique para o leitor de tela (o tique é só desenho). */
export function rotuloDoTique(t: Tique): string {
  switch (t) {
    case "relogio":
      return "na fila, ainda não saiu";
    case "enviada":
      return "enviada";
    case "entregue":
      return "entregue";
    case "lida":
      return "lida pelo cliente";
    case "falha":
      return "não saiu";
  }
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * O texto cortado nos trechos que casam com a busca na conversa (sem
 * diferenciar acento nem maiúscula). Sem termo, volta o texto inteiro.
 */
export function partesComRealce(
  texto: string,
  termo: string | null | undefined,
): { texto: string; realce: boolean }[] {
  const busca = semAcento((termo ?? "").trim());
  if (!busca || !texto) return [{ texto, realce: false }];
  const base = semAcento(texto);
  // NFD + remoção de acento mantém o mesmo número de letras só para texto já
  // composto; se o tamanho mudar, procura sem cortar (devolve o texto inteiro).
  if (base.length !== texto.length) {
    return base.includes(busca) ? [{ texto, realce: true }] : [{ texto, realce: false }];
  }
  const partes: { texto: string; realce: boolean }[] = [];
  let i = 0;
  while (i <= base.length) {
    const achou = base.indexOf(busca, i);
    if (achou < 0) break;
    if (achou > i) partes.push({ texto: texto.slice(i, achou), realce: false });
    partes.push({ texto: texto.slice(achou, achou + busca.length), realce: true });
    i = achou + busca.length;
  }
  if (i < texto.length) partes.push({ texto: texto.slice(i), realce: false });
  return partes.length ? partes : [{ texto, realce: false }];
}

/* ------------------------------------------------------------------ */
/* Dia, hora, agrupamento e divisor de não lidas (CONVERSA, 12/11/2026) */
/* ------------------------------------------------------------------ */

/**
 * Hora e dia sempre no fuso de Belém, como midia.ts e caixa-de-entrada.ts: o
 * vitest roda em UTC e o navegador de quem atende pode estar em outro fuso;
 * `toLocaleDateString()` sem fuso mudaria o "Hoje" de lugar.
 */
const FUSO = "America/Belem";
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** Bolhas seguidas do mesmo lado, até este intervalo, formam um grupo. */
export const INTERVALO_DO_GRUPO_MS = 5 * 60 * 1000;

export function textoSemAcento(texto: string): string {
  return semAcento(texto);
}

/** "2026-11-12": o dia no fuso de Belém (serve de chave do separador). */
export function chaveDoDia(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "Hoje", "Ontem" ou "12/11/2026", no fuso de Belém. */
export function rotuloDoDia(iso: string, agora: Date = new Date()): string {
  const chave = chaveDoDia(iso);
  if (!chave) return "";
  if (chave === chaveDoDia(agora)) return "Hoje";
  if (chave === chaveDoDia(new Date(agora.getTime() - UM_DIA_MS))) return "Ontem";
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "14:32", a hora dentro da bolha (o dia vai para o separador). */
export function horaDaMensagem(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type ItemCru =
  | { tipo: "msg"; quando: string; m: MensagemDaCaixa }
  | { tipo: "evento"; quando: string; e: EventoDaConversa };

export type ItemDaLinha =
  | { tipo: "dia"; chave: string; rotulo: string }
  | { tipo: "nao_lidas"; quantidade: number }
  | { tipo: "evento"; id: string; quando: string; e: EventoDaConversa }
  | { tipo: "nota"; id: string; quando: string; e: EventoDaConversa }
  | {
      tipo: "msg";
      id: string;
      quando: string;
      m: MensagemDaCaixa;
      /** Primeira bolha da sequência: leva o nome de quem mandou. */
      primeiraDoGrupo: boolean;
      /** Última da sequência: leva o respiro maior para a próxima. */
      ultimaDoGrupo: boolean;
    };

/** Quem mandou, para decidir se duas bolhas seguidas são do mesmo remetente. */
function remetente(m: Pick<MensagemDaCaixa, "direcao" | "enviada_por" | "origem">): string {
  if (m.direcao !== "saida") return "cliente";
  return `saida:${m.enviada_por ?? ""}:${m.origem ?? ""}`;
}

/**
 * Onde o divisor "Mensagens não lidas" entra: antes da mais antiga das
 * `naoLidas` últimas mensagens do CLIENTE. Se há mais não lidas do que
 * mensagens carregadas, entra antes da primeira do cliente carregada. Devolve
 * o índice em `mensagens` (em ordem do tempo) ou -1 (nada a marcar).
 */
export function posicaoDoDivisor(
  mensagens: readonly Pick<MensagemDaCaixa, "direcao">[],
  naoLidas: number,
): number {
  if (!(naoLidas > 0)) return -1;
  const doCliente: number[] = [];
  mensagens.forEach((m, i) => {
    if (m.direcao === "entrada") doCliente.push(i);
  });
  if (doCliente.length === 0) return -1;
  return doCliente[Math.max(0, doCliente.length - naoLidas)];
}

/**
 * A conversa pronta para desenhar: separador de dia, divisor de não lidas,
 * eventos da equipe em pílula, notas internas e bolhas agrupadas. Recebe as
 * mensagens e os eventos misturados (em qualquer ordem).
 */
export function montarLinhaDoTempo(
  itens: readonly ItemCru[],
  opcoes: { agora?: Date; naoLidas?: number } = {},
): ItemDaLinha[] {
  const agora = opcoes.agora ?? new Date();
  const ordenados = itens.slice().sort((a, b) => a.quando.localeCompare(b.quando));
  const mensagensEmOrdem = ordenados.flatMap((i) => (i.tipo === "msg" ? [i.m] : []));
  const posicao = posicaoDoDivisor(mensagensEmOrdem, opcoes.naoLidas ?? 0);
  const idDoDivisor = posicao >= 0 ? mensagensEmOrdem[posicao].id : null;

  const saida: ItemDaLinha[] = [];
  let diaAtual = "";
  for (const item of ordenados) {
    const chave = chaveDoDia(item.quando);
    if (chave && chave !== diaAtual) {
      diaAtual = chave;
      saida.push({ tipo: "dia", chave, rotulo: rotuloDoDia(item.quando, agora) });
    }
    if (item.tipo === "evento") {
      saida.push({
        tipo: item.e.tipo === "nota" ? "nota" : "evento",
        id: item.e.id,
        quando: item.quando,
        e: item.e,
      });
      continue;
    }
    if (idDoDivisor && item.m.id === idDoDivisor) {
      saida.push({ tipo: "nao_lidas", quantidade: opcoes.naoLidas ?? 0 });
    }
    const anterior = saida[saida.length - 1];
    const seguida =
      anterior?.tipo === "msg" &&
      remetente(anterior.m) === remetente(item.m) &&
      new Date(item.quando).getTime() - new Date(anterior.quando).getTime() <= INTERVALO_DO_GRUPO_MS;
    if (seguida && anterior?.tipo === "msg") anterior.ultimaDoGrupo = false;
    saida.push({
      tipo: "msg",
      id: item.m.id,
      quando: item.quando,
      m: item.m,
      primeiraDoGrupo: !seguida,
      ultimaDoGrupo: true,
    });
  }
  return saida;
}
