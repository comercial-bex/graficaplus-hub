import { taxa, type Taxa } from "../whatsapp/triagem/metricas";

/**
 * Métricas do agente (C4): contas puras sobre as linhas das views `agente_metricas_*` (migração 20261115110000). Cada taxa
 * carrega o seu denominador, para a tela dizer "de quantas" e nunca mostrar um percentual solto. Taxa sem denominador NÃO é
 * zero por cento: é "sem base ainda".
 *
 * REAL E ENSAIO NUNCA SE MISTURAM. Ensaio é o que o agente FARIA; nada saiu. Toda conta daqui recebe o modo e soma só ele.
 *
 * Perguntas = escolhidas + entregues: o que o agente chegou a ler como pergunta. O silêncio (cortesia, robô, figurinha,
 * pedido para parar) não é pergunta e fica de fora do denominador da cobertura.
 *
 * Nenhuma linha traz texto, nome, telefone nem id de conversa. A frase do contato sem resposta nunca foi guardada: só se
 * conta quantas foram, por dia.
 */

export type ModoDeMetrica = "real" | "ensaio";
export const MODOS_DE_METRICA: readonly ModoDeMetrica[] = ["real", "ensaio"] as const;

export type LinhaDoDiaDoAgente = {
  dia: string; // "2026-11-14", dia de Macapá
  modo: ModoDeMetrica;
  ramo: "cliente" | "parceiro";
  decisoes: number;
  escolhidas: number;
  entregues: number;
  barradas: number;
  /** Escolhidas ou entregues que eram pergunta de preço. */
  sensiveis: number;
};

export type LinhaDeMotivo = {
  modo: ModoDeMetrica;
  ramo: "cliente" | "parceiro";
  acao: "entregar" | "barrar" | "parar";
  motivo: string;
  n: number;
};

export type LinhaDeResposta = {
  resposta_id: string;
  tema: string;
  status: string;
  versao: number;
  usos_real_30_dias: number;
  usos_ensaio_30_dias: number;
  usos_total: number;
  ultimo_uso: string | null;
};

export type LinhaSemResposta = {
  dia: string;
  modo: ModoDeMetrica;
  ramo: "cliente" | "parceiro";
  perguntas_sem_resposta: number;
};

/** A pergunta que o dono escreveu na tela de aprovação, para a tabela das respostas dizer de qual se trata. */
export type PerguntaDaBase = { id: string; pergunta: string; tema: string };

export type MetricasDoAgente = {
  dias: LinhaDoDiaDoAgente[];
  motivos: LinhaDeMotivo[];
  respostas: LinhaDeResposta[];
  semResposta: LinhaSemResposta[];
  base: PerguntaDaBase[];
};

/** Quantos dias a tela olha. As views de motivos e de uso já cortam em 30; a de dias traz tudo o que o rastro guarda. */
export const DIAS_DA_JANELA = 30;

/** O dia de Macapá, ISO, `quantos` dias antes de `hoje` (também ISO). Sem Date local: só aritmética de calendário em UTC. */
export function diaAntes(hoje: string, quantos: number): string {
  const [a, m, d] = hoje.split("-").map(Number);
  const t = Date.UTC(a, m - 1, d) - quantos * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function naJanela(dia: string, hoje: string): boolean {
  return dia >= diaAntes(hoje, DIAS_DA_JANELA - 1) && dia <= hoje;
}

export type ResumoDaCobertura = {
  modo: ModoDeMetrica;
  /** Todas as decisões, inclusive o silêncio. */
  decisoes: number;
  escolhidas: number;
  entregues: number;
  barradas: number;
  /** escolhidas + entregues. */
  perguntas: number;
  sensiveis: number;
  /** Perguntas respondidas por uma resposta aprovada, sobre as perguntas. */
  cobertura: Taxa;
  /** Perguntas que o agente entregou à equipe, sobre as perguntas. */
  voltaParaEquipe: Taxa;
  /** Perguntas de preço, sobre as perguntas. */
  deValor: Taxa;
};

export function resumirCobertura(
  dias: readonly LinhaDoDiaDoAgente[],
  modo: ModoDeMetrica,
  hoje: string,
): ResumoDaCobertura {
  let escolhidas = 0;
  let entregues = 0;
  let barradas = 0;
  let sensiveis = 0;
  let decisoes = 0;
  for (const l of dias) {
    if (l.modo !== modo || !naJanela(l.dia, hoje)) continue;
    escolhidas += l.escolhidas;
    entregues += l.entregues;
    barradas += l.barradas;
    sensiveis += l.sensiveis;
    decisoes += l.decisoes;
  }
  const perguntas = escolhidas + entregues;
  return {
    modo,
    decisoes,
    escolhidas,
    entregues,
    barradas,
    perguntas,
    sensiveis,
    cobertura: taxa(escolhidas, perguntas),
    voltaParaEquipe: taxa(entregues, perguntas),
    deValor: taxa(sensiveis, perguntas),
  };
}

export type ItemDeMotivo = {
  motivo: string;
  n: number;
  /** n sobre o total da lista: o denominador está dentro da própria taxa. */
  parte: Taxa;
};

export type ListaDeMotivos = {
  /** A soma da lista: o denominador de cada linha. */
  total: number;
  itens: ItemDeMotivo[];
};

/** Os motivos de uma ação, num modo, do mais frequente para o menos. O total é a soma desta lista. */
export function motivosDaAcao(
  motivos: readonly LinhaDeMotivo[],
  modo: ModoDeMetrica,
  acoes: readonly LinhaDeMotivo["acao"][],
): ListaDeMotivos {
  const soma = new Map<string, number>();
  for (const l of motivos) {
    if (l.modo !== modo || !acoes.includes(l.acao)) continue;
    soma.set(l.motivo, (soma.get(l.motivo) ?? 0) + l.n);
  }
  const total = [...soma.values()].reduce((a, b) => a + b, 0);
  const itens = [...soma.entries()]
    .map(([motivo, n]) => ({ motivo, n, parte: taxa(n, total) }))
    .sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo));
  return { total, itens };
}

