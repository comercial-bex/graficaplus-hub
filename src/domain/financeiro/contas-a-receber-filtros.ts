import { ORIGENS } from "../crm/origens";
import { periodosDaLista, semAcento, type IdDoPeriodo, type TotaisDaLista } from "./lista-de-contas";

/**
 * Filtros da tela de Contas a receber no desenho do Holdprint (01/11/2026): busca, situação,
 * período do vencimento, cliente e origem do cliente, com os totais do que está na tela.
 *
 * A conta a receber é uma obrigação com parcelas. Os filtros olham a conta inteira:
 *  - situação: com valor vencido é "vencida"; com valor em aberto e nada vencido é "a vencer";
 *    sem nada em aberto e marcada como recebida é "recebida";
 *  - período: a conta passa se ALGUMA parcela dela vence dentro do período;
 *  - origem: a do CLIENTE (Instagram, indicação, balcão...), que mostra de qual canal vem o dinheiro.
 *
 * Datas são "aaaa-mm-dd" como texto e o "hoje" vem de fora, como em `lista-de-contas.ts`.
 */

export type SituacaoAReceber = "a_vencer" | "vencida" | "recebida";
export type FiltroDeSituacaoAReceber = "tudo" | SituacaoAReceber;

export interface ContaAReceber {
  status: string;
  cliente_id: string | null;
  cliente: string | null;
  cliente_origem?: string | null;
  os_numero: number | string | null;
  os_titulo: string | null;
  valor_total: number;
  recebido: number;
  a_receber: number;
  vencido: number;
  parcelas: ReadonlyArray<{ vencimento: string | null }>;
}

export interface FiltroAReceber {
  situacao: FiltroDeSituacaoAReceber;
  periodo: IdDoPeriodo;
  busca: string;
  /** "todos" ou o id do cliente. */
  clienteId: string;
  /** "todas", "sem" (cliente sem origem informada) ou o texto da origem. */
  origem: string;
}

export const FILTRO_A_RECEBER_VAZIO: FiltroAReceber = {
  situacao: "tudo",
  periodo: "todos",
  busca: "",
  clienteId: "todos",
  origem: "todas",
};

export const CHIPS_A_RECEBER: ReadonlyArray<{ id: FiltroDeSituacaoAReceber; rotulo: string }> = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "a_vencer", rotulo: "A vencer" },
  { id: "vencida", rotulo: "Vencidas" },
  { id: "recebida", rotulo: "Recebidas" },
];

export function situacaoDaContaAReceber(c: Pick<ContaAReceber, "status" | "vencido" | "a_receber">): SituacaoAReceber {
  if (c.vencido > 0) return "vencida";
  if (c.a_receber > 0 || c.status !== "recebido") return "a_vencer";
  return "recebida";
}

export function filtrarPorPeriodoBuscaClienteEOrigem<T extends ContaAReceber>(
  contas: readonly T[],
  filtro: Pick<FiltroAReceber, "periodo" | "busca" | "clienteId" | "origem">,
  hoje: string,
): T[] {
  const periodo = periodosDaLista(hoje).find((p) => p.id === filtro.periodo);
  const procurado = semAcento(filtro.busca.trim());
  return contas.filter((c) => {
    if (filtro.clienteId !== "todos" && c.cliente_id !== filtro.clienteId) return false;
    const origem = (c.cliente_origem ?? "").trim();
    if (filtro.origem === "sem" && origem !== "") return false;
    if (filtro.origem !== "todas" && filtro.origem !== "sem" && origem !== filtro.origem) return false;
    if (periodo?.de || periodo?.ate) {
      const algumaNoPeriodo = c.parcelas.some(
        (p) => !!p.vencimento && (!periodo.de || p.vencimento >= periodo.de) && (!periodo.ate || p.vencimento <= periodo.ate),
      );
      if (!algumaNoPeriodo) return false;
    }
    if (!procurado) return true;
    const alvo = semAcento([c.cliente, c.os_titulo, c.os_numero != null ? `os ${c.os_numero}` : null].filter(Boolean).join(" "));
    return alvo.includes(procurado.replace(/^#/, ""));
  });
}

export function filtrarPorSituacaoAReceber<T extends ContaAReceber>(
  contas: readonly T[],
  situacao: FiltroDeSituacaoAReceber,
): T[] {
  if (situacao === "tudo") return [...contas];
  return contas.filter((c) => situacaoDaContaAReceber(c) === situacao);
}

export function contarSituacoesAReceber(contas: readonly ContaAReceber[]): Record<FiltroDeSituacaoAReceber, number> {
  const n: Record<FiltroDeSituacaoAReceber, number> = { tudo: contas.length, a_vencer: 0, vencida: 0, recebida: 0 };
  for (const c of contas) n[situacaoDaContaAReceber(c)] += 1;
  return n;
}

const emCentavos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Totais do que está na tela, em centavos inteiros. O que cada conta ainda deve se divide em
 * vencido e a vencer; o recebido vem à parte. `pagas` leva o recebido, para o mesmo rodapé
 * servir às duas listas (a tela de receber troca o nome para "Recebidas").
 */
export function totaisAReceber(contas: readonly ContaAReceber[]): TotaisDaLista {
  let aVencer = 0;
  let vencidas = 0;
  let recebidas = 0;
  for (const c of contas) {
    const vencido = emCentavos(c.vencido);
    aVencer += Math.max(0, emCentavos(c.a_receber) - vencido);
    vencidas += vencido;
    recebidas += emCentavos(c.recebido);
  }
  return {
    aVencer: aVencer / 100,
    vencidas: vencidas / 100,
    pagas: recebidas / 100,
    total: (aVencer + vencidas + recebidas) / 100,
    quantidade: contas.length,
  };
}

/** Clientes que aparecem nas contas, sem repetir, em ordem alfabética. */
export function clientesDasContas(contas: readonly ContaAReceber[]): Array<{ id: string; nome: string }> {
  const por = new Map<string, string>();
  for (const c of contas) {
    if (c.cliente_id && !por.has(c.cliente_id)) por.set(c.cliente_id, (c.cliente ?? "").trim() || "Cliente sem nome");
  }
  return [...por.entries()]
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** As origens da lista de sempre, mais as que já estão gravadas nos clientes das contas e fogem dela. */
export function origensDasContas(contas: readonly ContaAReceber[]): string[] {
  const extras = new Set<string>();
  for (const c of contas) {
    const o = (c.cliente_origem ?? "").trim();
    if (o && !ORIGENS.includes(o)) extras.add(o);
  }
  return [...ORIGENS, ...[...extras].sort((a, b) => a.localeCompare(b, "pt-BR"))];
}
