/**
 * Os tempos e os freios do robô de boas-vindas: o que cada campo é, em que unidade, e de quanto a quanto vale.
 *
 * É a fonte única dos limites. O servidor (`configSchema`, em whatsapp-triagem.functions.ts) monta a validação a partir
 * desta lista e a tela mostra o mesmo mínimo e máximo, então os dois nunca divergem. O banco tem o mesmo CHECK
 * (migração 20261113130000) e confere de novo. Nada aqui fala com banco ou rede.
 *
 *   tempo   quem tem configuracoes.manage ou whatsapp.manage pode mudar
 *   freio   segurança: só quem tem whatsapp.manage muda; quem não tem vê em leitura
 */

export type CampoDeLimite =
  | "esperaRespostaMin"
  | "retomarAteHoras"
  | "atrasoMinS"
  | "atrasoMaxS"
  | "intervaloMinimoS"
  | "maxMensagens"
  | "maxTentativasPorPasso"
  | "maxNovasPorHora"
  | "maxNovasPorDia"
  | "freioFalhasEnvio"
  | "freioErrosHora";

export type DefinicaoDeLimite = {
  campo: CampoDeLimite;
  /** Nome da coluna em whatsapp_triagem_config. */
  coluna: string;
  grupo: "tempo" | "freio";
  rotulo: string;
  /** Unidade no plural, para a frase "De 5 a 1440 minutos". */
  unidade: string;
  min: number;
  max: number;
  /** Uma frase simples: o que muda para o contato ou para a equipe. Sem parênteses, travessão ou seta. */
  ajuda: string;
};

export const LIMITES_DA_CONFIG: readonly DefinicaoDeLimite[] = [
  {
    campo: "esperaRespostaMin",
    coluna: "espera_resposta_min",
    grupo: "tempo",
    rotulo: "Espera pela resposta do contato",
    unidade: "minutos",
    min: 5,
    max: 1440,
    ajuda: "Quanto tempo o robô espera o contato responder antes de lembrar uma vez ou parar.",
  },
  {
    campo: "retomarAteHoras",
    coluna: "retomar_ate_horas",
    grupo: "tempo",
    rotulo: "Prazo para retomar a conversa",
    unidade: "horas",
    min: 1,
    max: 72,
    ajuda: "Se o contato voltar dentro deste prazo, o robô continua de onde parou. Depois disso, recomeça.",
  },
  {
    campo: "atrasoMinS",
    coluna: "atraso_min_s",
    grupo: "tempo",
    rotulo: "Atraso mínimo antes de responder",
    unidade: "segundos",
    min: 1,
    max: 15,
    ajuda: "O robô nunca responde mais rápido do que isso, para parecer uma pessoa digitando.",
  },
  {
    campo: "atrasoMaxS",
    coluna: "atraso_max_s",
    grupo: "tempo",
    rotulo: "Atraso máximo antes de responder",
    unidade: "segundos",
    min: 1,
    max: 15,
    ajuda: "O robô nunca demora mais do que isso. Precisa ser igual ou maior que o atraso mínimo.",
  },
  {
    campo: "intervaloMinimoS",
    coluna: "intervalo_minimo_s",
    grupo: "freio",
    rotulo: "Intervalo mínimo entre duas mensagens para o mesmo contato",
    unidade: "segundos",
    min: 5,
    max: 300,
    ajuda: "Evita mandar mensagens coladas uma na outra.",
  },
  {
    campo: "maxMensagens",
    coluna: "max_mensagens",
    grupo: "freio",
    rotulo: "Máximo de mensagens do robô por conversa",
    unidade: "mensagens",
    min: 1,
    max: 12,
    ajuda: "Ao chegar neste número o robô para e entrega a conversa para a equipe.",
  },
  {
    campo: "maxTentativasPorPasso",
    coluna: "max_tentativas_por_passo",
    grupo: "freio",
    rotulo: "Máximo de tentativas em cada pergunta",
    unidade: "tentativas",
    min: 1,
    max: 3,
    ajuda: "Se o contato não responder o que foi perguntado, o robô tenta de novo até este número.",
  },
  {
    campo: "maxNovasPorHora",
    coluna: "max_novas_por_hora",
    grupo: "freio",
    rotulo: "Máximo de conversas novas por hora",
    unidade: "conversas",
    min: 1,
    max: 100,
    ajuda: "Passou disso, os contatos seguintes esperam a hora virar.",
  },
  {
    campo: "maxNovasPorDia",
    coluna: "max_novas_por_dia",
    grupo: "freio",
    rotulo: "Máximo de conversas novas por dia",
    unidade: "conversas",
    min: 1,
    max: 1000,
    ajuda: "Passou disso, os contatos seguintes esperam o dia seguinte.",
  },
  {
    campo: "freioFalhasEnvio",
    coluna: "freio_falhas_envio",
    grupo: "freio",
    rotulo: "Falhas de envio seguidas que desligam o robô",
    unidade: "falhas",
    min: 1,
    max: 20,
    ajuda: "Se o WhatsApp recusar este número de mensagens seguidas, o robô desliga sozinho.",
  },
  {
    campo: "freioErrosHora",
    coluna: "freio_erros_hora",
    grupo: "freio",
    rotulo: "Erros em uma hora que desligam o robô",
    unidade: "erros",
    min: 1,
    max: 200,
    ajuda: "Se acontecerem tantos erros em uma hora, o robô desliga sozinho.",
  },
];

export const LIMITE_POR_CAMPO: Readonly<Record<CampoDeLimite, DefinicaoDeLimite>> = Object.fromEntries(
  LIMITES_DA_CONFIG.map((l) => [l.campo, l]),
) as Record<CampoDeLimite, DefinicaoDeLimite>;

/** Os campos que só quem tem whatsapp.manage muda. */
export const CAMPOS_DE_FREIO: ReadonlySet<string> = new Set(
  LIMITES_DA_CONFIG.filter((l) => l.grupo === "freio").map((l) => l.campo),
);

export const faixaEmTexto = (l: DefinicaoDeLimite): string => `De ${l.min} a ${l.max} ${l.unidade}.`;

/**
 * Lê o que a pessoa digitou. Devolve o número, ou a frase de erro em português simples. Aceita só inteiro, sem
 * sinal, sem vírgula e sem ponto: "8,5" e "-3" são recusados com a faixa à vista.
 */
export function lerCampoDeLimite(
  campo: CampoDeLimite,
  texto: string,
): { ok: true; valor: number } | { ok: false; erro: string } {
  const l = LIMITE_POR_CAMPO[campo];
  const t = texto.trim();
  const faixa = `Escreva um número inteiro de ${l.min} a ${l.max}.`;
  if (t === "" || !/^\d+$/.test(t)) return { ok: false, erro: faixa };
  const n = Number(t);
  if (n < l.min || n > l.max) return { ok: false, erro: faixa };
  return { ok: true, valor: n };
}

export const ERRO_DE_ATRASO = "O atraso mínimo não pode ser maior que o atraso máximo.";
