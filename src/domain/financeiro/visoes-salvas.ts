import { periodosDaLista, type FiltroDaLista, type FiltroDeSituacao, type IdDoPeriodo } from "./lista-de-contas";
import {
  FILTRO_A_RECEBER_VAZIO,
  type FiltroAReceber,
  type FiltroDeSituacaoAReceber,
} from "./contas-a-receber-filtros";

/**
 * "Visões" das listas financeiras (02/11/2026): o filtro de agora guardado com um nome, para voltar
 * a ele com um toque ("Vencidas deste mês", "Instagram a receber"). Cada pessoa guarda as suas, no
 * aparelho (`localStorage`, por e-mail), como os favoritos do menu e dos produtos: é preferência de
 * quem usa, não regra da gráfica, e não vai para o banco.
 *
 * O que fica gravado é só o filtro, nunca dinheiro. Período é relativo ("este mês"), então a visão
 * continua certa no mês seguinte.
 */

export const LIMITE_DE_VISOES = 12;
export const TAMANHO_DO_NOME = 40;

export interface VisaoSalva<F> {
  id: string;
  nome: string;
  filtro: F;
}

export function chaveDasVisoes(tela: string, email: string | null | undefined): string {
  return `bexprint:visoes:${tela}:${(email ?? "").trim().toLowerCase() || "sem-email"}`;
}

const nomeLimpo = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TAMANHO_DO_NOME) : "");

const PERIODOS: readonly IdDoPeriodo[] = periodosDaLista("2026-01-15").map((p) => p.id);
const SITUACOES_A_PAGAR: readonly FiltroDeSituacao[] = ["tudo", "a_vencer", "vencida", "paga"];
const SITUACOES_A_RECEBER: readonly FiltroDeSituacaoAReceber[] = ["tudo", "a_vencer", "vencida", "recebida"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const textoCurto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Filtro de contas a pagar vindo do armazenamento: o que não bate vira nulo. */
export function validarFiltroAPagar(v: unknown): FiltroDaLista | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (!SITUACOES_A_PAGAR.includes(f.situacao as FiltroDeSituacao)) return null;
  if (!PERIODOS.includes(f.periodo as IdDoPeriodo)) return null;
  return { situacao: f.situacao as FiltroDeSituacao, periodo: f.periodo as IdDoPeriodo, busca: textoCurto(f.busca, 80) };
}

/** Filtro de contas a receber vindo do armazenamento. */
export function validarFiltroAReceber(v: unknown): FiltroAReceber | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (!SITUACOES_A_RECEBER.includes(f.situacao as FiltroDeSituacaoAReceber)) return null;
  if (!PERIODOS.includes(f.periodo as IdDoPeriodo)) return null;
  const clienteId = typeof f.clienteId === "string" && (f.clienteId === "todos" || UUID.test(f.clienteId)) ? f.clienteId : "todos";
  return {
    situacao: f.situacao as FiltroDeSituacaoAReceber,
    periodo: f.periodo as IdDoPeriodo,
    busca: textoCurto(f.busca, 80),
    clienteId,
    origem: textoCurto(f.origem, 60) || FILTRO_A_RECEBER_VAZIO.origem,
  };
}

/** A lista gravada, limpa: nome, filtro válido, ids únicos, até o limite. Lixo vira lista vazia. */
export function normalizarVisoes<F>(valor: unknown, validar: (f: unknown) => F | null): VisaoSalva<F>[] {
  if (!Array.isArray(valor)) return [];
  const ids = new Set<string>();
  const saida: VisaoSalva<F>[] = [];
  for (const bruto of valor as { id?: unknown; nome?: unknown; filtro?: unknown }[]) {
    const id = typeof bruto?.id === "string" ? bruto.id.trim() : "";
    const nome = nomeLimpo(bruto?.nome);
    const filtro = validar(bruto?.filtro);
    if (!id || !nome || filtro === null || ids.has(id)) continue;
    ids.add(id);
    saida.push({ id, nome, filtro });
    if (saida.length >= LIMITE_DE_VISOES) break;
  }
  return saida;
}

export function lerVisoes<F>(
  chave: string,
  armazem: Pick<Storage, "getItem"> | null | undefined,
  validar: (f: unknown) => F | null,
): VisaoSalva<F>[] {
  try {
    const bruto = armazem?.getItem(chave);
    return bruto ? normalizarVisoes(JSON.parse(bruto), validar) : [];
  } catch {
    return [];
  }
}

export function gravarVisoes<F>(chave: string, lista: readonly VisaoSalva<F>[], armazem: Pick<Storage, "setItem"> | null | undefined): void {
  try {
    armazem?.setItem(chave, JSON.stringify(lista.slice(0, LIMITE_DE_VISOES)));
  } catch {
    // Armazenamento bloqueado (aba privada, cota): a visão vale só até fechar a tela.
  }
}

export type ResultadoDoSalvar<F> = { ok: true; lista: VisaoSalva<F>[] } | { ok: false; erro: string };

/**
 * Guarda a visão. Nome igual (sem olhar maiúscula nem acento) troca o filtro da visão que já
 * existe, em vez de duplicar. Passou do limite, recusa e diz por quê.
 */
export function salvarVisao<F>(lista: readonly VisaoSalva<F>[], nome: string, filtro: F, novoId: string): ResultadoDoSalvar<F> {
  const limpo = nomeLimpo(nome);
  if (!limpo) return { ok: false, erro: "Dê um nome à visão." };
  const chave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const igual = lista.find((v) => chave(v.nome) === chave(limpo));
  if (igual) return { ok: true, lista: lista.map((v) => (v.id === igual.id ? { ...v, nome: limpo, filtro } : v)) };
  if (lista.length >= LIMITE_DE_VISOES) return { ok: false, erro: `Você já tem ${LIMITE_DE_VISOES} visões. Remova uma antes de guardar outra.` };
  return { ok: true, lista: [...lista, { id: novoId, nome: limpo, filtro }] };
}

export function removerVisao<F>(lista: readonly VisaoSalva<F>[], id: string): VisaoSalva<F>[] {
  return lista.filter((v) => v.id !== id);
}

/** A visão cujo filtro é exatamente o de agora, para a tela marcá-la como ativa. */
export function visaoAtiva<F>(lista: readonly VisaoSalva<F>[], filtro: F): VisaoSalva<F> | null {
  const alvo = JSON.stringify(filtro);
  return lista.find((v) => JSON.stringify(v.filtro) === alvo) ?? null;
}

/**
 * Ao aplicar uma visão de contas a receber, cliente e origem que não existem mais na lista de agora
 * voltam ao padrão: um filtro apontando para o vazio esconderia a lista inteira sem explicação.
 */
export function ajustarVisaoAReceber(
  filtro: FiltroAReceber,
  clientesDaLista: ReadonlyArray<{ id: string }>,
  origensDaLista: readonly string[],
): FiltroAReceber {
  const clienteOk = filtro.clienteId === "todos" || clientesDaLista.some((c) => c.id === filtro.clienteId);
  const origemOk = filtro.origem === "todas" || filtro.origem === "sem" || origensDaLista.includes(filtro.origem);
  return {
    ...filtro,
    clienteId: clienteOk ? filtro.clienteId : "todos",
    origem: origemOk ? filtro.origem : "todas",
  };
}
