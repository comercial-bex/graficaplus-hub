/**
 * Quão fresco é o dado na parede — o selo de idade, o relógio corrigido e as
 * durações que a tela escreve.
 *
 * A REGRA QUE VALE PARA TUDO AQUI: a idade do dado é `agora corrigido −
 * gerado_em do servidor`. "Agora corrigido" é o relógio do aparelho somado ao
 * DESVIO medido a cada resposta (gerado_em − hora em que a resposta chegou).
 * Um mini PC com a hora 11 minutos adiantada não vê "PARADO" num dado de 20
 * segundos — e o relógio de 56 px da parede é o do servidor, não o dele.
 *
 * Degraus, proporcionais ao intervalo que o servidor informa:
 *   AO VIVO    idade ≤ 2,5× intervalo (150 s)       — e a última busca deu certo
 *   ATRASADO   idade ≤ 5× intervalo (300 s)         — chip amarelo, brilho cheio
 *   PARADO     acima                                — chip vermelho, tudo esmaece
 *   SEM CONEXÃO                                     — desde a PRIMEIRA busca que
 *              falha, qualquer que seja a idade; tudo esmaece
 *   FORA DO EXPEDIENTE                              — dado vivo, mas o servidor
 *              disse que a oficina está fechada: cinza, sem pulso. Se o dado
 *              envelhecer de verdade, vira ATRASADO/PARADO do mesmo jeito.
 *
 * Domínio puro: recebe números e devolve textos; não lê relógio nenhum.
 */

import { FUSO_DA_OFICINA } from "./painel";

export type GrauDeIdade = "vivo" | "atrasado" | "parado";

export const VEZES_ATE_ATRASADO = 2.5;
export const VEZES_ATE_PARADO = 5;

export function grauPelaIdade(idadeS: number, intervaloS: number): GrauDeIdade {
  const base = intervaloS > 0 ? intervaloS : 60;
  if (idadeS <= VEZES_ATE_ATRASADO * base) return "vivo";
  if (idadeS <= VEZES_ATE_PARADO * base) return "atrasado";
  return "parado";
}

