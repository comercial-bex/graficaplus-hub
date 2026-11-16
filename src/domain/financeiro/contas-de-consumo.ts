/**
 * Contas de consumo (16/11/2026): energia, água, internet, telefone e gás. A unidade consumidora
 * diz de quem, qual número, quando costuma vencer e de onde costuma sair; cada fatura do mês é uma
 * conta a pagar comum, ligada à unidade e à competência (migração 20261116220000).
 *
 * Aqui só o que a tela calcula: rótulos, a duplicidade (o banco recusa igual), a fatura em falta,
 * a série de 12 meses e a variação contra o mês anterior. Nada grava.
 */

export type TipoDeConsumo = "energia" | "agua" | "internet" | "telefone" | "gas" | "outro";

export const TIPOS_DE_CONSUMO: {
  valor: TipoDeConsumo;
  rotulo: string;
  /** Unidade do consumo na fatura; internet, telefone e outro não têm. */
  medida: "kWh" | "m³" | null;
  /** O que a fatura chama de número da unidade. */
  numero: "UC" | "Contrato";
}[] = [
  { valor: "energia", rotulo: "Energia", medida: "kWh", numero: "UC" },
  { valor: "agua", rotulo: "Água", medida: "m³", numero: "UC" },
  { valor: "internet", rotulo: "Internet", medida: null, numero: "Contrato" },
  { valor: "telefone", rotulo: "Telefone", medida: null, numero: "Contrato" },
  { valor: "gas", rotulo: "Gás", medida: "m³", numero: "UC" },
  { valor: "outro", rotulo: "Outro", medida: null, numero: "Contrato" },
];

export const dadosDoTipo = (tipo: string) =>
  TIPOS_DE_CONSUMO.find((t) => t.valor === tipo) ?? TIPOS_DE_CONSUMO[TIPOS_DE_CONSUMO.length - 1];

/** Quantos dias antes do vencimento habitual a falta da fatura vira aviso. */
export const DIAS_DE_ANTECEDENCIA_DO_AVISO = 5;

export interface UnidadeDeConsumo {
  id: string;
  tipo: TipoDeConsumo | string;
  fornecedor_id: string;
  identificador: string;
  endereco: string | null;
  dia_vencimento: number | null;
  conta_bancaria_id: string | null;
  observacoes: string | null;
  ativo: boolean;
  fornecedores?: { nome: string; razao_social: string | null } | null;
}

export interface ContaDaFatura {
  id: string;
  descricao: string;
  fornecedor: string | null;
  valor: number | string;
  vencimento: string;
  status: string;
  data_pagamento: string | null;
  comprovante_url: string | null;
}

