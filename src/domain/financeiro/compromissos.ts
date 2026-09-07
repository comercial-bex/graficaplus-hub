/**
 * Compromissos: o que a casa deve todo mês, e por quantos meses ainda.
 *
 * As contas que o financiamento faz e que a tela precisa responder sem ir ao
 * banco a cada render. Ficam aqui, fora do componente, porque são regra de
 * negócio e porque erro de conta em dinheiro é o tipo de erro que ninguém vê:
 * um saldo devedor plausível e errado passa despercebido por meses.
 */

export type Compromisso = {
  id: string;
  descricao: string;
  credor: string;
  tipo: string;
  numero_contrato: string | null;
  observacoes: string | null;
  maquina_nome?: string | null;
  financeira: string | null;
  portal_url: string | null;
  /** false = valores do contrato, ainda não batidos com o boleto da financeira. */
  cronograma_confirmado: boolean;
  com_comprovante: number;
  sem_comprovante: number;
  valor_parcela: number;
  total_parcelas: number | null;
  primeira_parcela: string;
  periodicidade: string;
  valor_entrada: number;
  valor_total: number | null;
  ativo: boolean;
  parcelas_geradas: number;
  parcelas_pagas: number;
  valor_pago: number;
  parcelas_abertas: number;
  valor_aberto: number;
  parcelas_atrasadas: number;
  valor_atrasado: number;
  proximo_vencimento: string | null;
  ultimo_vencimento: string | null;
  saldo_devedor: number | null;
};

/** Fator que leva a parcela de qualquer periodicidade para o mês. */
export const POR_MES: Record<string, number> = {
  semanal: 52 / 12,
  quinzenal: 24 / 12,
  mensal: 1,
  bimestral: 1 / 2,
  trimestral: 1 / 3,
  semestral: 1 / 6,
  anual: 1 / 12,
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Quanto sai por mês, somando tudo na mesma régua.
 *
 * Um anual de R$ 1.200 e um mensal de R$ 1.200 não pesam igual, e somar as
 * parcelas cruas trataria os dois como a mesma coisa. Só entra compromisso
 * ATIVO e que ainda tem parcela em aberto: contrato quitado não é despesa fixa,
 * e continuar somando ele inflaria o custo mensal para sempre.
 */
export function custoMensal(compromissos: Compromisso[]): number {
  return compromissos
    .filter((c) => c.ativo && c.parcelas_abertas > 0)
    .reduce((soma, c) => soma + num(c.valor_parcela) * (POR_MES[c.periodicidade] ?? 1), 0);
}

/** Total ainda devido nos contratos com fim. Sem fim não tem saldo: não acaba. */
export function saldoDevedorTotal(compromissos: Compromisso[]): number {
  return compromissos
    .filter((c) => c.ativo)
    .reduce((soma, c) => soma + Math.max(0, num(c.saldo_devedor)), 0);
}

export function totalAtrasado(compromissos: Compromisso[]): number {
  return compromissos.reduce((soma, c) => soma + num(c.valor_atrasado), 0);
}

/**
 * Em que parcela o contrato está — a pergunta que se faz olhando o boleto.
 *
 * É a contagem de PAGAS mais um, não a posição no calendário: quem está
 * atrasado continua na parcela que deve, não na do mês corrente.
 */
export function parcelaAtual(c: Compromisso): { numero: number; de: number | null } | null {
  if (!c.total_parcelas) return null;
  const numero = Math.min(num(c.parcelas_pagas) + 1, c.total_parcelas);
  return { numero, de: c.total_parcelas };
}

/** Quanto do contrato já foi pago, de 0 a 1. */
export function progresso(c: Compromisso): number {
  const total = num(c.total_parcelas) * num(c.valor_parcela);
  if (total <= 0) return 0;
  return Math.min(1, num(c.valor_pago) / total);
}

/**
 * Quando o contrato acaba, contando a partir da primeira parcela.
 *
 * Sai da data e do total, não do calendário de parcelas geradas: um
 * compromisso pode estar com as parcelas ainda por gerar e a data de término
 * já é conhecida no dia da assinatura.
 */
export function terminaEm(c: Compromisso): Date | null {
  if (!c.total_parcelas || !c.primeira_parcela) return null;
  const base = new Date(`${c.primeira_parcela}T12:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const passos = c.total_parcelas - 1;
  const d = new Date(base);
  switch (c.periodicidade) {
    case "semanal":   d.setDate(d.getDate() + 7 * passos); break;
    case "quinzenal": d.setDate(d.getDate() + 15 * passos); break;
    case "bimestral": d.setMonth(d.getMonth() + 2 * passos); break;
    case "trimestral":d.setMonth(d.getMonth() + 3 * passos); break;
    case "semestral": d.setMonth(d.getMonth() + 6 * passos); break;
    case "anual":     d.setFullYear(d.getFullYear() + passos); break;
    default:          d.setMonth(d.getMonth() + passos); break;
  }
  return d;
}

/**
 * O compromisso precisa de atenção agora?
 *
 * Em ordem de urgência. `sem_parcelas` é o que mais engana: o contrato está
 * cadastrado, aparece na lista, e não tem uma conta a pagar sequer — nada
 * vence, nada atrasa, e o fluxo de caixa não sabe que ele existe. Cadastro sem
 * parcela é compromisso invisível.
 */
export function situacao(c: Compromisso): "atrasado" | "sem_parcelas" | "quitado" | "em_dia" {
  if (num(c.parcelas_atrasadas) > 0) return "atrasado";
  if (num(c.parcelas_geradas) === 0) return "sem_parcelas";
  if (c.total_parcelas != null && num(c.parcelas_pagas) >= c.total_parcelas) return "quitado";
  return "em_dia";
}

/**
 * O que ainda falta para este compromisso estar em ordem, em ordem de peso.
 *
 * O sistema não emite boleto: ele espelha o cronograma da financeira e guarda a
 * prova. Então "em ordem" quer dizer três coisas — o cronograma bate com o
 * título, as parcelas existem, e toda parcela paga tem comprovante anexado.
 *
 * O caso mais silencioso é o último: uma parcela marcada como paga SEM
 * comprovante é uma afirmação sem prova. Ela some do saldo devedor e do
 * atrasado, o painel fica verde, e no dia em que alguém pedir o recibo não tem.
 */
export function pendencias(c: Compromisso): string[] {
  const p: string[] = [];
  if (num(c.parcelas_geradas) === 0) {
    p.push("as parcelas do contrato ainda não foram lançadas");
  } else if (!c.cronograma_confirmado) {
    p.push("o cronograma é o do contrato e ainda não foi conferido no boleto da financeira");
  }
  if (num(c.parcelas_atrasadas) > 0) {
    p.push(`${c.parcelas_atrasadas} parcela(s) vencida(s) sem baixa`);
  }
  if (num(c.sem_comprovante) > 0) {
    p.push(`${c.sem_comprovante} parcela(s) dada(s) como paga(s) sem comprovante anexado`);
  }
  return p;
}