export type UsoDaResposta = LinhaDeResposta & { pergunta: string };

export type UsoDasRespostas = {
  /** As respostas aprovadas, o denominador de "nunca usadas". */
  aprovadas: number;
  maisUsadas: UsoDaResposta[];
  /** Aprovadas que nunca foram escolhidas nem em ensaio, nos registros guardados. */
  nuncaUsadas: UsoDaResposta[];
  nuncaUsadasTaxa: Taxa;
};

/** Quantas aparecem em "mais usadas". */
export const QUANTAS_MAIS_USADAS = 10;

export function usoDasRespostas(
  respostas: readonly LinhaDeResposta[],
  base: readonly PerguntaDaBase[],
  modo: ModoDeMetrica,
): UsoDasRespostas {
  const perguntaDe = new Map(base.map((b) => [b.id, b.pergunta]));
  const aprovadas = respostas
    .filter((r) => r.status === "aprovada")
    .map(
      (r): UsoDaResposta => ({
        ...r,
        pergunta: perguntaDe.get(r.resposta_id) ?? r.tema.replace(/_/g, " "),
      }),
    );
  const usosNoModo = (r: LinhaDeResposta) =>
    modo === "real" ? r.usos_real_30_dias : r.usos_ensaio_30_dias;
  const maisUsadas = aprovadas
    .filter((r) => usosNoModo(r) > 0)
    .sort((a, b) => usosNoModo(b) - usosNoModo(a) || a.pergunta.localeCompare(b.pergunta))
    .slice(0, QUANTAS_MAIS_USADAS);
  const nuncaUsadas = aprovadas
    .filter((r) => r.usos_total === 0)
    .sort((a, b) => a.pergunta.localeCompare(b.pergunta));
  return {
    aprovadas: aprovadas.length,
    maisUsadas,
    nuncaUsadas,
    nuncaUsadasTaxa: taxa(nuncaUsadas.length, aprovadas.length),
  };
}

export type DiaSemResposta = {
  dia: string;
  semResposta: number;
  /** As perguntas do mesmo dia e modo: o denominador. */
  perguntas: number;
};

/** Perguntas sem resposta por dia, mais recente primeiro, cada uma com as perguntas do dia ao lado. Só contagem. */
export function semRespostaPorDia(
  semResposta: readonly LinhaSemResposta[],
  dias: readonly LinhaDoDiaDoAgente[],
  modo: ModoDeMetrica,
  hoje: string,
): DiaSemResposta[] {
  const por = new Map<string, number>();
  for (const l of semResposta) {
    if (l.modo !== modo || !naJanela(l.dia, hoje)) continue;
    por.set(l.dia, (por.get(l.dia) ?? 0) + l.perguntas_sem_resposta);
  }
  return [...por.entries()]
    .map(([dia, n]) => ({
      dia,
      semResposta: n,
      perguntas: dias
        .filter((d) => d.modo === modo && d.dia === dia)
        .reduce((a, d) => a + d.escolhidas + d.entregues, 0),
    }))
    .sort((a, b) => (a.dia < b.dia ? 1 : -1));
}

/**
 * Zerado de verdade: nenhuma decisão do agente na janela, nem real nem em ensaio. É uma resposta honesta ("sem dados ainda"),
 * não uma falha: com o agente desligado é o esperado.
 */
export function agenteSemDados(dias: readonly LinhaDoDiaDoAgente[], hoje: string): boolean {
  return !dias.some((l) => naJanela(l.dia, hoje) && l.decisoes > 0);
}

export function modoEmTexto(modo: ModoDeMetrica): string {
  return modo === "real" ? "De verdade" : "Ensaio";
}