export interface FaturaDeConsumo {
  conta_pagar_id: string;
  unidade_id: string;
  competencia: string; // AAAA-MM-01
  consumo: number | string | null;
  bandeira_taxas: number | string | null;
  iluminacao_publica: number | string | null;
  numero_nf: string | null;
  contas_pagar: ContaDaFatura | null;
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBr = (d: string) => {
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
};

/** "2026-10" ou "2026-10-15" vira "2026-10-01". */
export function competenciaDe(valor: string): string {
  const [a, m] = valor.slice(0, 7).split("-");
  return `${a}-${m}-01`;
}

/** "2026-10-01" vira "10/2026". */
export function rotuloDaCompetencia(competencia: string): string {
  const [a, m] = competencia.slice(0, 7).split("-");
  return `${m}/${a}`;
}

/** Soma (ou subtrai) meses de uma competência. */
export function somarMeses(competencia: string, meses: number): string {
  const [a, m] = competencia.slice(0, 7).split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

/** O nome da unidade na tela: "Energia · CEA · UC 228.739.007-85". */
export function nomeDaUnidade(u: UnidadeDeConsumo): string {
  const t = dadosDoTipo(String(u.tipo));
  const fornecedor = u.fornecedores?.nome ?? "fornecedor";
  return `${t.rotulo} · ${fornecedor} · ${t.numero} ${u.identificador}`;
}

export const faturasDaUnidade = (faturas: readonly FaturaDeConsumo[], unidadeId: string) =>
  faturas
    .filter((f) => f.unidade_id === unidadeId)
    .slice()
    .sort((a, b) => b.competencia.localeCompare(a.competencia));

export function faturaDaCompetencia(
  faturas: readonly FaturaDeConsumo[],
  unidadeId: string,
  competencia: string,
): FaturaDeConsumo | undefined {
  const c = competenciaDe(competencia);
  return faturas.find((f) => f.unidade_id === unidadeId && competenciaDe(f.competencia) === c);
}

/** A mesma frase que o banco devolve quando recusa a fatura repetida. */
export function avisoDeDuplicidade(f: FaturaDeConsumo): string {
  const c = f.contas_pagar;
  const situacao = !c
    ? "conta não encontrada"
    : c.status === "paga"
      ? `paga em ${c.data_pagamento ? dataBr(c.data_pagamento) : "data não informada"}`
      : "em aberto";
  const valor = c ? brl(Number(c.valor)).replace(/\u00a0/g, " ") : "valor não encontrado";
  const vencimento = c ? dataBr(c.vencimento) : "sem vencimento";
  return `Já existe a fatura de ${rotuloDaCompetencia(f.competencia)} desta unidade: ${valor}, vencimento ${vencimento}, ${situacao}.`;
}

/** "1.234,5" ou "1234.5" vira 1234.5; vazio vira null; texto que não é número vira NaN. */
export function numeroDoCampo(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : NaN;
}

export interface LancamentoDaFatura {
  competencia: string; // AAAA-MM
  vencimento: string;
  valor: string;
  temPdf: boolean;
}

/** O que impede lançar, na ordem em que a pessoa preenche. O banco confere de novo. */
export function problemaDoLancamento(l: LancamentoDaFatura, hoje: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(l.competencia)) return "Informe a competência (mês e ano da fatura).";
  if (competenciaDe(l.competencia) > competenciaDe(hoje))
    return "Essa competência ainda não começou.";
  if (!l.vencimento) return "Informe o vencimento.";
  const valor = numeroDoCampo(l.valor);
  if (valor === null || !Number.isFinite(valor) || valor <= 0) return "Informe o valor da fatura.";
  if (!l.temPdf) return "Anexe o PDF da fatura.";
  return null;
}

/** Vencimento habitual dentro de um mês (dia 31 em fevereiro vira o último dia). */
export function vencimentoNoMes(dia: number, mesDeReferencia: string): string {
  const [a, m] = mesDeReferencia.slice(0, 7).split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

const diasEntre = (de: string, ate: string) =>
  Math.round(
    (Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) /
      86_400_000,
  );

/**
 * Falta a fatura do mês quando a unidade está ativa, tem dia habitual de vencimento, hoje já está
 * a 5 dias (ou menos) desse dia e nenhuma fatura da unidade vence neste mês. A competência é a
 * provável (mês anterior ao vencimento, como na energia).
 */
export function faturaEmFalta(
  u: UnidadeDeConsumo,
  faturas: readonly FaturaDeConsumo[],
  hoje: string,
): { vencimentoEsperado: string; competenciaProvavel: string } | null {
  if (!u.ativo || !u.dia_vencimento) return null;
  const esperado = vencimentoNoMes(u.dia_vencimento, hoje);
  if (diasEntre(hoje, esperado) > DIAS_DE_ANTECEDENCIA_DO_AVISO) return null;
  const mes = hoje.slice(0, 7);
  const venceNoMes = faturas.some(
    (f) => f.unidade_id === u.id && f.contas_pagar?.vencimento?.slice(0, 7) === mes,
  );
  if (venceNoMes) return null;
  return { vencimentoEsperado: esperado, competenciaProvavel: somarMeses(competenciaDe(hoje), -1) };
}

export interface PontoDoMes {
  competencia: string;
  rotulo: string;
  valor: number | null;
  consumo: number | null;
}

/** Os 12 meses até o mês de hoje, com buraco onde não há fatura (o gráfico mostra o vazio). */
export function serieDe12Meses(
  faturasDaUnidade: readonly FaturaDeConsumo[],
  hoje: string,
): PontoDoMes[] {
  const fim = competenciaDe(hoje);
  return Array.from({ length: 12 }, (_, i) => {
    const c = somarMeses(fim, i - 11);
    const f = faturasDaUnidade.find((x) => competenciaDe(x.competencia) === c);
    return {
      competencia: c,
      rotulo: rotuloDaCompetencia(c),
      valor: f?.contas_pagar ? num(f.contas_pagar.valor) : null,
      consumo: f ? num(f.consumo) : null,
    };
  });
}

export interface Variacao {
  atual: string;
  anterior: string;
  valorPct: number | null;
  consumoPct: number | null;
}

const pct = (atual: number | null, anterior: number | null) =>
  atual === null || anterior === null || anterior === 0
    ? null
    : Math.round(((atual - anterior) / anterior) * 1000) / 10;

/** A última fatura contra a do mês imediatamente anterior; sem a anterior, não há variação. */
export function variacaoContraAnterior(
  faturasDaUnidade: readonly FaturaDeConsumo[],
): Variacao | null {
  const ordenadas = faturasDaUnidade
    .slice()
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
  const ultima = ordenadas[0];
  if (!ultima) return null;
  const anteriorC = somarMeses(competenciaDe(ultima.competencia), -1);
  const anterior = ordenadas.find((f) => competenciaDe(f.competencia) === anteriorC);
  if (!anterior) return null;
  return {
    atual: rotuloDaCompetencia(ultima.competencia),
    anterior: rotuloDaCompetencia(anteriorC),
    valorPct: pct(
      num(ultima.contas_pagar?.valor ?? null),
      num(anterior.contas_pagar?.valor ?? null),
    ),
    consumoPct: pct(num(ultima.consumo), num(anterior.consumo)),
  };
}

/** "+11,1%" / "−4,0%" / "0,0%". */
export function textoDaVariacao(p: number | null): string {
  if (p === null) return "sem dado";
  const s = Math.abs(p).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return p > 0 ? `+${s}%` : p < 0 ? `−${s}%` : `${s}%`;
}
