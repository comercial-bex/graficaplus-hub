/**
 * Visão geral do WhatsApp (/whatsapp-visao-geral, 08/10/2026): os números do
 * atendimento, contados a partir das linhas do banco — nada é "estimado".
 *
 * Funções puras: a tela busca as linhas (usar-visao-geral.ts) e estas contam.
 * Os dias são os de Macapá/Belém (UTC−3, sem horário de verão desde 2019):
 * "hoje" começa à meia-noite local, não à meia-noite UTC (21h daqui).
 *
 * Tempo de resposta: mediana e média calculadas sobre os atendimentos, nunca
 * média de médias (por atendente também — cada um sobre as próprias linhas).
 */
import { SETORES, ehSetor, esperaDe, type Espera, type Setor } from "./filas";

const FUSO = "America/Belem";
const OFFSET = "-03:00";

/** Janela padrão dos números "da semana". */
export const DIAS_DA_JANELA = 7;

/** Sem sinal do Z-API há mais que isto: vale conferir o webhook. */
export const SEM_SINAL_ATENCAO_H = 48;

/* ------------------------------------------------------------------ */
/* Datas locais                                                        */
/* ------------------------------------------------------------------ */

/** "2026-10-08" — o dia em Macapá/Belém. */
export function diaLocal(d: Date): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Meia-noite local do dia de `agora`. */
export function inicioDoDia(agora: Date): Date {
  return new Date(`${diaLocal(agora)}T00:00:00${OFFSET}`);
}

/** Meia-noite local de `dias - 1` dias atrás: a janela inclui hoje. */
export function inicioDaJanela(agora: Date, dias: number = DIAS_DA_JANELA): Date {
  const hoje = inicioDoDia(agora);
  return new Date(hoje.getTime() - (dias - 1) * 86_400_000);
}

/** Os `dias` dias da janela, do mais antigo para hoje. */
export function diasDaJanela(agora: Date, dias: number = DIAS_DA_JANELA): string[] {
  const inicio = inicioDaJanela(agora, dias);
  // Meio-dia de cada dia: longe da virada, sem tropeço de arredondamento.
  return Array.from({ length: dias }, (_, i) => diaLocal(new Date(inicio.getTime() + i * 86_400_000 + 12 * 3_600_000)));
}

const DIA_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "qua 08" — rótulo curto do eixo. */
export function rotuloDoDia(dia: string): string {
  const d = new Date(`${dia}T12:00:00${OFFSET}`);
  return `${DIA_DA_SEMANA[d.getUTCDay()]} ${dia.slice(8, 10)}`;
}

