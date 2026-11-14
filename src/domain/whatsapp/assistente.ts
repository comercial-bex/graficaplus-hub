/**
 * A assistente de IA da caixa de entrada ("Bex Print · assistente"), em regras
 * puras — o servidor (`whatsapp-assistente.server.ts`) só lê, chama a IA e
 * grava pelo que este arquivo decide. Pedido do dono em 07/10/2026.
 *
 * PORTÕES, nesta ordem (`portaoDoAssistente`):
 *   1. `whatsapp_configuracoes.ia_ativa` ligado — nasce DESLIGADO;
 *   2. mensagem de ENTRADA de gente (modelo de empresa entra com origem
 *      'automacao' e não chama ninguém);
 *   3. conversa em modo 'auto' e SEM responsável — gente atendendo, a
 *      assistente não se mete;
 * e, passados os três, ela sempre classifica. Responder ainda depende de:
 *   4. não ter respondido nesta conversa nos últimos 30 s (rajada);
 *   5. haver texto (mídia sozinha só classifica);
 *   6. estar no horário comercial — fora dele vai UM aviso por atendimento.
 *
 * DEPOIS DA IA (`decidirAcao`): ela pode errar, então a resposta só sai se
 * passar pelas travas daqui. Assunto financeiro, confiança abaixo de 0,6,
 * pedido de transferência ou resposta reprovada pelo verificador único
 * (`triagem/verificador.ts`, ramo cliente final, a lista mais estrita) viram
 * TRANSFERÊNCIA para a equipe, com o motivo gravado.
 *
 * REGRA DO DONO (C1, 14/11/2026): a assistente NUNCA cita preço, validade, prazo,
 * data nem faz orçamento. O objetivo dela é entender o que o contato precisa e dar
 * uma expectativa de produtos; preço e prazo são da equipe. Por isso o contexto que
 * a IA enxerga não traz valor nem data (`permitidos` é vazio por construção), e
 * TODO texto que sai (resposta, aviso fora do horário, frase de transferência) passa
 * por `verificarSaida` já montado, com a assinatura.
 */

import { verificarTexto, type RegraDoBanco } from "./triagem/verificador";

export const ASSINATURA_PADRAO = "Bex Print · assistente";
export const FRASE_DE_TRANSFERENCIA = "Vou chamar alguém da equipe para continuar com você.";
export const INTERVALO_MINIMO_MS = 30_000;
export const CONFIANCA_MINIMA = 0.6;
export const FUSO = "America/Belem";

export type ConfigAssistente = {
  ia_ativa: boolean;
  horario_inicio: string; // "08:00:00"
  horario_fim: string; // "18:00:00"
  /** Dias ISO: 1 = segunda … 7 = domingo. */
  dias_semana: number[];
  mensagem_fora_horario: string;
  assinatura: string;
  endereco: string | null;
  horario_texto: string | null;
};

export const CONFIG_PADRAO: ConfigAssistente = {
  ia_ativa: false,
  horario_inicio: "08:00:00",
  horario_fim: "18:00:00",
  dias_semana: [1, 2, 3, 4, 5],
  mensagem_fora_horario:
    "Olá! Recebemos sua mensagem fora do horário de atendimento. Assim que abrirmos, alguém da equipe responde você.",
  assinatura: ASSINATURA_PADRAO,
  endereco: null,
  horario_texto: null,
};

/* ------------------------------------------------------------------ */
/* Horário comercial (no fuso de Macapá)                               */
/* ------------------------------------------------------------------ */

