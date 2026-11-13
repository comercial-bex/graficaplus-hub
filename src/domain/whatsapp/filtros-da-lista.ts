import type { AbaStatus, Fila } from "@/domain/whatsapp/caixa-de-entrada";
import type { FiltroDeSetor, Setor } from "@/domain/whatsapp/filas";

/**
 * Os seis atalhos da lista de conversas, uma fileira só (onda 1 da caixa do
 * WhatsApp, 12/11/2026, decisão 7 do dono). Dono: MOLDURA.
 *
 * Até 11/11/2026 a lista tinha 173 px de filtros em três grupos (setor,
 * responsável, situação). Agora são seis chips, como as abas do WhatsApp:
 *
 *   Abertas          todas as conversas abertas
 *   Não lidas        abertas ou pendentes com mensagem que ESTA pessoa ainda não leu
 *                    (a consulta alarga o status: ver `filtrarConsulta`)
 *   Minhas           abertas assumidas por quem olha
 *   Sem responsável  abertas que ninguém assumiu
 *   Pendentes        as marcadas como pendentes
 *   Resolvidas       resolvidas e arquivadas
 *
 * A consulta continua pedindo `{ fila, status }` (o que o banco já entende) e
 * ganha `naoLidas`, que a lista aplica como "só estes ids".
 */

export type ChipDaLista =
  | "abertas"
  | "nao_lidas"
  | "minhas"
  | "sem_responsavel"
  | "pendentes"
  | "resolvidas";

export type FiltroDoChip = { fila: Fila; status: AbaStatus; naoLidas: boolean };

export const CHIPS_DA_LISTA: readonly { valor: ChipDaLista; rotulo: string }[] = [
  { valor: "abertas", rotulo: "Abertas" },
  { valor: "nao_lidas", rotulo: "Não lidas" },
  { valor: "minhas", rotulo: "Minhas" },
  { valor: "sem_responsavel", rotulo: "Sem responsável" },
  { valor: "pendentes", rotulo: "Pendentes" },
  { valor: "resolvidas", rotulo: "Resolvidas" },
];

const DO_CHIP: Record<ChipDaLista, FiltroDoChip> = {
  abertas: { fila: "todas", status: "aberta", naoLidas: false },
  nao_lidas: { fila: "todas", status: "aberta", naoLidas: true },
  minhas: { fila: "minhas", status: "aberta", naoLidas: false },
  sem_responsavel: { fila: "nao_atribuidas", status: "aberta", naoLidas: false },
  pendentes: { fila: "todas", status: "pendente", naoLidas: false },
  resolvidas: { fila: "todas", status: "resolvida", naoLidas: false },
};

/** O chip vira o filtro que a consulta entende. */
export function filtroDoChip(chip: ChipDaLista): FiltroDoChip {
  return { ...DO_CHIP[chip] };
}

/** O filtro volta ao chip que o produz; `null` quando nenhum chip o representa. */
export function chipDoFiltro(f: FiltroDoChip): ChipDaLista | null {
  for (const { valor } of CHIPS_DA_LISTA) {
    const d = DO_CHIP[valor];
    if (d.fila === f.fila && d.status === f.status && d.naoLidas === f.naoLidas) return valor;
  }
  return null;
}

/** Quantas conversas têm mensagem não lida por quem olha (conversas, não mensagens). */
export function contarNaoLidas(
  naoLidasPorMim: ReadonlyMap<string, number> | null | undefined,
): number {
  if (!naoLidasPorMim) return 0;
  let n = 0;
  for (const v of naoLidasPorMim.values()) if (v > 0) n += 1;
  return n;
}

/** Os ids das conversas com mensagem não lida por quem olha. */
export function idsNaoLidos(naoLidasPorMim: ReadonlyMap<string, number> | null | undefined): string[] {
  if (!naoLidasPorMim) return [];
  return [...naoLidasPorMim].filter(([, v]) => v > 0).map(([id]) => id);
}

/**
 * O filtro de fila (setor) só aparece quando serve para alguma coisa: há
 * conversa em mais de uma fila (em 12/11/2026 as 145 estavam todas na
 * Comercial), ou a pessoa está olhando uma fila específica e precisa de como
 * sair dela, ou o padrão ("Minhas filas") deixou a lista vazia enquanto há
 * conversa em outra fila.
 */
export function mostrarFiltroDeFila(p: {
  contagem: readonly { fila: Setor; abertas: number; aguardando: number }[] | null | undefined;
  setor: FiltroDeSetor;
  listaVazia: boolean;
}): boolean {
  const comConversa = new Set(
    (p.contagem ?? []).filter((c) => c.abertas > 0 || c.aguardando > 0).map((c) => c.fila),
  );
  if (comConversa.size > 1) return true;
  if (p.setor !== "minhas_filas" && p.setor !== "todas") return true;
  if (p.setor === "minhas_filas" && p.listaVazia && comConversa.size > 0) return true;
  return false;
}