/** "26s", "7 MIN", "3 H" — como a maquete escreve a idade ao lado do selo. */
export function textoDaIdade(idadeS: number): string {
  const s = Math.max(0, Math.floor(idadeS));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} MIN`;
  return `${Math.floor(s / 3600)} H`;
}

/**
 * O desvio do relógio da TV, recalculado a cada resposta: o servidor carimbou
 * `geradoEmMs`; a resposta chegou quando o aparelho marcava `recebidoEmMs`.
 * Se `gerado_em` NÃO avançou em relação à resposta anterior (resposta repetida,
 * cache no caminho), o desvio anterior é mantido e a idade segue crescendo —
 * dado que não anda é dado velho.
 */
export function desvioDoRelogio(
  anterior: { geradoEmMs: number; desvioMs: number } | null,
  geradoEmMs: number,
  recebidoEmMs: number,
): { geradoEmMs: number; desvioMs: number } {
  if (anterior && geradoEmMs <= anterior.geradoEmMs) return anterior;
  return { geradoEmMs, desvioMs: geradoEmMs - recebidoEmMs };
}

export function idadeEmSegundos(
  agoraDoAparelhoMs: number,
  desvioMs: number,
  geradoEmMs: number,
): number {
  return Math.max(0, (agoraDoAparelhoMs + desvioMs - geradoEmMs) / 1000);
}

export type Selo = {
  tipo:
    | "vivo"
    | "atrasado"
    | "parado"
    | "sem_conexao"
    | "dado_invalido"
    | "fora_do_expediente"
    | "retrato"
    | "carregando"
    | "sem_dado";
  /** o texto sem a parte que muda a cada segundo */
  texto: string;
  /** o pedaço que a tela atualiza sozinha (idade); null quando não há */
  idade: string | null;
  cor: "neon" | "amarelo" | "vermelho" | "cinza";
  pulsa: boolean;
  /** "esmaece": PARADO e sem conexão apagam o brilho de tudo que afirma algo */
  velho: boolean;
  /** "quieto": fora do AO VIVO nada pulsa e nenhuma lista troca de página */
  quieto: boolean;
};

export type FalhaDaBusca = "servidor" | "rede" | "contrato" | null;

/**
 * O selo a partir do que a tela sabe: a idade, o intervalo, se a última busca
 * falhou (e como) e se o servidor disse que é expediente.
 */
export function seloDeIdade(args: {
  idadeS: number;
  intervaloS: number;
  falha: FalhaDaBusca;
  dentroDoExpediente: boolean;
  /** "AO VIVO SIMULADO" no modo de exemplo: a parede nunca diz AO VIVO sem prova */
  simulado?: boolean;
  /** hora local do dado ("15:25"), para "FORA DO EXPEDIENTE · dado das 15:25" */
  horaDoDado?: string;
}): Selo {
  const idade = textoDaIdade(args.idadeS);
  if (args.falha === "contrato") {
    return {
      tipo: "dado_invalido",
      texto: "DADO INVÁLIDO",
      idade,
      cor: "vermelho",
      pulsa: false,
      velho: true,
      quieto: true,
    };
  }
  if (args.falha) {
    return {
      tipo: "sem_conexao",
      texto: "SEM CONEXÃO",
      idade,
      cor: "vermelho",
      pulsa: false,
      velho: true,
      quieto: true,
    };
  }
  const grau = grauPelaIdade(args.idadeS, args.intervaloS);
  if (grau === "parado") {
    return {
      tipo: "parado",
      texto: "PARADO",
      idade,
      cor: "vermelho",
      pulsa: false,
      velho: true,
      quieto: true,
    };
  }
  if (grau === "atrasado") {
    return {
      tipo: "atrasado",
      texto: "ATRASADO",
      idade,
      cor: "amarelo",
      pulsa: false,
      velho: false,
      quieto: true,
    };
  }
  if (!args.dentroDoExpediente && !args.simulado) {
    return {
      tipo: "fora_do_expediente",
      texto: `FORA DO EXPEDIENTE · dado das ${args.horaDoDado ?? "—"}`,
      idade: null,
      cor: "cinza",
      pulsa: false,
      velho: false,
      quieto: true,
    };
  }
  return {
    tipo: "vivo",
    texto: args.simulado ? "AO VIVO SIMULADO" : "AO VIVO",
    idade,
    cor: "neon",
    pulsa: true,
    velho: false,
    quieto: false,
  };
}

/** O selo do retrato (modo de exemplo "hoje"): dado parado de propósito, nunca AO VIVO. */
export function seloDeRetrato(diaHora: string): Selo {
  return {
    tipo: "retrato",
    texto: `RETRATO · ${diaHora}`,
    idade: null,
    cor: "cinza",
    pulsa: false,
    velho: false,
    quieto: true,
  };
}

/* ------------------------------------------------------------------------- */
/* Horas e durações, sempre no fuso de Macapá                                 */
/* ------------------------------------------------------------------------- */

const fHMS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_OFICINA,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const fHM = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_DA_OFICINA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DA_OFICINA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "15:25:46" — o relógio da parede. */
export function horaMinutoSegundo(ms: number): string {
  return fHMS.format(new Date(ms));
}

/** "15:25". */
export function horaMinuto(ms: number): string {
  return fHM.format(new Date(ms));
}

/** "2026-10-01", no dia de Macapá. */
export function diaLocal(ms: number): string {
  return fDia.format(new Date(ms));
}

const DIAS_DA_SEMANA = ["DOMINGO", "SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO"];

/** "QUINTA · 01/10/2026" — a data do cabeçalho. */
export function dataDoCabecalho(ms: number): string {
  const iso = diaLocal(ms);
  const semana = new Date(
    Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)),
  ).getUTCDay();
  return `${DIAS_DA_SEMANA[semana]} · ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "45 min", "1h20", "2h05" — duração em minutos inteiros, nunca negativa. */
export function duracao(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