const DIA_ISO: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function minutosDoDia(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Dia ISO e minuto do dia em Macapá. */
export function relogioLocal(agora: Date): { diaIso: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { diaIso: DIA_ISO[v("weekday")] ?? 1, minuto: Number(v("hour")) * 60 + Number(v("minute")) };
}

export function dentroDoHorario(c: Pick<ConfigAssistente, "horario_inicio" | "horario_fim" | "dias_semana">, agora: Date): boolean {
  const { diaIso, minuto } = relogioLocal(agora);
  if (!(c.dias_semana ?? []).includes(diaIso)) return false;
  const ini = minutosDoDia(c.horario_inicio);
  const fim = minutosDoDia(c.horario_fim);
  return minuto >= ini && minuto < fim;
}

/* ------------------------------------------------------------------ */
/* Portões                                                             */
/* ------------------------------------------------------------------ */

export type ConversaParaAssistente = {
  modo: "auto" | "humano" | string;
  responsavel_id: string | null;
  status: string;
};

export type MensagemParaAssistente = {
  direcao: "entrada" | "saida" | string;
  origem: string | null;
  tipo: string;
  texto: string | null;
  legenda: string | null;
};

export type MotivoDeFicarQuieta =
  | "ia_desligada"
  | "nao_e_entrada"
  | "mensagem_automatica"
  | "conversa_arquivada"
  | "com_responsavel"
  | "modo_humano";

export type MotivoDeSoClassificar = "rajada" | "so_midia" | "fora_do_horario";

export type Portao =
  | { age: false; motivo: MotivoDeFicarQuieta }
  | { age: true; responde: true }
  | { age: true; responde: false; motivo: MotivoDeSoClassificar };

export function textoDaMensagem(m: Pick<MensagemParaAssistente, "texto" | "legenda">): string {
  return (m.texto ?? m.legenda ?? "").trim();
}

export function portaoDoAssistente(e: {
  config: Pick<ConfigAssistente, "ia_ativa" | "horario_inicio" | "horario_fim" | "dias_semana">;
  conversa: ConversaParaAssistente;
  mensagem: MensagemParaAssistente;
  /** Quando a assistente respondeu pela última vez nesta conversa. */
  ultimaRespostaIaEm: string | null;
  agora: Date;
  /**
   * O horário já decidido pela função única do banco (`whatsapp_dentro_do_horario`). Quando vem, vale ele; sem ele
   * (leitura falhou), vale a conta antiga sobre as colunas de `whatsapp_configuracoes`.
   */
  dentroDoHorario?: boolean;
}): Portao {
  const { config, conversa, mensagem, agora } = e;
  if (!config.ia_ativa) return { age: false, motivo: "ia_desligada" };
  if (mensagem.direcao !== "entrada") return { age: false, motivo: "nao_e_entrada" };
  if (mensagem.origem === "automacao") return { age: false, motivo: "mensagem_automatica" };
  if (conversa.status === "arquivada") return { age: false, motivo: "conversa_arquivada" };
  if (conversa.responsavel_id) return { age: false, motivo: "com_responsavel" };
  if (conversa.modo !== "auto") return { age: false, motivo: "modo_humano" };

  if (e.ultimaRespostaIaEm) {
    const passou = agora.getTime() - new Date(e.ultimaRespostaIaEm).getTime();
    if (passou >= 0 && passou < INTERVALO_MINIMO_MS) return { age: true, responde: false, motivo: "rajada" };
  }
  if (!textoDaMensagem(mensagem)) return { age: true, responde: false, motivo: "so_midia" };
  if (!(e.dentroDoHorario ?? dentroDoHorario(config, agora))) return { age: true, responde: false, motivo: "fora_do_horario" };
  return { age: true, responde: true };
}

/* ------------------------------------------------------------------ */
/* O que vai para a IA                                                 */
/* ------------------------------------------------------------------ */

/** Só a situação: valor, validade e prazo NÃO vão para a IA (regra do dono, C1). */
export type OrcamentoNoContexto = {
  numero: number;
  titulo: string | null;
  status: string;
};

export type OsNoContexto = { numero: number; titulo: string | null; etapa: string };

export type ContextoDaConversa = {
  cliente: string | null;
  orcamentos: OrcamentoNoContexto[];
  os: OsNoContexto[];
  historico: { de: "cliente" | "grafica"; texto: string }[];
  grafica: { endereco: string | null; horario: string | null };
  /** O roteiro dos produtos de que a conversa fala (`roteirosDaConversa`). */
  roteiros?: RoteiroNoContexto[];
};

export type RoteiroNoContexto = { produto: string; como_medir: string | null; perguntas: string | null };

const PALAVRAS_VAZIAS = new Set(["para", "com", "por", "sem", "dos", "das", "impressa", "impresso", "personalizada", "personalizado"]);

function palavrasDe(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p));
}

/**
 * Até 3 roteiros, dos produtos cujo nome aparece na conversa. Mandar os 55 a cada
 * mensagem gastaria saldo à toa, e a IA só precisa do produto de que se fala.
 */
