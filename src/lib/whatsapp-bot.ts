export type WhatsAppBotState =
  | "inicio"
  | "orcamento"
  | "acompanhar_pedido"
  | "enviar_arquivo"
  | "pagamento"
  | "agendar_retirada"
  | "atendimento_humano";

export type WhatsAppBotIntent = Exclude<WhatsAppBotState, "inicio">;

export type WhatsAppBotTransition = {
  state: WhatsAppBotState;
  intent: WhatsAppBotIntent;
  humanHandoff: boolean;
  reply: string;
  quickReplies: string[];
};

const humanHandoffPatterns = [
  /\batendente\b/i,
  /\bhumano\b/i,
  /\bsuporte\b/i,
  /\bpessoa\b/i,
  /falar\s+com\s+algu[eé]m/i,
];

const intentMatchers: Array<{ intent: WhatsAppBotIntent; patterns: RegExp[] }> = [
  { intent: "orcamento", patterns: [/or[çc]amento/i, /pre[çc]o/i, /valor/i, /cot[aá]?[çc][aã]o/i] },
  {
    intent: "acompanhar_pedido",
    patterns: [/acompanhar/i, /pedido/i, /status/i, /os\b/i, /ordem/i],
  },
  { intent: "enviar_arquivo", patterns: [/arquivo/i, /arte/i, /anexo/i, /layout/i, /enviar/i] },
  { intent: "pagamento", patterns: [/pagamento/i, /pagar/i, /pix/i, /boleto/i, /comprovante/i] },
  {
    intent: "agendar_retirada",
    patterns: [/retirada/i, /retirar/i, /buscar/i, /agenda/i, /hor[aá]rio/i],
  },
];

const botReplies: Record<
  WhatsAppBotState,
  Omit<WhatsAppBotTransition, "state" | "intent" | "humanHandoff">
> = {
  inicio: {
    reply: "Olá! Sou o assistente da BEX PRINT OS. Escolha uma opção para eu te ajudar.",
    quickReplies: [
      "Fazer orçamento",
      "Acompanhar pedido",
      "Enviar arquivo",
      "Pagamento",
      "Agendar retirada",
      "Falar com atendente",
    ],
  },
  orcamento: {
    reply:
      "Vamos fazer seu orçamento. Me envie produto, medidas, quantidade, acabamento, prazo desejado e cidade de entrega/retirada.",
    quickReplies: ["Enviar arquivo", "Falar com atendente"],
  },
  acompanhar_pedido: {
    reply: "Para acompanhar seu pedido, informe o número da OS ou o CPF/CNPJ usado no cadastro.",
    quickReplies: ["Enviar comprovante", "Agendar retirada", "Falar com atendente"],
  },
  enviar_arquivo: {
    reply:
      "Pode enviar o arquivo por aqui ou por link. Informe também o número do orçamento/OS para vinculamos ao pedido correto.",
    quickReplies: ["Acompanhar pedido", "Falar com atendente"],
  },
  pagamento: {
    reply:
      "Para pagamento, posso te orientar sobre PIX, boleto ou envio de comprovante. Se já pagou, envie o comprovante e a OS.",
    quickReplies: ["Enviar comprovante", "Acompanhar pedido", "Falar com atendente"],
  },
  agendar_retirada: {
    reply: "Vamos agendar a retirada. Informe a OS, melhor dia/horário e nome de quem vai retirar.",
    quickReplies: ["Acompanhar pedido", "Falar com atendente"],
  },
  atendimento_humano: {
    reply:
      "Certo, vou transferir você para um atendente humano. Enquanto isso, deixe uma breve descrição do que precisa.",
    quickReplies: ["Aguardar atendente"],
  },
};

export function detectsHumanHandoff(message: string) {
  return humanHandoffPatterns.some((pattern) => pattern.test(message));
}

export function getWhatsAppBotTransition(
  message: string,
  currentState: WhatsAppBotState = "inicio",
): WhatsAppBotTransition {
  if (detectsHumanHandoff(message)) {
    return {
      state: "atendimento_humano",
      intent: "atendimento_humano",
      humanHandoff: true,
      ...botReplies.atendimento_humano,
    };
  }

  const matchedIntent = intentMatchers.find(({ patterns }) =>
    patterns.some((pattern) => pattern.test(message)),
  )?.intent;
  const nextState = matchedIntent ?? currentState;
  const replyData = botReplies[nextState];

  return {
    state: nextState,
    intent: nextState === "inicio" ? "orcamento" : nextState,
    humanHandoff: false,
    ...replyData,
  };
}

export const whatsappBotFlow = [
  {
    state: "orcamento",
    label: "Fazer orçamento",
    trigger: "orçamento, preço, cotação",
    next: "Coletar produto, medidas, quantidade, acabamento e prazo",
  },
  {
    state: "acompanhar_pedido",
    label: "Acompanhar pedido",
    trigger: "pedido, status, OS",
    next: "Solicitar número da OS ou documento",
  },
  {
    state: "enviar_arquivo",
    label: "Enviar arquivo",
    trigger: "arquivo, arte, anexo",
    next: "Receber upload/link e vincular ao orçamento ou OS",
  },
  {
    state: "pagamento",
    label: "Falar sobre pagamento",
    trigger: "pagamento, pix, boleto, comprovante",
    next: "Orientar forma de pagamento ou receber comprovante",
  },
  {
    state: "agendar_retirada",
    label: "Agendar retirada",
    trigger: "retirada, buscar, horário",
    next: "Coletar OS, data, horário e responsável pela retirada",
  },
  {
    state: "atendimento_humano",
    label: "Falar com atendente",
    trigger: "atendente, humano, suporte, pessoa, falar com alguém",
    next: "Transferir para fila humana e pausar automação",
  },
] as const;
