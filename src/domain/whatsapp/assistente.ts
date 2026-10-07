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
 * pedido de transferência ou resposta que cita valor/data que não está nos
 * dados do banco viram TRANSFERÊNCIA para a equipe, com o motivo gravado.
 */

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
  if (!dentroDoHorario(config, agora)) return { age: true, responde: false, motivo: "fora_do_horario" };
  return { age: true, responde: true };
}

/* ------------------------------------------------------------------ */
/* O que vai para a IA                                                 */
/* ------------------------------------------------------------------ */

export type OrcamentoNoContexto = {
  numero: number;
  titulo: string | null;
  status: string;
  /** Só de orçamento que JÁ FOI para o cliente (enviado, aprovado, convertido). */
  valor: string | null;
  validade: string | null;
};

export type OsNoContexto = { numero: number; titulo: string | null; etapa: string; prazo: string | null };

export type ContextoDaConversa = {
  cliente: string | null;
  orcamentos: OrcamentoNoContexto[];
  os: OsNoContexto[];
  historico: { de: "cliente" | "grafica"; texto: string }[];
  grafica: { endereco: string | null; horario: string | null };
};

/** Status em que o valor do orçamento já é do cliente — rascunho não é. */
const ORCAMENTO_COM_VALOR_PUBLICO = new Set(["enviado", "aprovado", "convertido"]);

const ROTULO_ORCAMENTO: Record<string, string> = {
  rascunho: "em preparação",
  enviado: "enviado, aguardando aprovação",
  aprovado: "aprovado",
  rejeitado: "recusado",
  expirado: "vencido",
  convertido: "aprovado e virou ordem de serviço",
};

export function reais(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dataBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Data pura (prazo_entrega é `date`): sem fuso, senão 07/10 vira 06/10.
  const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (so) return `${so[3]}/${so[2]}/${so[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function orcamentoParaContexto(o: {
  numero: number;
  titulo: string | null;
  status: string;
  valor_total: number | null;
  validade_dias: number | null;
  enviado_em: string | null;
  created_at: string;
}): OrcamentoNoContexto {
  const publico = ORCAMENTO_COM_VALOR_PUBLICO.has(o.status);
  let validade: string | null = null;
  if (publico && o.validade_dias && o.status === "enviado") {
    const base = new Date(o.enviado_em ?? o.created_at);
    if (!Number.isNaN(base.getTime())) {
      validade = dataBR(new Date(base.getTime() + o.validade_dias * 86_400_000).toISOString());
    }
  }
  return {
    numero: o.numero,
    titulo: o.titulo,
    status: ROTULO_ORCAMENTO[o.status] ?? o.status,
    valor: publico && o.valor_total != null ? reais(Number(o.valor_total)) : null,
    validade,
  };
}

const INSTRUCOES = (assinatura: string) =>
  [
    `Você é "${assinatura}", a assistente virtual da Bex Print, gráfica e comunicação visual em Macapá (AP).`,
    "Você conversa pelo WhatsApp com clientes. Escreva em português do Brasil, curto (até 3 frases), cordial, sem gírias e sem emojis em excesso.",
    "Use SOMENTE os dados do bloco DADOS. Nunca invente preço, valor, prazo, data, desconto, condição de pagamento ou disponibilidade.",
    "Você PODE: cumprimentar; dizer a situação de um orçamento ou de uma ordem de serviço que está nos DADOS (com o valor e o prazo exatamente como aparecem lá); informar endereço e horário da gráfica se estiverem nos DADOS; pedir o que falta para um orçamento (produto, medidas, quantidade, se a arte está pronta).",
    "Você NÃO PODE: falar de pagamento, Pix, boleto, parcelamento ou desconto; prometer prazo; dar preço de algo que não está nos DADOS.",
    "Escolha acao='transferir' quando: o cliente pede para falar com uma pessoa; demonstra irritação ou reclamação; o pedido de orçamento já tem produto, medida e quantidade (a equipe precisa orçar); o assunto é financeiro; ou você não tem certeza.",
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
  };
  const historico = contexto.historico
    .map((h) => `${h.de === "cliente" ? "Cliente" : "Bex Print"}: ${h.texto}`)
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

const PALAVRAS_PROIBIDAS = /\b(desconto|pix|boleto|parcel\w*|cart[aã]o de cr[eé]dito|cart[aã]o de d[eé]bito|juros|nota fiscal)\b/i;

function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Valores em reais e datas que a resposta PODE citar: os do contexto. */
export function permitidos(contexto: ContextoDaConversa): { valores: Set<string>; datas: Set<string> } {
  const valores = new Set<string>();
  const datas = new Set<string>();
  for (const o of contexto.orcamentos) {
    if (o.valor) valores.add(soDigitos(o.valor));
    if (o.validade) datas.add(o.validade);
  }
  for (const s of contexto.os) if (s.prazo) datas.add(s.prazo);
  const comAno = [...datas];
  for (const d of comAno) datas.add(d.slice(0, 5)); // "07/10" também vale
  return { valores, datas };
}

/**
 * A resposta pode sair? `null` = pode; senão, o motivo da transferência.
 * Valor em R$ ou data que não estão nos DADOS é invenção — não sai.
 */
export function motivoParaBarrar(resposta: string, contexto: ContextoDaConversa): string | null {
  const texto = resposta.trim();
  if (!texto) return "a assistente não escreveu resposta";
  if (PALAVRAS_PROIBIDAS.test(texto)) return "a resposta tocava em pagamento ou desconto";
  const { valores, datas } = permitidos(contexto);
  for (const m of texto.matchAll(/R\$\s*\d[\d.]*(?:,\d{1,2})?/g)) {
    if (!valores.has(soDigitos(m[0]))) return `a resposta citava um valor (${m[0].trim()}) que não está no sistema`;
  }
  for (const m of texto.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) {
    const [d, mes, ano] = m[0].split("/");
    const norm = `${d.padStart(2, "0")}/${mes.padStart(2, "0")}${ano ? `/${ano.length === 2 ? `20${ano}` : ano}` : ""}`;
    if (!datas.has(norm)) return `a resposta citava uma data (${m[0]}) que não está no sistema`;
  }
  return null;
}

export type Acao =
  | { tipo: "responder"; texto: string }
  | { tipo: "transferir"; motivo: string };

/** A decisão final, com as travas aplicadas por cima do que a IA quis. */
export function decidirAcao(d: DecisaoDaIa, contexto: ContextoDaConversa): Acao {
  if (d.intencao === "financeiro") return { tipo: "transferir", motivo: "assunto financeiro" };
  if (d.acao === "transferir") {
    return { tipo: "transferir", motivo: d.motivo_transferencia || "a assistente pediu ajuda da equipe" };
  }
  if (d.confianca < CONFIANCA_MINIMA) {
    return { tipo: "transferir", motivo: `confiança baixa (${Math.round(d.confianca * 100)}%)` };
  }
  const barrar = motivoParaBarrar(d.resposta, contexto);
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