export function roteirosDaConversa(
  conversa: string,
  roteiros: (RoteiroNoContexto & { nome: string })[],
  limite = 3,
): RoteiroNoContexto[] {
  const falado = new Set(palavrasDe(conversa));
  return roteiros
    .map((r) => {
      const nome = palavrasDe(r.nome);
      return { r, pontos: nome.filter((p) => falado.has(p)).length };
    })
    .filter((x) => x.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos || a.r.nome.localeCompare(b.r.nome))
    .slice(0, limite)
    .map(({ r }) => ({ produto: r.produto, como_medir: r.como_medir, perguntas: r.perguntas }));
}

const ROTULO_ORCAMENTO: Record<string, string> = {
  rascunho: "em preparação",
  enviado: "enviado, aguardando aprovação",
  aprovado: "aprovado",
  rejeitado: "recusado",
  expirado: "vencido",
  convertido: "aprovado e virou ordem de serviço",
};

/**
 * O título é digitado pela equipe e pode ter preço ou data ("Banner R$ 50", "entrega sexta"). Título que o verificador
 * reprova não vai para a IA.
 */
export function tituloSeguro(titulo: string | null | undefined): string | null {
  const t = (titulo ?? "").trim();
  if (!t) return null;
  return verificarTexto(t, "cliente").problemas.some((p) => p.regra !== "acima_de_600_caracteres") ? null : t.slice(0, 120);
}

export function orcamentoParaContexto(o: { numero: number; titulo: string | null; status: string }): OrcamentoNoContexto {
  return { numero: o.numero, titulo: tituloSeguro(o.titulo), status: ROTULO_ORCAMENTO[o.status] ?? o.status };
}

export function osParaContexto(o: { numero: number; titulo: string | null; etapa: string }): OsNoContexto {
  return { numero: o.numero, titulo: tituloSeguro(o.titulo), etapa: o.etapa };
}

const INSTRUCOES = (assinatura: string) =>
  [
    `Você é "${assinatura}", a assistente virtual da Bex Print, gráfica e comunicação visual em Macapá (AP).`,
    "Você conversa pelo WhatsApp com clientes. Escreva em português do Brasil, curto (até 3 frases), cordial, sem gírias e sem emojis em excesso.",
    "Escreva sem travessão, sem setas e sem parênteses.",
    "Seu objetivo é entender o que o contato precisa e dar uma expectativa do que a Bex Print faz, falando dos produtos. Quem passa preço, prazo e orçamento é sempre a equipe.",
    "Use SOMENTE os dados do bloco DADOS. Nunca invente nada.",
    "NUNCA escreva valor, preço, orçamento fechado, prazo, data, dia da semana de entrega, validade, garantia, desconto, promoção, condição ou forma de pagamento, nem número que pareça isso. Se o contato perguntar, diga só que a equipe confirma isso com tudo certinho para o pedido, e siga com a pergunta de que você precisa.",
    "NUNCA pergunte se a pessoa é parceira, cliente final ou de qualquer outro tipo, e nunca fale de tabela, desconto ou preço.",
    "Você PODE: cumprimentar; dizer a situação de um orçamento ou de uma ordem de serviço que está nos DADOS, só pela etapa (sem valor e sem prazo); informar endereço e horário da gráfica se estiverem nos DADOS; descobrir o que falta para a equipe atender (produto, medidas, quantidade, se a arte está pronta).",
    "Se o bloco DADOS trouxer roteiros de produto, use-os para escolher o que perguntar ao cliente, uma ou duas perguntas por vez. Eles nunca autorizam falar de preço ou prazo.",
    "Escolha acao='transferir' quando: o cliente pede para falar com uma pessoa; demonstra irritação ou reclamação; o pedido já tem produto, medida e quantidade (a equipe precisa atender); o assunto é financeiro; ou você não tem certeza.",
    "Classifique a intenção: orcamento (quer preço ou pedir um serviço), acompanhamento_os (pergunta de pedido em andamento), financeiro (pagamento, nota, boleto), administrativo (fornecedor, currículo, outros assuntos da empresa) ou outro.",
    "fila_sugerida: comercial para orçamento e outro; producao para acompanhamento_os; financeiro para financeiro; administrativo para administrativo.",
    "confianca: de 0 a 1, o quanto você tem certeza de que a resposta está certa e completa só com os DADOS.",
  ].join("\n");

