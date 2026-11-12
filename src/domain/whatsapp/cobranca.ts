/**
 * Cobrança de orçamento no grupo da equipe (pedido do dono, 11/11/2026: "criar ações através do
 * Z-API para cobrar o atendimento por demora de envio de orçamento no grupo de trabalho").
 *
 * A REGRA MORA AQUI, PURA. O banco entrega FATOS (`whatsapp_cobranca_pendencias`, pessoas da
 * equipe por `whatsapp_cobranca_equipe`) e GUARDA o que saiu (`whatsapp_cobrancas`, chave única
 * por atendimento, nível e modo). A rodada do servidor (`whatsapp-cobranca.server.ts`) só lê,
 * chama estas funções e registra. O selo da conversa, numa onda seguinte, usa as mesmas.
 *
 * Nada aqui fala com a rede nem com o banco, e nada aqui escolhe destino: a cobrança só vai para o
 * grupo da equipe, e quem trava isso é o banco (`grupo_equipe_destino()`) e o servidor.
 */

import { FUSO, relogioLocal } from "@/domain/whatsapp/assistente";
import { primeiroNome } from "@/domain/whatsapp/equipe";
import { ehGrupoZapi, telefoneParaZapi } from "@/domain/whatsapp/zapi-envio";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Minutos úteis padrão (migração 20261112110000). Todos editáveis na tela. */
export const MIN_PEDIDO_PADRAO = 240;
export const MIN_ORCAMENTO_PADRAO = 120;
export const MIN_GESTOR_PADRAO = 240;
/** Faixa aceita nos três tempos (o CHECK do banco é o mesmo). */
export const MIN_MINUTOS = 30;
export const MAX_MINUTOS = 1440;
/** No máximo duas cobranças por pendência: nível 1 e nível 2. */
export const TETO_DE_COBRANCAS = 2;
/** Quatro ou mais vencendo na mesma rodada viram uma mensagem só, com a lista. */
export const MINIMO_PARA_AGRUPAR = 4;
export const ENDERECO_DO_SISTEMA = "https://bexprint.com.br";

/** O orçamento ligado conta como sinal quando nasceu até 2 h antes da abertura do atendimento. */
const FOLGA_ANTES_DA_ABERTURA_MS = 2 * 60 * 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
/** Guarda contra laço sem fim com data maluca: dez anos de dias. */
const MAXIMO_DE_DIAS = 3660;

/* ------------------------------------------------------------------ */
/* Horário útil (fuso America/Belem, o de Macapá, sem horário de verão) */
/* ------------------------------------------------------------------ */

export type HorarioUtil = {
  /** "08:00" */
  inicio: string;
  /** "18:00" */
  fim: string;
  /** Dias ISO de segunda a sexta que valem (1 = segunda … 5 = sexta). */
  dias: number[];
  /** Sábado de manhã conta? (`whatsapp_configuracoes.cobranca_sabado`) */
  sabado: boolean;
  /** Até que hora no sábado: "12:00" (`cobranca_sabado_fim`). Começa em `inicio`. */
  sabadoFim: string;
};

/** A linha de `whatsapp_configuracoes` que a cobrança lê (colunas da migração 20261112110000). */
export type LinhaDaConfiguracao = {
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];
  grupo_equipe_id: string | null;
  grupo_equipe_ativo: boolean;
  cobranca_modo: string;
  cobranca_min_pedido: number;
  cobranca_min_orcamento: number;
  cobranca_min_gestor: number;
  cobranca_sabado: boolean;
  cobranca_sabado_fim: string;
  cobranca_ligada_em: string | null;
  cobranca_ensaio_desde: string | null;
  /** resultado da última rodada (whatsapp_cobranca_rodada_gravar); só o cartão lê */
  cobranca_rodada_em?: string | null;
  cobranca_rodada_ok?: boolean | null;
  cobranca_rodada_erro?: string | null;
};

/** "08:00:00" (como o Postgres devolve time) ou "8:00" → minutos do dia; inválido → null. */
function minutosDoDia(hhmm: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || h * 60 + min > 24 * 60) return null;
  return h * 60 + min;
}