/** "12 min", "2 h 05", "3 d 4 h"; abaixo de 1 minuto, "< 1 min". */
export function formatarMinutos(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "—";
  const m = Math.max(0, Math.round(min));
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.floor((m % (24 * 60)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

export type MensagemDoPainel = {
  direcao: string;
  origem: string | null;
  enviada_por: string | null;
  recebido_em: string | null;
  enviado_em: string | null;
  created_at: string;
};

export type QuemEnviou = "cliente" | "empresa" | "equipe" | "celular" | "assistente" | "automacao";

/** Quando a mensagem aconteceu (a mesma ordem da caixa de entrada). */
export function quandoDaMensagem(m: Pick<MensagemDoPainel, "recebido_em" | "enviado_em" | "created_at">): string {
  return m.recebido_em ?? m.enviado_em ?? m.created_at;
}

/**
 * De quem é a mensagem. Entrada com origem `automacao` é modelo de empresa
 * (propaganda, "hydratedTemplate") — não é cliente e não entra nas recebidas.
 */
export function quemEnviou(m: Pick<MensagemDoPainel, "direcao" | "origem" | "enviada_por">): QuemEnviou {
  if (m.direcao === "entrada") return m.origem === "automacao" ? "empresa" : "cliente";
  if (m.enviada_por) return "equipe";
  if (m.origem === "ia") return "assistente";
  if (m.origem === "automacao") return "automacao";
  return "celular";
}

export type ResumoDoDia = {
  recebidas: number;
  deEmpresas: number;
  enviadas: number;
  porQuem: Record<"equipe" | "celular" | "assistente" | "automacao", number>;
};

/** As mensagens de hoje (dia local), por quem mandou. */
export function resumoDoDia(mensagens: MensagemDoPainel[], agora: Date): ResumoDoDia {
  const hoje = diaLocal(agora);
  const r: ResumoDoDia = {
    recebidas: 0,
    deEmpresas: 0,
    enviadas: 0,
    porQuem: { equipe: 0, celular: 0, assistente: 0, automacao: 0 },
  };
  for (const m of mensagens) {
    if (diaLocal(new Date(quandoDaMensagem(m))) !== hoje) continue;
    const quem = quemEnviou(m);
    if (quem === "cliente") r.recebidas += 1;
    else if (quem === "empresa") r.deEmpresas += 1;
    else {
      r.enviadas += 1;
      r.porQuem[quem] += 1;
    }
  }
  return r;
}

export type MensagensDoDia = { dia: string; rotulo: string; recebidas: number; enviadas: number };

/** Recebidas de clientes e enviadas (todas) por dia da janela. */
export function mensagensPorDia(
  mensagens: MensagemDoPainel[],
  agora: Date,
  dias: number = DIAS_DA_JANELA,
): MensagensDoDia[] {
  const linhas = diasDaJanela(agora, dias).map((dia) => ({ dia, rotulo: rotuloDoDia(dia), recebidas: 0, enviadas: 0 }));
  const porDia = new Map(linhas.map((l) => [l.dia, l]));
  for (const m of mensagens) {
    const linha = porDia.get(diaLocal(new Date(quandoDaMensagem(m))));
    if (!linha) continue;
    const quem = quemEnviou(m);
    if (quem === "cliente") linha.recebidas += 1;
    else if (quem !== "empresa") linha.enviadas += 1;
  }
  return linhas;
}

/* ------------------------------------------------------------------ */
/* Conversas abertas e espera                                          */
/* ------------------------------------------------------------------ */

export type ConversaDoPainel = {
  id: string;
  fila: string | null;
  status: string;
  aguardando_desde: string | null;
  responsavel_id: string | null;
};

export type ResumoDaEspera = {
  abertas: number;
  esperando: number;
  atrasadas: number;
  semResponsavel: number;
  maisAntiga: { id: string; espera: Espera } | null;
  porSetor: { setor: Setor; abertas: number; esperando: number }[];
};

const ABERTA = new Set(["aberta", "pendente"]);

/** As conversas abertas agora: quantas, quantas esperando, por setor. */
export function resumoDaEspera(conversas: ConversaDoPainel[], agora: Date): ResumoDaEspera {
  const porSetor = new Map<Setor, { setor: Setor; abertas: number; esperando: number }>(
    SETORES.map((s) => [s.valor, { setor: s.valor, abertas: 0, esperando: 0 }]),
  );
  const r: ResumoDaEspera = { abertas: 0, esperando: 0, atrasadas: 0, semResponsavel: 0, maisAntiga: null, porSetor: [] };
  for (const c of conversas) {
    if (!ABERTA.has(c.status)) continue;
    r.abertas += 1;
    if (!c.responsavel_id) r.semResponsavel += 1;
    const linha = ehSetor(c.fila) ? porSetor.get(c.fila) : undefined;
    if (linha) linha.abertas += 1;
    const espera = esperaDe(c.aguardando_desde, agora);
    if (!espera) continue;
    r.esperando += 1;
    if (linha) linha.esperando += 1;
    if (espera.nivel === "atrasada") r.atrasadas += 1;
    if (!r.maisAntiga || espera.minutos > r.maisAntiga.espera.minutos) r.maisAntiga = { id: c.id, espera };
  }
  r.porSetor = [...porSetor.values()];
  return r;
}

/* ------------------------------------------------------------------ */
/* Atendimentos e tempo de resposta                                    */
/* ------------------------------------------------------------------ */

export type AtendimentoDoPainel = {
  id: string;
  fila: string | null;
  aberto_em: string;
  primeira_resposta_em: string | null;
  fechado_em: string | null;
  fechado_por: string | null;
  responsavel_id: string | null;
  motivo_resolucao: string | null;
};

export type Tempos = { n: number; mediana: number; media: number };

/** Mediana e média de uma lista de minutos; `null` sem nenhum valor. */
export function tempos(minutos: number[]): Tempos | null {
  const v = minutos.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  const media = v.reduce((s, x) => s + x, 0) / v.length;
  return { n: v.length, mediana, media };
}

/** Minutos da abertura do atendimento até a 1ª resposta de pessoa. */
export function minutosAtePrimeiraResposta(a: Pick<AtendimentoDoPainel, "aberto_em" | "primeira_resposta_em">): number | null {
  if (!a.primeira_resposta_em) return null;
  const ms = new Date(a.primeira_resposta_em).getTime() - new Date(a.aberto_em).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 60_000) : null;
}

export type ResumoDosAtendimentos = {
  abertosHoje: number;
  resolvidosHoje: number;
  emAndamento: number;
  /** Abertos na janela que ainda não tiveram resposta de pessoa nem foram resolvidos. */
  semResposta: number;
  /** Resolvidos na janela, por motivo. */
  motivos: Record<string, number>;
  primeiraResposta: Tempos | null;
};

/**
 * Os atendimentos (WA-AAMM-NNNN): de hoje, em andamento e o tempo até a 1ª
 * resposta dos abertos desde `inicio`. Resolvido como spam não conta no tempo
 * de resposta — ninguém deveria responder propaganda.
 */
export function resumoDosAtendimentos(
  atendimentos: AtendimentoDoPainel[],
  agora: Date,
  inicio: Date = inicioDaJanela(agora),
): ResumoDosAtendimentos {
  const hoje = diaLocal(agora);
  const r: ResumoDosAtendimentos = {
    abertosHoje: 0,
    resolvidosHoje: 0,
    emAndamento: 0,
    semResposta: 0,
    motivos: {},
    primeiraResposta: null,
  };
  const minutos: number[] = [];
  for (const a of atendimentos) {
    if (diaLocal(new Date(a.aberto_em)) === hoje) r.abertosHoje += 1;
    if (a.fechado_em && diaLocal(new Date(a.fechado_em)) === hoje) r.resolvidosHoje += 1;
    if (!a.fechado_em) r.emAndamento += 1;
    if (a.fechado_em && new Date(a.fechado_em) >= inicio && a.motivo_resolucao) {
      r.motivos[a.motivo_resolucao] = (r.motivos[a.motivo_resolucao] ?? 0) + 1;
    }
    if (new Date(a.aberto_em) < inicio || a.motivo_resolucao === "spam") continue;
    const m = minutosAtePrimeiraResposta(a);
    if (m !== null) minutos.push(m);
    else if (!a.fechado_em) r.semResposta += 1;
  }
  r.primeiraResposta = tempos(minutos);
  return r;
}

/* ------------------------------------------------------------------ */
/* Por atendente                                                       */
/* ------------------------------------------------------------------ */

export type LinhaDoAtendente = {
  id: string;
  nome: string;
  resolvidos: number;
  mensagens: number;
  primeiraResposta: Tempos | null;
};

/**
 * Quem atendeu na janela: atendimentos resolvidos (fechado_por), mensagens
 * enviadas pelo sistema (enviada_por) e tempo até a 1ª resposta dos
 * atendimentos de que a pessoa é responsável. Só entra quem fez algo.
 */
export function porAtendente(
  atendimentos: AtendimentoDoPainel[],
  mensagens: MensagemDoPainel[],
  nomes: Map<string, string>,
  inicio: Date,
): LinhaDoAtendente[] {
  const linhas = new Map<string, { resolvidos: number; mensagens: number; minutos: number[] }>();
  const de = (id: string) => {
    let l = linhas.get(id);
    if (!l) {
      l = { resolvidos: 0, mensagens: 0, minutos: [] };
      linhas.set(id, l);
    }
    return l;
  };
  for (const a of atendimentos) {
    if (a.fechado_por && a.fechado_em && new Date(a.fechado_em) >= inicio) de(a.fechado_por).resolvidos += 1;
    if (a.responsavel_id && new Date(a.aberto_em) >= inicio && a.motivo_resolucao !== "spam") {
      const m = minutosAtePrimeiraResposta(a);
      if (m !== null) de(a.responsavel_id).minutos.push(m);
    }
  }
  for (const m of mensagens) {
    if (m.direcao !== "saida" || !m.enviada_por) continue;
    if (new Date(quandoDaMensagem(m)) < inicio) continue;
    de(m.enviada_por).mensagens += 1;
  }
  return [...linhas.entries()]
    .map(([id, l]) => ({
      id,
      nome: nomes.get(id) ?? "Pessoa fora da equipe",
      resolvidos: l.resolvidos,
      mensagens: l.mensagens,
      primeiraResposta: tempos(l.minutos),
    }))
    .sort((a, b) => b.resolvidos - a.resolvidos || b.mensagens - a.mensagens || a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ------------------------------------------------------------------ */
/* Leads e orçamentos nascidos no WhatsApp                             */
/* ------------------------------------------------------------------ */

export type LeadDoPainel = { status: string; cliente_id: string | null };

export type ResumoDosLeads = { total: number; emAberto: number; ganhos: number; perdidos: number };

/** Leads de origem WhatsApp na janela, pelo status (novo → ganho/perdido). */
export function resumoDosLeads(leads: LeadDoPainel[]): ResumoDosLeads {
  const r: ResumoDosLeads = { total: leads.length, emAberto: 0, ganhos: 0, perdidos: 0 };
  for (const l of leads) {
    if (l.status === "ganho" || l.cliente_id) r.ganhos += 1;
    else if (l.status === "perdido") r.perdidos += 1;
    else r.emAberto += 1;
  }
  return r;
}

export type OrcamentoDoPainel = { status: string };

export type ResumoDosOrcamentos = { total: number; aprovados: number; emRascunho: number };

/** Orçamentos abertos a partir de uma conversa (orcamentos.conversa_id). */
export function resumoDosOrcamentos(orcamentos: OrcamentoDoPainel[]): ResumoDosOrcamentos {
  return {
    total: orcamentos.length,
    aprovados: orcamentos.filter((o) => o.status === "aprovado" || o.status === "convertido").length,
    emRascunho: orcamentos.filter((o) => o.status === "rascunho").length,
  };
}

/* ------------------------------------------------------------------ */
/* Saúde da conexão                                                    */
/* ------------------------------------------------------------------ */

export type InstanciaDoPainel = {
  status: string | null;
  conectado: boolean | null;
  ativa: boolean | null;
  ultimo_evento_at: string | null;
};

export type Saude = {
  nivel: "ok" | "atencao" | "fora";
  titulo: string;
  detalhe: string;
};

function haQuanto(iso: string | null | undefined, agora: Date): string | null {
  if (!iso) return null;
  const ms = agora.getTime() - new Date(iso).getTime();
  return Number.isFinite(ms) ? formatarMinutos(ms / 60_000) : null;
}

/**
 * Está recebendo? A instância diz se está conectada; o último evento do Z-API
 * e a última mensagem de cliente dizem se algo chega. Número quieto não é
 * defeito — por isso "sem sinal" é atenção, não "fora do ar".
 */
export function saudeDaConexao(
  instancias: InstanciaDoPainel[],
  ultimaDoCliente: string | null,
  agora: Date,
): Saude {
  const ativas = instancias.filter((i) => i.ativa !== false);
  const ultimaTexto = haQuanto(ultimaDoCliente, agora);
  const sobreCliente = ultimaTexto ? `Última mensagem de cliente há ${ultimaTexto}.` : "Nenhuma mensagem de cliente ainda.";
  if (ativas.length === 0) {
    return { nivel: "fora", titulo: "Nenhum número conectado", detalhe: "Conecte o WhatsApp na aba Monitor (bloco Conexão)." };
  }
  const conectada = ativas.find((i) => i.conectado === true && i.status === "conectada");
  if (!conectada) {
    return {
      nivel: "fora",
      titulo: "WhatsApp desconectado",
      detalhe: `Leia o QR Code de novo no painel do Z-API. ${sobreCliente}`,
    };
  }
  const sinal = conectada.ultimo_evento_at;
  const semSinalMin = sinal ? (agora.getTime() - new Date(sinal).getTime()) / 60_000 : Infinity;
  if (semSinalMin >= SEM_SINAL_ATENCAO_H * 60) {
    return {
      nivel: "atencao",
      titulo: sinal ? `Conectado, sem sinal do Z-API há ${haQuanto(sinal, agora)}` : "Conectado, sem nenhum sinal do Z-API",
      detalhe: `${sobreCliente} Se algum cliente disse que escreveu e a mensagem não apareceu, confira no Z-API o webhook "Ao receber".`,
    };
  }
  return {
    nivel: "ok",
    // "Conectado", não "recebendo": o sinal recente prova a conexão, não que
    // cliente esteja escrevendo — isso o detalhe diz com a data.
    titulo: "Conectado",
    detalhe: `Último sinal do Z-API há ${haQuanto(sinal, agora) ?? "—"}. ${sobreCliente}`,
  };
}