export const FERRAMENTA_DO_ASSISTENTE = {
  type: "function" as const,
  function: {
    name: "decidir_atendimento",
    description: "Classifica a mensagem do cliente e decide se a assistente responde ou passa para a equipe.",
    parameters: {
      type: "object",
      properties: {
        intencao: {
          type: "string",
          enum: ["orcamento", "acompanhamento_os", "financeiro", "administrativo", "outro"],
        },
        urgencia: { type: "string", enum: ["baixa", "normal", "alta"] },
        resumo: { type: "string", description: "O que o cliente quer, em até 20 palavras." },
        fila_sugerida: { type: "string", enum: ["comercial", "producao", "financeiro", "administrativo"] },
        confianca: { type: "number", minimum: 0, maximum: 1 },
        acao: { type: "string", enum: ["responder", "transferir"] },
        resposta: { type: "string", description: "O texto para o cliente quando acao='responder'." },
        motivo_transferencia: { type: "string", description: "Por que a equipe precisa assumir." },
      },
      required: ["intencao", "urgencia", "resumo", "fila_sugerida", "confianca", "acao"],
    },
  },
};

export function montarPergunta(
  contexto: ContextoDaConversa,
  mensagem: string,
  assinatura: string,
): { role: "system" | "user"; content: string }[] {
  const dados = {
    cliente: contexto.cliente ?? "não identificado",
    orcamentos: contexto.orcamentos,
    ordens_de_servico: contexto.os,
    grafica: contexto.grafica,
    ...(contexto.roteiros && contexto.roteiros.length > 0 ? { roteiros_de_produto: contexto.roteiros } : {}),
  };
  // Fala da equipe com preço, prazo ou data não vai para a IA: ela copiaria. A do cliente vai como está (a saída é verificada).
  const historico = contexto.historico
    .map((h) => {
      const omitir = h.de === "grafica" && !verificarTexto(h.texto, "cliente").ok;
      return `${h.de === "cliente" ? "Cliente" : "Bex Print"}: ${omitir ? "[mensagem da equipe omitida]" : h.texto}`;
    })
    .join("\n");
  return [
    { role: "system", content: INSTRUCOES(assinatura) },
    {
      role: "user",
      content: [
        "DADOS:",
        JSON.stringify(dados),
        "",
        "CONVERSA ATÉ AGORA (mais antiga primeiro):",
        historico || "(nenhuma)",
        "",
        "MENSAGEM NOVA DO CLIENTE:",
        mensagem,
      ].join("\n"),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* O que volta da IA                                                   */
/* ------------------------------------------------------------------ */

export type Intencao = "orcamento" | "acompanhamento_os" | "financeiro" | "administrativo" | "outro";

export type DecisaoDaIa = {
  intencao: Intencao;
  urgencia: "baixa" | "normal" | "alta";
  resumo: string;
  fila_sugerida: "comercial" | "producao" | "financeiro" | "administrativo";
  confianca: number;
  acao: "responder" | "transferir";
  resposta: string;
  motivo_transferencia: string;
};

const INTENCOES = ["orcamento", "acompanhamento_os", "financeiro", "administrativo", "outro"];
const FILAS = ["comercial", "producao", "financeiro", "administrativo"];

/** Lê os argumentos da ferramenta; `null` se vierem fora do combinado. */
export function interpretarDecisao(argumentos: unknown): DecisaoDaIa | null {
  let a: Record<string, unknown>;
  try {
    a = (typeof argumentos === "string" ? JSON.parse(argumentos) : argumentos) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!a || typeof a !== "object") return null;
  const intencao = INTENCOES.includes(String(a.intencao)) ? (a.intencao as Intencao) : null;
  const fila = FILAS.includes(String(a.fila_sugerida)) ? (a.fila_sugerida as DecisaoDaIa["fila_sugerida"]) : null;
  const acao = a.acao === "responder" || a.acao === "transferir" ? a.acao : null;
  const confianca = typeof a.confianca === "number" ? a.confianca : Number(a.confianca);
  if (!intencao || !fila || !acao || !Number.isFinite(confianca)) return null;
  const urgencia = a.urgencia === "baixa" || a.urgencia === "alta" ? a.urgencia : "normal";
  const limpar = (v: unknown, max: number) =>
    typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim().slice(0, max) : "";
  return {
    intencao,
    urgencia,
    resumo: limpar(a.resumo, 200),
    fila_sugerida: fila,
    confianca: Math.min(1, Math.max(0, confianca)),
    acao,
    resposta: limpar(a.resposta, 1200),
    motivo_transferencia: limpar(a.motivo_transferencia, 200),
  };
}

/* ------------------------------------------------------------------ */
/* As travas depois da IA                                              */
/* ------------------------------------------------------------------ */

/**
 * Valores e datas que a resposta PODE citar: nenhum. A assistente não fala preço nem data, e o contexto não os traz
 * (C1). Fica a função, com o mesmo formato, para quem já a chama.
 */
export function permitidos(_contexto?: ContextoDaConversa): { valores: Set<string>; datas: Set<string> } {
  return { valores: new Set<string>(), datas: new Set<string>() };
}

/**
 * Passa o texto JÁ MONTADO pelo verificador único, no ramo cliente final (a lista mais estrita). `extras` é a lista
 * que o dono acrescentou na tabela `whatsapp_triagem_termos_proibidos`. Devolve só os NOMES das regras: o texto
 * reprovado nunca vai para log nem para motivo.
 */
export function verificarSaida(texto: string, extras: readonly RegraDoBanco[] = []): string[] {
  return [...new Set(verificarTexto(texto, "cliente", extras).problemas.map((p) => p.regra))];
}

export function motivoDeTextoReprovado(regras: readonly string[]): string {
  return `texto reprovado pelo verificador: ${regras.join(", ")}`;
}

/**
 * A resposta pode sair? `null` = pode; senão, o motivo da transferência (com o nome das regras, nunca o trecho).
 */
export function motivoParaBarrar(
  resposta: string,
  _contexto?: ContextoDaConversa,
  extras: readonly RegraDoBanco[] = [],
): string | null {
  const texto = resposta.trim();
  if (!texto) return "a assistente não escreveu resposta";
  const regras = verificarSaida(texto, extras);
  return regras.length > 0 ? motivoDeTextoReprovado(regras) : null;
}

export type Acao =
  | { tipo: "responder"; texto: string }
  | { tipo: "transferir"; motivo: string };

/** A decisão final, com as travas aplicadas por cima do que a IA quis. */
export function decidirAcao(
  d: DecisaoDaIa,
  contexto: ContextoDaConversa,
  extras: readonly RegraDoBanco[] = [],
): Acao {
  if (d.intencao === "financeiro") return { tipo: "transferir", motivo: "assunto financeiro" };
  if (d.acao === "transferir") {
    return { tipo: "transferir", motivo: d.motivo_transferencia || "a assistente pediu ajuda da equipe" };
  }
  if (d.confianca < CONFIANCA_MINIMA) {
    return { tipo: "transferir", motivo: `confiança baixa (${Math.round(d.confianca * 100)}%)` };
  }
  const barrar = motivoParaBarrar(d.resposta, contexto, extras);
  if (barrar) return { tipo: "transferir", motivo: barrar };
  return { tipo: "responder", texto: d.resposta };
}

/** O texto que vai ao WhatsApp: assinatura em negrito, depois a mensagem. */
export function comAssinatura(texto: string, assinatura: string): string {
  const a = (assinatura || ASSINATURA_PADRAO).trim();
  return `*${a}*\n${texto.trim()}`;
}

/** Rótulos do painel "Decisões do assistente". */
export const ROTULO_INTENCAO: Record<string, string> = {
  orcamento: "Orçamento",
  acompanhamento_os: "Acompanhamento de OS",
  financeiro: "Financeiro",
  administrativo: "Administrativo",
  outro: "Outro",
};

export const ROTULO_SO_CLASSIFICAR: Record<MotivoDeSoClassificar, string> = {
  rajada: "respondeu há menos de 30 s",
  so_midia: "só mídia, sem texto",
  fora_do_horario: "fora do horário",
};

/** Na tela o nome já está no topo do balão: tira a linha da assinatura. */
export function semAssinatura(texto: string): string {
  return texto.replace(/^\*[^*\n]{1,80}\*\n/, "");
}