function hhmm(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** O horário da cobrança: o do WhatsApp (dias 1 a 5) mais o sábado da cobrança. Domingo nunca. */
export function horarioDaCobranca(
  linha: Pick<
    LinhaDaConfiguracao,
    "horario_inicio" | "horario_fim" | "dias_semana" | "cobranca_sabado" | "cobranca_sabado_fim"
  >,
): HorarioUtil {
  const ini = minutosDoDia(linha.horario_inicio) ?? 8 * 60;
  const fim = minutosDoDia(linha.horario_fim) ?? 18 * 60;
  const sabFim = minutosDoDia(linha.cobranca_sabado_fim) ?? 12 * 60;
  const dias = Array.from(
    new Set((linha.dias_semana ?? []).map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 5)),
  ).sort((a, b) => a - b);
  return {
    inicio: hhmm(ini),
    fim: hhmm(fim),
    dias,
    sabado: linha.cobranca_sabado === true,
    sabadoFim: hhmm(sabFim),
  };
}

/* ---------- relógio de Macapá com data (o `relogioLocal` do assistente só dá dia e minuto) ---------- */

type DiaLocal = { ano: number; mes: number; dia: number };

const FORMATO_LOCAL = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partesLocais(instante: number): DiaLocal & { hora: number; minuto: number; segundo: number } {
  const partes = FORMATO_LOCAL.formatToParts(new Date(instante));
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? "0");
  return { ano: v("year"), mes: v("month"), dia: v("day"), hora: v("hour"), minuto: v("minute"), segundo: v("second") };
}

