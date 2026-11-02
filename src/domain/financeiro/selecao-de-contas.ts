import type { TotaisDaLista } from "./lista-de-contas";

/**
 * Seleção de contas nas listas financeiras (02/11/2026): caixa de marcação em cada linha, total dos
 * selecionados, resumo para copiar e CSV só do que foi marcado. É o "menu Ações em lote" do
 * Holdprint reduzido ao que não mexe em dinheiro. Dar baixa em várias contas de uma vez fica fora
 * até o dono decidir: movimentar dinheiro registrado pede lista e total na frente de quem confirma.
 *
 * A seleção guarda ids e é independente do filtro: mudar a busca não desmarca nada, e a tela diz
 * quantas marcadas estão fora do que aparece. Todo total da seleção sai das contas que ainda
 * existem na lista, nunca de um id velho.
 */

export type Selecao = ReadonlySet<string>;

export const SELECAO_VAZIA: Selecao = new Set<string>();

export function alternar(selecao: Selecao, id: string): Set<string> {
  const nova = new Set(selecao);
  if (nova.has(id)) nova.delete(id);
  else nova.add(id);
  return nova;
}

/** Marca todas as contas que aparecem; as que já estavam marcadas e estão escondidas continuam. */
export function marcarTodas(selecao: Selecao, idsVisiveis: readonly string[]): Set<string> {
  const nova = new Set(selecao);
  for (const id of idsVisiveis) nova.add(id);
  return nova;
}

/** Desmarca só as que aparecem; as escondidas por filtro continuam marcadas. */
export function desmarcarVisiveis(selecao: Selecao, idsVisiveis: readonly string[]): Set<string> {
  const nova = new Set(selecao);
  for (const id of idsVisiveis) nova.delete(id);
  return nova;
}

export type EstadoDoCabecalho = "nenhuma" | "algumas" | "todas";

/** O estado da caixa do cabeçalho em relação ao que aparece. */
export function estadoDoCabecalho(selecao: Selecao, idsVisiveis: readonly string[]): EstadoDoCabecalho {
  if (idsVisiveis.length === 0) return "nenhuma";
  const marcadas = idsVisiveis.filter((id) => selecao.has(id)).length;
  if (marcadas === 0) return "nenhuma";
  return marcadas === idsVisiveis.length ? "todas" : "algumas";
}

/** As contas marcadas que ainda existem na lista inteira (não só no que aparece). */
export function dosSelecionados<T>(todas: readonly T[], selecao: Selecao, idDe: (t: T) => string): T[] {
  return todas.filter((t) => selecao.has(idDe(t)));
}

/** Quantas marcadas existem mas estão escondidas pelo filtro de agora. */
export function foraDoFiltro<T>(todas: readonly T[], visiveis: readonly T[], selecao: Selecao, idDe: (t: T) => string): number {
  const aparecem = new Set(visiveis.map(idDe));
  return todas.filter((t) => selecao.has(idDe(t)) && !aparecem.has(idDe(t))).length;
}

/** Só os ids que ainda existem na lista: depois de recarregar, o que sumiu sai da seleção. */
export function podarSelecao<T>(selecao: Selecao, todas: readonly T[], idDe: (t: T) => string): Set<string> {
  const existentes = new Set(todas.map(idDe));
  return new Set([...selecao].filter((id) => existentes.has(id)));
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O resumo que vai para a área de transferência, em frases que um colega entende ao colar no
 * WhatsApp ou num e-mail: quantas, o dinheiro por situação e o total.
 */
export function resumoDaSelecao(
  tela: { singular: string; plural: string; rotuloPagas: string },
  totais: TotaisDaLista,
): string {
  const n = totais.quantidade;
  if (n === 0) return `Nenhuma ${tela.singular} selecionada.`;
  const partes = [
    `A vencer ${moeda(totais.aVencer)}`,
    `vencidas ${moeda(totais.vencidas)}`,
    `${tela.rotuloPagas.toLowerCase()} ${moeda(totais.pagas)}`,
  ];
  return `${n} ${n === 1 ? tela.singular : tela.plural} ${n === 1 ? "selecionada" : "selecionadas"}. ${partes.join(", ")}. Total ${moeda(totais.total)}.`;
}

export type CelulaDoCsv = string | number | null | undefined;

/**
 * Texto que uma planilha trataria como fórmula (começa com = + - @, tabulação ou retorno) ganha
 * um apóstrofo na frente: nome de fornecedor digitado por alguém não pode virar comando no Excel.
 */
export function protegerCelula(texto: string): string {
  return /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
}

function celulaDoCsv(v: CelulaDoCsv): string {
  if (v === null || v === undefined || v === "") return "";
  // Número com vírgula decimal, como o Excel em português lê.
  if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
  const texto = protegerCelula(String(v));
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** CSV para o Excel em português: separador ponto e vírgula, aspas dobradas, BOM para os acentos. */
export function csvDeLinhas(cabecalho: readonly string[], linhas: ReadonlyArray<readonly CelulaDoCsv[]>): string {
  const corpo = [cabecalho, ...linhas].map((l) => l.map(celulaDoCsv).join(";")).join("\r\n");
  return `﻿${corpo}\r\n`;
}

/** `contas-a-pagar-selecionadas-2026-11-02.csv` */
export function nomeDoArquivoCsv(prefixo: string, hoje: string): string {
  const limpo = prefixo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${limpo || "lista"}-${hoje}.csv`;
}

/** "2026-11-02" vira "02/11/2026"; vazio ou fora do formato vira texto vazio. */
export function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
