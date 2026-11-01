/**
 * Lista financeira no desenho do Holdprint (31/10/2026), Onda 3 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: chips de situação, atalhos de período,
 * busca e rodapé de totais. As datas são "aaaa-mm-dd" como texto e o "hoje" vem de fora
 * (`hojeBr()` na tela): nada aqui lê o relógio nem o fuso do aparelho.
 *
 * A lista começa em "Todos", sem recorte de período. O Holdprint abre no mês atual e
 * esconde o resto, e o lançamento de outro mês parece "não salvo"; aqui o recorte é
 * escolha de quem olha, e a tela diz quando está mostrando só parte.
 */

export type SituacaoDaConta = "a_vencer" | "vencida" | "paga" | "cancelada";
export type FiltroDeSituacao = "tudo" | "a_vencer" | "vencida" | "paga";
export type IdDoPeriodo =
  | "todos"
  | "hoje"
  | "semana"
  | "mes"
  | "mes_passado"
  | "proximo_mes"
  | "ano";

export interface ContaDaLista {
  descricao?: string | null;
  fornecedor?: string | null;
  categoria?: string | null;
  vencimento: string;
  valor: number | string | null;
  status: string;
}

export interface Periodo {
  id: IdDoPeriodo;
  rotulo: string;
  de: string | null;
  ate: string | null;
}

export interface FiltroDaLista {
  situacao: FiltroDeSituacao;
  periodo: IdDoPeriodo;
  busca: string;
}

export interface TotaisDaLista {
  aVencer: number;
  vencidas: number;
  pagas: number;
  /** A vencer, vencidas e pagas. Conta cancelada não é dinheiro nenhum e fica fora. */
  total: number;
  quantidade: number;
}

export const FILTRO_VAZIO: FiltroDaLista = { situacao: "tudo", periodo: "todos", busca: "" };

export const CHIPS_DE_SITUACAO: ReadonlyArray<{ id: FiltroDeSituacao; rotulo: string }> = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "a_vencer", rotulo: "A vencer" },
  { id: "vencida", rotulo: "Vencidas" },
  { id: "paga", rotulo: "Pagas" },
];

/** Vence hoje ainda é "a vencer": só passa a vencida no dia seguinte. */
export function situacaoDaConta(
  c: Pick<ContaDaLista, "status" | "vencimento">,
  hoje: string,
): SituacaoDaConta {
  if (c.status === "paga") return "paga";
  if (c.status === "cancelada") return "cancelada";
  return c.vencimento < hoje ? "vencida" : "a_vencer";
}

const texto = (d: Date) => d.toISOString().slice(0, 10);

function emUtc(data: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function somarDias(data: string, n: number): string {
  const d = emUtc(data);
  d.setUTCDate(d.getUTCDate() + n);
  return texto(d);
}

/** Primeiro e último dia do mês `m` (1 a 12) do ano `a`; mês fora da faixa cai no ano vizinho. */
function mesInteiro(a: number, m: number): { de: string; ate: string } {
  return { de: texto(new Date(Date.UTC(a, m - 1, 1))), ate: texto(new Date(Date.UTC(a, m, 0))) };
}

/** Atalhos de período a partir de `hoje`. A semana vai de segunda a domingo. */
export function periodosDaLista(hoje: string): Periodo[] {
  const [a, m] = hoje.split("-").map(Number);
  const diasDesdeSegunda = (emUtc(hoje).getUTCDay() + 6) % 7;
  const segunda = somarDias(hoje, -diasDesdeSegunda);
  return [
    { id: "todos", rotulo: "Todos", de: null, ate: null },
    { id: "hoje", rotulo: "Hoje", de: hoje, ate: hoje },
    { id: "semana", rotulo: "Esta semana", de: segunda, ate: somarDias(segunda, 6) },
    { id: "mes", rotulo: "Este mês", ...mesInteiro(a, m) },
    { id: "mes_passado", rotulo: "Mês passado", ...mesInteiro(a, m - 1) },
    { id: "proximo_mes", rotulo: "Próximo mês", ...mesInteiro(a, m + 1) },
    { id: "ano", rotulo: "Este ano", de: `${a}-01-01`, ate: `${a}-12-31` },
  ];
}

export const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Recorte por vencimento e por texto (descrição, fornecedor ou categoria, sem ligar para acento). */
export function filtrarPorPeriodoEBusca<T extends ContaDaLista>(
  contas: readonly T[],
  filtro: Pick<FiltroDaLista, "periodo" | "busca">,
  hoje: string,
): T[] {
  const periodo = periodosDaLista(hoje).find((p) => p.id === filtro.periodo);
  const procurado = semAcento(filtro.busca.trim());
  return contas.filter((c) => {
    if (periodo?.de && c.vencimento < periodo.de) return false;
    if (periodo?.ate && c.vencimento > periodo.ate) return false;
    if (!procurado) return true;
    const alvo = semAcento([c.descricao, c.fornecedor, c.categoria].filter(Boolean).join(" "));
    return alvo.includes(procurado);
  });
}

export function filtrarPorSituacao<T extends ContaDaLista>(
  contas: readonly T[],
  situacao: FiltroDeSituacao,
  hoje: string,
): T[] {
  if (situacao === "tudo") return [...contas];
  return contas.filter((c) => situacaoDaConta(c, hoje) === situacao);
}

/** Quantas contas cada chip mostraria. "Tudo" conta todas; cancelada só aparece nele. */
export function contarPorSituacao(
  contas: readonly ContaDaLista[],
  hoje: string,
): Record<FiltroDeSituacao, number> {
  const n: Record<FiltroDeSituacao, number> = { tudo: contas.length, a_vencer: 0, vencida: 0, paga: 0 };
  for (const c of contas) {
    const s = situacaoDaConta(c, hoje);
    if (s !== "cancelada") n[s] += 1;
  }
  return n;
}

const emCentavos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Soma em centavos inteiros: 0,10 + 0,20 dá 0,30, sem a sobra do ponto flutuante. */
export function totaisDaLista(contas: readonly ContaDaLista[], hoje: string): TotaisDaLista {
  let aVencer = 0;
  let vencidas = 0;
  let pagas = 0;
  for (const c of contas) {
    const s = situacaoDaConta(c, hoje);
    const v = emCentavos(c.valor);
    if (s === "a_vencer") aVencer += v;
    else if (s === "vencida") vencidas += v;
    else if (s === "paga") pagas += v;
  }
  return {
    aVencer: aVencer / 100,
    vencidas: vencidas / 100,
    pagas: pagas / 100,
    total: (aVencer + vencidas + pagas) / 100,
    quantidade: contas.length,
  };
}