/** Quanto o relógio de Macapá está à frente do UTC naquele instante, em ms (−3 h hoje). */
function deslocamentoMs(instante: number): number {
  const p = partesLocais(instante);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** O instante (ms) do minuto `minutoDoDia` do dia local `d` em Macapá. */
function instanteLocal(d: DiaLocal, minutoDoDia: number): number {
  const meioDia = Date.UTC(d.ano, d.mes - 1, d.dia, 12, 0, 0);
  return Date.UTC(d.ano, d.mes - 1, d.dia, 0, minutoDoDia, 0) - deslocamentoMs(meioDia);
}

function diaIsoDe(d: DiaLocal): number {
  const semana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
  return semana === 0 ? 7 : semana;
}

function diaSeguinte(d: DiaLocal): DiaLocal {
  const t = new Date(Date.UTC(d.ano, d.mes - 1, d.dia) + UM_DIA_MS);
  return { ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate() };
}

/** A janela de trabalho do dia ISO, em minutos do dia; null = o dia não conta. */
function janelaDoDia(diaIso: number, h: HorarioUtil): { de: number; ate: number } | null {
  const de = minutosDoDia(h.inicio);
  if (de === null) return null;
  if (diaIso === 7) return null;
  if (diaIso === 6) {
    if (!h.sabado) return null;
    const ate = minutosDoDia(h.sabadoFim);
    return ate !== null && ate > de ? { de, ate } : null;
  }
  if (!h.dias.includes(diaIso)) return null;
  const ate = minutosDoDia(h.fim);
  return ate !== null && ate > de ? { de, ate } : null;
}

/**
 * Minutos úteis entre dois instantes: soma, dia a dia no fuso de Macapá, a sobreposição de
 * [inicio, fim) com a janela de trabalho. Fora da janela o relógio para. Fim antes do início dá 0.
 * Feriados ficam de fora por ora.
 */
export function minutosUteisEntre(inicio: Date, fim: Date, horario: HorarioUtil): number {
  const a = inicio.getTime();
  const b = fim.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;

  let dia: DiaLocal = partesLocais(a);
  let somaMs = 0;
  for (let i = 0; i < MAXIMO_DE_DIAS; i++) {
    const comecoDoDia = instanteLocal(dia, 0);
    if (comecoDoDia >= b) break;
    const janela = janelaDoDia(diaIsoDe(dia), horario);
    if (janela) {
      const de = Math.max(a, instanteLocal(dia, janela.de));
      const ate = Math.min(b, instanteLocal(dia, janela.ate));
      if (ate > de) somaMs += ate - de;
    }
    dia = diaSeguinte(dia);
  }
  return Math.floor(somaMs / 60_000);
}

/** Agora está dentro da janela de trabalho? Fora dela nada sai. */
export function dentroDoHorarioUtil(agora: Date, horario: HorarioUtil): boolean {
  if (!Number.isFinite(agora.getTime())) return false;
  const { diaIso, minuto } = relogioLocal(agora);
  const janela = janelaDoDia(diaIso, horario);
  return janela !== null && minuto >= janela.de && minuto < janela.ate;
}

const NOME_DO_DIA: Record<number, string> = {
  1: "segunda",
  2: "terça",
  3: "quarta",
  4: "quinta",
  5: "sexta",
};

/** 480 → "8h"; 510 → "8h30". */
function horaPorExtenso(hora: string): string {
  const m = minutosDoDia(hora) ?? 0;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min ? `${h}h${String(min).padStart(2, "0")}` : `${h}h`;
}

function listaComE(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** "segunda a sexta, das 8h às 18h; sábado, das 8h às 12h" (sem travessão, sem seta). */
export function horarioPorExtenso(horario: HorarioUtil): string {
  const dias = Array.from(new Set(horario.dias.filter((d) => d >= 1 && d <= 5))).sort((a, b) => a - b);
  const seguidos = dias.length >= 3 && dias[dias.length - 1] - dias[0] === dias.length - 1;
  const nomes = seguidos
    ? `${NOME_DO_DIA[dias[0]]} a ${NOME_DO_DIA[dias[dias.length - 1]]}`
    : listaComE(dias.map((d) => NOME_DO_DIA[d]));
  const partes: string[] = [];
  if (dias.length) partes.push(`${nomes}, das ${horaPorExtenso(horario.inicio)} às ${horaPorExtenso(horario.fim)}`);
  if (horario.sabado && janelaDoDia(6, horario)) {
    partes.push(`sábado, das ${horaPorExtenso(horario.inicio)} às ${horaPorExtenso(horario.sabadoFim)}`);
  }
  return partes.length ? partes.join("; ") : "nenhum dia útil configurado";
}

/** Meia hora para baixo (nunca exagera); abaixo de 1 h, em minutos. */
function duracao(minutos: number): string {
  const m = Number.isFinite(minutos) ? Math.max(0, Math.floor(minutos)) : 0;
  if (m < 60) return `${m} min`;
  const horas = Math.floor(m / 30) / 2;
  return `${String(horas).replace(".", ",")} h`;
}

/** 240 → "4 h úteis"; 150 → "2,5 h úteis"; 45 → "45 min úteis". Vírgula decimal. */
export function horasUteis(minutos: number): string {
  return `${duracao(minutos)} úteis`;
}

/** 240 → "4 h"; 150 → "2,5 h"; 45 → "45 min". Para a tela, ao lado do campo em minutos. */
export function minutosEmHoras(minutos: number): string {
  return duracao(minutos);
}

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

export type ModoCobranca = "desligada" | "ensaio" | "ligada";

export type ConfigCobranca = {
  modo: ModoCobranca;
  minPedido: number;
  minOrcamento: number;
  minGestor: number;
  horario: HorarioUtil;
  /** Corte do modo ligada: só pedidos depois disto. */
  ligadaEm: Date | null;
  /** Corte do modo ensaio: só pedidos depois disto. */
  ensaioDesde: Date | null;
  /** Id do grupo, só quando ligado e no formato ^\d{10,}-group$. */
  grupoDestino: string | null;
};

function minutosDaConfig(valor: unknown, padrao: number): number {
  const n = Number(valor);
  if (valor === null || valor === undefined || !Number.isFinite(n)) return padrao;
  return Math.min(MAX_MINUTOS, Math.max(MIN_MINUTOS, Math.round(n)));
}

function dataOuNull(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Lê a linha do banco; modo desconhecido vira "desligada". */
export function configDaCobranca(linha: LinhaDaConfiguracao): ConfigCobranca {
  const modo: ModoCobranca =
    linha.cobranca_modo === "ensaio" || linha.cobranca_modo === "ligada" ? linha.cobranca_modo : "desligada";
  const grupo = (linha.grupo_equipe_id ?? "").trim();
  return {
    modo,
    minPedido: minutosDaConfig(linha.cobranca_min_pedido, MIN_PEDIDO_PADRAO),
    minOrcamento: minutosDaConfig(linha.cobranca_min_orcamento, MIN_ORCAMENTO_PADRAO),
    minGestor: minutosDaConfig(linha.cobranca_min_gestor, MIN_GESTOR_PADRAO),
    horario: horarioDaCobranca(linha),
    ligadaEm: dataOuNull(linha.cobranca_ligada_em),
    ensaioDesde: dataOuNull(linha.cobranca_ensaio_desde),
    grupoDestino: linha.grupo_equipe_ativo === true && ehGrupoZapi(grupo) ? grupo : null,
  };
}

/** O corte que vale para o modo atual (`ligadaEm` ou `ensaioDesde`); null quando desligada. */
export function corteDaCobranca(cfg: ConfigCobranca): Date | null {
  if (cfg.modo === "ligada") return cfg.ligadaEm;
  if (cfg.modo === "ensaio") return cfg.ensaioDesde;
  return null;
}

/* ------------------------------------------------------------------ */
/* A pendência (o que `whatsapp_cobranca_pendencias` devolve)          */
/* ------------------------------------------------------------------ */

export type StatusOrcamento = "rascunho" | "enviado" | "aprovado" | "rejeitado" | "expirado" | "convertido";

export type OrcamentoLigado = {
  id: string;
  numero: number;
  status: StatusOrcamento | string;
  criadoEm: Date;
  enviadoEm: Date | null;
  vendedorId: string | null;
};

export type CobrancaFeita = { nivel: 1 | 2; modo: "ensaio" | "ligada"; em: Date };

export type Pendencia = {
  atendimentoId: string;
  /** "WA-2611-0109" */
  numero: string;
  conversaId: string;
  abertoEm: Date;
  fechadoEm: Date | null;
  /** fila ATUAL da conversa: comercial, producao, financeiro, administrativo */
  fila: string;
  /** aberta, pendente, resolvida, arquivada */
  conversaStatus: string;
  /** responsável do atendimento */
  responsavelId: string | null;
  /**
   * responsável da conversa. Vem separado: o do atendimento pode ter saído da equipe, e então
   * vale o da conversa (um COALESCE no banco ficaria com o inativo e esconderia o ativo).
   */
  responsavelConversaId?: string | null;
  /** nome do cliente cadastrado, ou o nome do contato; nunca o telefone */
  clienteNome: string | null;
  /** 1ª mensagem do cliente no atendimento com a palavra-chave (lista do contrato) */
  pediuPorPalavraEm: Date | null;
  /** marca "Cliente pediu orçamento" posta por pessoa (`pediu_orcamento_em`) */
  pediuPorMarcaEm: Date | null;
  /** orçamentos com conversa_id da conversa, criados de 2 h antes da abertura em diante */
  orcamentos: OrcamentoLigado[];
  /**
   * Saídas na conversa (de 2 h antes da abertura em diante) com PDF de orçamento ou a frase
   * "Segue o orçamento nº". Para a cobrança só vale a que veio DEPOIS do pedido.
   */
  enviosNaConversa: Date[];
  dispensadoEm: Date | null;
  /** status do lead da conversa: "perdido" para a cobrança */
  leadStatus: string | null;
  cobrancas: CobrancaFeita[];
};

/* ------------------------------------------------------------------ */
/* A decisão                                                           */
/* ------------------------------------------------------------------ */

export type MotivoDaCobranca = "pedido_sem_orcamento" | "orcamento_parado";

export type MotivoDeNaoCobrar =
  | "desligada"
  | "fora_do_horario"
  | "atendimento_fechado"
  | "conversa_resolvida"
  | "dispensada"
  | "lead_perdido"
  | "sem_pedido"
  | "antes_do_corte"
  | "orcamento_enviado"
  | "orcamento_encerrado"
  | "enviado_na_conversa"
  | "transferida_sem_orcamento"
  | "teto"
  | "ainda_no_prazo";

export type DecisaoDeCobrar = {
  cobrar: true;
  nivel: 1 | 2;
  motivo: MotivoDaCobranca;
  /** minutos úteis que o texto diz: desde o pedido, ou desde a criação do orçamento parado */
  minutosUteis: number;
  /** o orçamento parado mais antigo (rascunho), ou null */
  orcamento: OrcamentoLigado | null;
  pedidoEm: Date;
};

export type DecisaoDeCobranca = DecisaoDeCobrar | { cobrar: false; motivo: MotivoDeNaoCobrar };

/** Status em que o orçamento já chegou ao cliente (ou passou disso): a cobrança para. */
const STATUS_JA_ENVIADO = new Set(["enviado", "aprovado", "convertido"]);
/** Status em que o orçamento acabou sem venda: também para. */
const STATUS_ENCERRADO = new Set(["rejeitado", "expirado"]);
const CONVERSA_ENCERRADA = new Set(["resolvida", "arquivada"]);

function valido(d: Date | null | undefined): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/** Orçamentos que contam como sinal de pedido: criados de 2 h antes da abertura em diante. */
function orcamentosDoAtendimento(p: Pendencia): OrcamentoLigado[] {
  const limite = p.abertoEm.getTime() - FOLGA_ANTES_DA_ABERTURA_MS;
  return p.orcamentos.filter((o) => valido(o.criadoEm) && o.criadoEm.getTime() >= limite);
}

/** O rascunho ligado mais antigo: é o "orçamento parado". */
function orcamentoParado(p: Pendencia): OrcamentoLigado | null {
  const rascunhos = p.orcamentos
    .filter((o) => o.status === "rascunho" && !valido(o.enviadoEm) && valido(o.criadoEm))
    .sort((x, y) => x.criadoEm.getTime() - y.criadoEm.getTime());
  return rascunhos[0] ?? null;
}

/**
 * O rascunho ligado mais antigo criado depois do último orçamento enviado ou encerrado, ou null
 * quando não há envio nem encerramento antes (o caso comum) ou nenhum rascunho veio depois.
 * Sem data de envio, o status enviado, aprovado ou convertido conta pela data de criação.
 */
function rascunhoDepoisDoUltimoFim(p: Pendencia): OrcamentoLigado | null {
  const fins: number[] = [];
  for (const o of p.orcamentos) {
    if (valido(o.enviadoEm)) fins.push(o.enviadoEm.getTime());
    else if ((STATUS_JA_ENVIADO.has(o.status) || STATUS_ENCERRADO.has(o.status)) && valido(o.criadoEm)) {
      fins.push(o.criadoEm.getTime());
    }
  }
  if (!fins.length) return null;
  const ultimo = Math.max(...fins);
  return (
    p.orcamentos
      .filter((o) => o.status === "rascunho" && !valido(o.enviadoEm) && valido(o.criadoEm) && o.criadoEm.getTime() > ultimo)
      .sort((x, y) => x.criadoEm.getTime() - y.criadoEm.getTime())[0] ?? null
  );
}

/** Quando o pedido começou: o primeiro sinal (palavra, marca, orçamento ligado criado). */
export function inicioDoPedido(p: Pendencia): Date | null {
  const sinais: Date[] = [];
  if (valido(p.pediuPorPalavraEm)) sinais.push(p.pediuPorPalavraEm);
  if (valido(p.pediuPorMarcaEm)) sinais.push(p.pediuPorMarcaEm);
  for (const o of orcamentosDoAtendimento(p)) sinais.push(o.criadoEm);
  if (!sinais.length) return null;
  return new Date(Math.min(...sinais.map((d) => d.getTime())));
}

/**
 * Cobra agora? Ordem das paradas e dos níveis no contrato (seção "decidirCobranca").
 * Só conta as cobranças feitas no MESMO modo da configuração.
 */
export function decidirCobranca(p: Pendencia, cfg: ConfigCobranca, agora: Date): DecisaoDeCobranca {
  const nao = (motivo: MotivoDeNaoCobrar): DecisaoDeCobranca => ({ cobrar: false, motivo });

  if (cfg.modo === "desligada") return nao("desligada");
  if (!dentroDoHorarioUtil(agora, cfg.horario)) return nao("fora_do_horario");
  if (valido(p.fechadoEm)) return nao("atendimento_fechado");
  if (CONVERSA_ENCERRADA.has(p.conversaStatus)) return nao("conversa_resolvida");
  if (valido(p.dispensadoEm)) return nao("dispensada");
  if (p.leadStatus === "perdido") return nao("lead_perdido");

  const pedidoEm = inicioDoPedido(p);
  if (!pedidoEm) return nao("sem_pedido");

  const corte = corteDaCobranca(cfg);
  if (!corte || pedidoEm.getTime() < corte.getTime()) return nao("antes_do_corte");

  // Orçamento que já saiu (status, ou data de envio gravada) para tudo; rejeitado ou expirado também.
  // Exceção: rascunho criado DEPOIS do último envio ou encerramento (pedido novo, revisão
  // esquecida). Esse é um orçamento parado novo e tem o próprio relógio de `minOrcamento`.
  const revisao = rascunhoDepoisDoUltimoFim(p);
  if (!revisao) {
    if (p.orcamentos.some((o) => STATUS_JA_ENVIADO.has(o.status) || valido(o.enviadoEm))) {
      return nao("orcamento_enviado");
    }
    if (p.orcamentos.some((o) => STATUS_ENCERRADO.has(o.status))) return nao("orcamento_encerrado");
  }

  // PDF orcamento-N.pdf ou "Segue o orçamento nº" mandado na conversa DEPOIS do pedido (na
  // revisão, depois do rascunho novo: o envio antigo não cala o que veio depois).
  const marcoDosEnvios = revisao ? Math.max(pedidoEm.getTime(), revisao.criadoEm.getTime()) : pedidoEm.getTime();
  if (p.enviosNaConversa.some((e) => valido(e) && e.getTime() >= marcoDosEnvios)) {
    return nao("enviado_na_conversa");
  }

  if (p.fila !== "comercial" && p.orcamentos.length === 0) return nao("transferida_sem_orcamento");

  const doModo = p.cobrancas.filter((c) => c.modo === cfg.modo);
  if (doModo.length >= TETO_DE_COBRANCAS) return nao("teto");

  const parado = revisao ?? orcamentoParado(p);
  const nivel1 = doModo.find((c) => c.nivel === 1);
  const nivel2 = doModo.find((c) => c.nivel === 2);

  if (!nivel1) {
    if (parado) {
      const desdeOrcamento = minutosUteisEntre(parado.criadoEm, agora, cfg.horario);
      if (desdeOrcamento >= cfg.minOrcamento) {
        return { cobrar: true, nivel: 1, motivo: "orcamento_parado", minutosUteis: desdeOrcamento, orcamento: parado, pedidoEm };
      }
    }
    // Na revisão o relógio é o do rascunho novo; o do pedido antigo já foi atendido.
    const desdePedido = minutosUteisEntre(pedidoEm, agora, cfg.horario);
    if (!revisao && desdePedido >= cfg.minPedido) {
      return { cobrar: true, nivel: 1, motivo: "pedido_sem_orcamento", minutosUteis: desdePedido, orcamento: parado, pedidoEm };
    }
    return nao("ainda_no_prazo");
  }

  if (!nivel2 && valido(nivel1.em) && minutosUteisEntre(nivel1.em, agora, cfg.horario) >= cfg.minGestor) {
    if (parado) {
      return {
        cobrar: true,
        nivel: 2,
        motivo: "orcamento_parado",
        minutosUteis: minutosUteisEntre(parado.criadoEm, agora, cfg.horario),
        orcamento: parado,
        pedidoEm,
      };
    }
    return {
      cobrar: true,
      nivel: 2,
      motivo: "pedido_sem_orcamento",
      minutosUteis: minutosUteisEntre(pedidoEm, agora, cfg.horario),
      orcamento: null,
      pedidoEm,
    };
  }

  return nao("ainda_no_prazo");
}

/* ------------------------------------------------------------------ */
/* Quem é citado                                                       */
/* ------------------------------------------------------------------ */

/** Pessoa ATIVA com papel que não é só parceiro (`whatsapp_cobranca_equipe`). */
export type PessoaDaEquipe = { id: string; nome: string; telefone: string | null; papeis: string[] };

export type Citado = {
  id: string;
  /** primeiro nome, para o texto e para a tela */
  nome: string;
  papel: "responsavel" | "vendedor" | "gerencia";
  /** "5596991234567" para o `mentioned`; null = sem telefone, vai só o nome */
  mencao: string | null;
};

/** Telefone da pessoa no formato do `mentioned` do Z-API (55 + DDD + número); null se não for celular. */
export function numeroParaMencao(telefone: string | null | undefined): string | null {
  const numero = telefoneParaZapi(telefone);
  return numero && /^55\d{11}$/.test(numero) ? numero : null;
}

const PAPEIS_DA_GERENCIA = new Set(["gestor", "admin"]);

/**
 * Nível 1: responsável e, com orçamento parado, o vendedor (sem repetir). Sem ninguém que ainda
 * esteja na equipe, a gerência. Nível 2: os mesmos e a gerência (gestor ou admin, ativo, com
 * telefone). Quem não está em `equipe` nunca é citado.
 */
export function quemCitar(p: Pendencia, d: DecisaoDeCobrar, equipe: PessoaDaEquipe[]): Citado[] {
  const porId = new Map(equipe.map((pessoa) => [pessoa.id, pessoa]));
  const citados: Citado[] = [];
  const ja = new Set<string>();
  const citar = (pessoa: PessoaDaEquipe, papel: Citado["papel"]) => {
    if (ja.has(pessoa.id)) return;
    ja.add(pessoa.id);
    citados.push({ id: pessoa.id, nome: primeiroNome(pessoa.nome), papel, mencao: numeroParaMencao(pessoa.telefone) });
  };

  // O primeiro dos dois responsáveis que ainda está na equipe: o do atendimento, depois o da conversa.
  const responsavel = [p.responsavelId, p.responsavelConversaId]
    .map((id) => (id ? porId.get(id) : undefined))
    .find((pessoa) => pessoa !== undefined);
  if (responsavel) citar(responsavel, "responsavel");
  const vendedorId = d.orcamento?.vendedorId ?? null;
  const vendedor = vendedorId ? porId.get(vendedorId) : undefined;
  if (vendedor) citar(vendedor, "vendedor");

  if (d.nivel === 2 || citados.length === 0) {
    for (const pessoa of equipe) {
      if (!pessoa.papeis?.some((papel) => PAPEIS_DA_GERENCIA.has(papel))) continue;
      if (!numeroParaMencao(pessoa.telefone)) continue;
      citar(pessoa, "gerencia");
    }
  }
  return citados;
}

/* ------------------------------------------------------------------ */
/* Texto e agrupamento                                                 */
/* ------------------------------------------------------------------ */

/** "https://bexprint.com.br/whatsapp?conversa=<id>" */
export function linkDaConversa(conversaId: string): string {
  return `${ENDERECO_DO_SISTEMA}/whatsapp?conversa=${encodeURIComponent(conversaId)}`;
}

/** Trecho com 8 ou mais dígitos, mesmo escrito com espaço, ponto, hífen, parênteses ou "+". */
const TRECHO_COM_NUMERO = /\+?\d[\d\s().-]*\d/g;

/** O nome do cliente sem telefone: sequência de 8 ou mais dígitos some; vazio vira "Sem nome". */
export function nomeSemTelefone(nome: string | null | undefined): string {
  const limpo = (nome ?? "")
    .replace(TRECHO_COM_NUMERO, (trecho) => ((trecho.match(/\d/g) ?? []).length >= 8 ? " " : trecho))
    // nada de travessão, seta, arroba (menção falsa) nem chaves de modelo no nome
    .replace(/[—–]/g, " ")
    .replace(/->|=>|[→⇒⟶➜➔←⇐]/g, " ")
    .replace(/[@{}]/g, " ")
    // parêntese que ficou vazio ou aberto depois de tirar o telefone: "João ( Silva"
    .replace(/\(\s*\)|\(\s+(?=\S)/g, " ")
    .replace(/\s+/g, " ")
    // espaço antes de pontuação e pontuação solta nas pontas (o modelo apagaria de qualquer jeito)
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/^[\s.,!?;:()·-]+|[\s,;:(·-]+$/g, "")
    .trim();
  return limpo.slice(0, 60).trim() || "Sem nome";
}

function mencaoOuNome(c: Citado): string {
  return c.mencao ? `@${c.mencao}` : c.nome;
}

function linhasDosCitados(citados: Citado[], comGerencia: boolean): string[] {
  const pessoas = citados.filter((c) => c.papel !== "gerencia");
  const gerencia = citados.filter((c) => c.papel === "gerencia");
  const linhas: string[] = [];
  const daGerencia = gerencia.length ? `Gerência: ${gerencia.map(mencaoOuNome).join(" ")}` : "";
  if (pessoas.length) {
    linhas.push(pessoas.map(mencaoOuNome).join(" "));
    if (comGerencia && daGerencia) linhas.push(daGerencia);
  } else {
    linhas.push(daGerencia ? `Sem responsável. ${daGerencia}` : "Sem responsável.");
  }
  return linhas;
}

function mencoesDe(citados: Citado[], ordem: Citado[] = citados): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const c of ordem) {
    if (!c.mencao || vistos.has(c.mencao)) continue;
    vistos.add(c.mencao);
    saida.push(c.mencao);
  }
  return saida;
}

/** Os citados na ordem em que o texto os mostra: pessoas primeiro, gerência depois. */
function naOrdemDoTexto(citados: Citado[]): Citado[] {
  return [...citados.filter((c) => c.papel !== "gerencia"), ...citados.filter((c) => c.papel === "gerencia")];
}

/** A mensagem de UMA pendência, no formato do contrato. Sem travessão, sem seta, sem telefone do cliente. */
export function textoDaCobranca(p: Pendencia, d: DecisaoDeCobrar, citados: Citado[]): string {
  const titulo = `⏰ Orçamento pendente · ${p.numero}${d.nivel === 2 ? " · 2ª cobrança" : ""}`;
  const situacao =
    d.motivo === "orcamento_parado" && d.orcamento
      ? `Orçamento nº ${d.orcamento.numero} criado há ${horasUteis(d.minutosUteis)} e ainda não foi enviado.`
      : `Pediu orçamento há ${horasUteis(d.minutosUteis)} e ainda não recebeu.`;
  return [
    titulo,
    `Cliente: ${nomeSemTelefone(p.clienteNome)}`,
    situacao,
    ...linhasDosCitados(citados, true),
    `Abrir: ${linkDaConversa(p.conversaId)}`,
  ].join("\n");
}

export type ItemDeCobranca = { pendencia: Pendencia; decisao: DecisaoDeCobrar; citados: Citado[] };

export type EnvioDeCobranca = {
  texto: string;
  /** números do `mentioned`, sem repetição, na ordem em que aparecem no texto */
  mencionar: string[];
  itens: ItemDeCobranca[];
  agrupada: boolean;
};

function linhaDaLista(i: number, item: ItemDeCobranca): string {
  const { pendencia: p, decisao: d } = item;
  const situacao =
    d.motivo === "orcamento_parado" && d.orcamento
      ? `orçamento nº ${d.orcamento.numero} parado há ${horasUteis(d.minutosUteis)}`
      : `pediu há ${horasUteis(d.minutosUteis)}`;
  const nivel = d.nivel === 2 ? " · 2ª cobrança" : "";
  return `${i + 1}. ${p.numero} · ${nomeSemTelefone(p.clienteNome)} · ${situacao}${nivel}`;
}

/** Menos de `minimo` itens: uma mensagem por item. `minimo` ou mais: UMA mensagem com a lista. */
export function agruparNaAbertura(itens: ItemDeCobranca[], minimo: number = MINIMO_PARA_AGRUPAR): EnvioDeCobranca[] {
  if (!itens.length) return [];
  if (itens.length < Math.max(1, minimo)) {
    return itens.map((item) => ({
      texto: textoDaCobranca(item.pendencia, item.decisao, item.citados),
      mencionar: mencoesDe(naOrdemDoTexto(item.citados)),
      itens: [item],
      agrupada: false,
    }));
  }

  const linhas: string[] = [`⏰ ${itens.length} orçamentos pendentes`];
  itens.forEach((item, i) => {
    linhas.push(linhaDaLista(i, item), linkDaConversa(item.pendencia.conversaId));
  });

  // Todas as pessoas sem repetir (a mesma pessoa pode ser responsável de várias pendências).
  const vistos = new Set<string>();
  const pessoas: Citado[] = [];
  const gerencia: Citado[] = [];
  for (const item of itens) {
    for (const c of item.citados) {
      if (c.papel === "gerencia") continue;
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      pessoas.push(c);
    }
  }
  for (const item of itens) {
    for (const c of item.citados) {
      if (c.papel !== "gerencia" || vistos.has(c.id)) continue;
      vistos.add(c.id);
      gerencia.push(c);
    }
  }
  const precisaGerencia = itens.some(
    (item) => item.decisao.nivel === 2 || !item.citados.some((c) => c.papel !== "gerencia"),
  );
  if (pessoas.length) linhas.push(pessoas.map(mencaoOuNome).join(" "));
  if (precisaGerencia && gerencia.length) linhas.push(`Gerência: ${gerencia.map(mencaoOuNome).join(" ")}`);

  const citadosNoTexto = precisaGerencia ? [...pessoas, ...gerencia] : pessoas;
  return [{ texto: linhas.join("\n"), mencionar: mencoesDe(citadosNoTexto), itens, agrupada: true }];
}

/*
 * A chave de idempotência da `notificacoes_fila` NÃO é montada aqui: quem monta é a função do
 * banco `whatsapp_cobranca_registrar` ("cobranca_orcamento:<atendimento>:<nivel>", e
 * "cobranca_orcamento:lista:<md5>" para a mensagem agrupada). Uma chave só, num lugar só.
 */
