/**
 * Métricas da triagem de boas-vindas (B10): contas puras sobre as linhas das
 * views `triagem_metricas_*`. Cada taxa carrega o seu denominador, para a tela
 * dizer "de quantos" e nunca mostrar um percentual solto. Taxa sem denominador
 * NÃO é zero por cento: é "sem base ainda", e a tela diz isso.
 */

export type LinhaDoDia = {
  dia: string; // "2026-11-14", dia de Macapá
  ramo: "cliente" | "parceiro";
  triadas: number;
  puladas: number;
  em_andamento: number;
  concluidas: number;
  entregues_equipe: number;
  abandonadas: number;
  pausadas_humano: number;
  pausadas_desligada: number;
  paradas_pelo_contato: number;
  enviou_boas_vindas: number;
  respondeu_nome: number;
  pediu_preco: number;
  concluidas_com_tempo: number;
  soma_segundos_ate_concluir: number;
};

export type LinhaDa30Dias = {
  ramo: "cliente" | "parceiro";
  triadas: number;
  puladas: number;
  concluidas: number;
  entregues_equipe: number;
  abandonadas: number;
  pausadas_humano: number;
  /** Triagens iniciadas na janela em que a equipe já assumiu e o robô parou, mesmo as que o robô retomou depois. Cada uma conta uma vez. */
  triagens_com_pausa_humano: number;
  enviou_boas_vindas: number;
  respondeu_nome: number;
  pediu_preco: number;
  concluidas_com_tempo: number;
  mediana_segundos_ate_concluir: number | null;
};

export type Taxa = {
  numerador: number;
  denominador: number;
  /** 0 a 100, arredondado; `null` quando não há denominador. */
  percentual: number | null;
};

export function taxa(numerador: number, denominador: number): Taxa {
  if (!(denominador > 0)) return { numerador, denominador: 0, percentual: null };
  return { numerador, denominador, percentual: Math.round((numerador / denominador) * 100) };
}

export type ResumoDaJanela = {
  triadas: number;
  puladas: number;
  concluidas: number;
  entregues_equipe: number;
  abandonadas: number;
  pausadas_humano: number;
  triagens_com_pausa_humano: number;
  /** O que sobra para a soma bater: em andamento, robô desligado, contato pediu para parar. */
  outros: number;
  concluidas_taxa: Taxa;
  entregues_taxa: Taxa;
  abandonadas_taxa: Taxa;
  resposta_ao_nome: Taxa;
  pediu_preco: Taxa;
  /** Medianas por ramo: a mediana não se soma entre ramos, então não há uma geral. */
  medianaPorRamo: { ramo: "cliente" | "parceiro"; segundos: number | null; amostra: number }[];
};

/** Triadas menos os quatro destinos nomeados. Nunca negativo: se o banco devolver mais que o total, mostra 0. */
function outros(triadas: number, soma: (k: keyof LinhaDa30Dias) => number): number {
  const nomeados = soma("concluidas") + soma("entregues_equipe") + soma("abandonadas") + soma("pausadas_humano");
  return Math.max(0, triadas - nomeados);
}

export function resumirJanela(linhas: LinhaDa30Dias[]): ResumoDaJanela {
  const soma = (k: keyof LinhaDa30Dias) =>
    linhas.reduce((t, l) => t + (typeof l[k] === "number" ? (l[k] as number) : 0), 0);
  const triadas = soma("triadas");
  const enviou = soma("enviou_boas_vindas");
  return {
    triadas,
    puladas: soma("puladas"),
    concluidas: soma("concluidas"),
    entregues_equipe: soma("entregues_equipe"),
    abandonadas: soma("abandonadas"),
    pausadas_humano: soma("pausadas_humano"),
    triagens_com_pausa_humano: soma("triagens_com_pausa_humano"),
    outros: outros(triadas, soma),
    concluidas_taxa: taxa(soma("concluidas"), triadas),
    entregues_taxa: taxa(soma("entregues_equipe"), triadas),
    abandonadas_taxa: taxa(soma("abandonadas"), triadas),
    resposta_ao_nome: taxa(soma("respondeu_nome"), enviou),
    pediu_preco: taxa(soma("pediu_preco"), triadas),
    medianaPorRamo: linhas.map((l) => ({
      ramo: l.ramo,
      segundos: l.mediana_segundos_ate_concluir,
      amostra: l.concluidas_com_tempo,
    })),
  };
}

/** Concorda singular e plural: plural(1, "conversa", "conversas") dá "1 conversa", plural(2, ...) dá "2 conversas". */
export function plural(n: number, singular: string, pluralDe: string): string {
  return `${n} ${n === 1 ? singular : pluralDe}`;
}

/** "triada" ou "triadas", "concluída" ou "concluídas" etc., sem número. */
export function concorda(n: number, singular: string, pluralDe: string): string {
  return n === 1 ? singular : pluralDe;
}

/**
 * Linhas da tabela "Por dia": só dias com ao menos uma conversa triada (dia que teve só conversa pulada pelo portão
 * não é dia de triagem e não gasta uma das vagas), os `quantos` mais recentes, e dentro deles só as linhas com triada.
 */
export function linhasDaTabela(dias: LinhaDoDia[], quantos: number): LinhaDoDia[] {
  const comTriagem = dias.filter((d) => d.triadas > 0);
  const escolhidos = Array.from(new Set(comTriagem.map((d) => d.dia)))
    .sort()
    .reverse()
    .slice(0, quantos);
  return comTriagem
    .filter((d) => escolhidos.includes(d.dia))
    .sort((a, b) => (a.dia === b.dia ? a.ramo.localeCompare(b.ramo) : a.dia < b.dia ? 1 : -1));
}

/** Outros da linha do dia: triadas menos concluídas, entregues, sem resposta e pausadas pela equipe. */
export function outrosDoDia(l: LinhaDoDia): number {
  return Math.max(0, l.triadas - l.concluidas - l.entregues_equipe - l.abandonadas - l.pausadas_humano);
}

export function ramoEmTexto(ramo: string): string {
  return ramo === "parceiro" ? "Parceiro" : "Cliente final";
}

/** "2026-11-14" vira "14/11". Sem Date: o dia já é o de Macapá e Date em UTC tiraria um dia. */
export function diaCurto(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  return m ? `${m[3]}/${m[2]}` : dia;
}

export function percentualEmTexto(t: Taxa): string {
  return t.percentual === null ? "sem base ainda" : `${t.percentual}%`;
}

/** 200 vira "3 min 20 s"; 45 vira "45 s"; 7300 vira "2 h 1 min". `null` vira "sem conclusão ainda". */
export function duracaoEmTexto(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return "sem conclusão ainda";
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Média do dia, em segundos, ou `null` quando ninguém concluiu naquele dia. */
export function mediaDoDia(l: Pick<LinhaDoDia, "soma_segundos_ate_concluir" | "concluidas_com_tempo">): number | null {
  return l.concluidas_com_tempo > 0 ? l.soma_segundos_ate_concluir / l.concluidas_com_tempo : null;
}

/** Zerado de verdade: nenhuma conversa triada na janela. As puladas, sozinhas, não contam como triagem. */
export function estaZerado(resumo: Pick<ResumoDaJanela, "triadas">): boolean {
  return resumo.triadas === 0;
}
