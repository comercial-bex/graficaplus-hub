import { normalizarTexto } from "./normalizar";
import { interpretar } from "./quadro";
import {
  preencher,
  VALORES_DE_EXEMPLO,
  validarTextoEditavel,
  type ProblemaDeEdicao,
} from "./textos";
import {
  contextoPadrao,
  iniciarSessao,
  SABADO_AS_20H,
  SEGUNDA_AS_10H,
  type SessaoSimulada,
} from "./simular";
import type {
  ConfigDaTriagem,
  ContextoDaTriagem,
  Intencao,
  PassoDeTexto,
  Ramo,
  RespostaDoQuadro,
} from "./tipos";
import { CONFIG_PADRAO_DA_TRIAGEM } from "./tipos";

/**
 * Funções puras da tela de configuração da triagem (Onda B, PR B6): explicar
 * em português simples por que um texto foi recusado, mostrar o texto como a
 * pessoa vai ler, dizer que intenção o quadro entende numa frase, e montar o
 * contexto do simulador com o que está na tela. Nada aqui fala com banco, rede
 * ou WhatsApp: o simulador roda o motor puro e não envia nada.
 */

/** Por que o texto foi recusado, na linguagem do dono. Sem travessão, seta nem parênteses. */
const EXPLICACAO_DA_REGRA: Record<string, string> = {
  vazio: "está vazio. Escreva a mensagem.",
  acima_de_600_caracteres: "passou de 600 letras. Encurte para a mensagem caber.",
  variavel_nao_permitida: "usa um campo que não existe para esta mensagem.",
  variavel_sem_preencher: "deixou um campo entre chaves sem preencher.",
  moeda: "fala em dinheiro. O robô nunca fala valor.",
  valor_em_reais: "fala em reais. O robô nunca fala valor.",
  valor_com_centavos: "tem um número com cara de preço. O robô nunca fala valor.",
  valor_depois_de_valor: "fala em valor com número. O robô nunca fala valor.",
  porcentagem: "fala em porcentagem. O robô nunca fala desconto nem juros.",
  desconto: "fala em desconto. O robô nunca fala desconto.",
  pix: "fala em forma de pagamento. Isso é só com a equipe.",
  boleto: "fala em forma de pagamento. Isso é só com a equipe.",
  parcelamento: "fala em forma de pagamento. Isso é só com a equipe.",
  juros: "fala em juros. Isso é só com a equipe.",
  nota_fiscal: "fala em nota fiscal. Isso é só com a equipe.",
  prazo_em_numero: "promete prazo em número. O robô nunca promete prazo.",
  parceiro: "tem a palavra parceiro, que cliente final não pode ler.",
  terceirizado: "tem a palavra terceirizado, que cliente final não pode ler.",
  revendedor: "tem uma palavra que a Bex Print não usa e que cliente final não pode ler.",
  tabela: "fala em tabela, que cliente final não pode ler.",
  preco_diferenciado:
    "fala em preço diferente para alguns clientes, que cliente final não pode ler.",
  travessao: "tem travessão. O estilo da Bex Print não usa travessão.",
  seta: "tem seta. O estilo da Bex Print não usa seta.",
  parenteses: "tem parênteses. O estilo da Bex Print não usa parênteses.",
};

/** Uma frase pronta para mostrar na recusa. */
export function explicarProblemaDeTexto(p: ProblemaDeEdicao): string {
  const base = EXPLICACAO_DA_REGRA[p.regra] ?? "tem um trecho que o robô não pode falar.";
  const trecho =
    p.detalhe && p.detalhe.length <= 40 && p.regra !== "acima_de_600_caracteres"
      ? ` Trecho: ${p.detalhe}.`
      : "";
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}${trecho}`;
}

/** Os problemas de um texto, já explicados, para a tela mostrar antes mesmo de salvar. */
export function problemasExplicados(texto: string, ramo: Ramo): string[] {
  return validarTextoEditavel(texto, ramo).map(explicarProblemaDeTexto);
}

/**
 * O texto como a pessoa vai ler, com nome, endereço e horário de exemplo. Quando
 * o ack ainda está vazio no meio do texto, o espaço sobrando é limpo.
 */
export function visualizarTexto(texto: string, ramo: Ramo): { texto: string; problemas: string[] } {
  const montado = preencher(texto, {
    ...VALORES_DE_EXEMPLO,
    link_parceiro: ramo === "parceiro" ? VALORES_DE_EXEMPLO.link_parceiro : null,
  }).texto;
  return { texto: montado, problemas: problemasExplicados(texto, ramo) };
}

/* ------------------------------------------------------------------ */
/* Quadro de respostas                                                 */
/* ------------------------------------------------------------------ */

export const ROTULO_DA_INTENCAO: Record<Intencao, string> = {
  sim: "Sim",
  nao: "Não",
  mudar: "Quer mudar o número",
  primeira_vez: "Primeira vez",
  ja_cliente: "Já é cliente",
  pular: "Quer pular",
  recusar: "Prefere não informar",
  parar: "Quer parar de receber",
  falar_com_equipe: "Quer falar com a equipe",
  parceiro: "Quer ser parceiro",
  pergunta_preco: "Perguntou valor",
  saudacao: "Cumprimento",
  automatica: "Mensagem automática de empresa",
  agradecimento: "Agradecimento",
  reclamacao: "Reclamação",
  nao_sei: "Não entendi",
};

export const EXPLICACAO_DO_CASAMENTO = {
  igual: "A mensagem inteira é igual à frase.",
  comeca: "A mensagem começa com a frase.",
  contem: "A mensagem tem a frase no meio.",
} as const;

/** Que intenção o quadro entende nesta frase? Para o campo de teste da tela. */
export function testarFrase(
  frase: string,
  passo: string | null,
  quadro: readonly RespostaDoQuadro[],
): { intencao: Intencao; rotulo: string; ambigua: boolean; candidatas: Intencao[] } {
  const i = interpretar(frase, passo, quadro, { qualquerPasso: passo === null });
  return {
    intencao: i.intencao,
    rotulo: ROTULO_DA_INTENCAO[i.intencao],
    ambigua: i.ambigua,
    candidatas: i.candidatas,
  };
}

/**
 * A frase que o dono vai salvar já existe, no mesmo lugar e com o mesmo jeito de comparar, mas com OUTRA intenção?
 * O banco troca a intenção da frase que já existe (a chave é etapa, frase e jeito de comparar), então salvar sem
 * avisar muda o que o robô entende sem o dono perceber. Devolve a linha que existe, ou nulo.
 */
export function fraseJaExisteComOutraIntencao<
  R extends { passo: string | null; intencao: string; frase: string; casamento: string },
>(
  respostas: readonly R[],
  nova: { passo: string | null; intencao: string; frase: string; casamento: string },
): R | null {
  const frase = normalizarTexto(nova.frase);
  if (!frase) return null;
  return (
    respostas.find(
      (r) =>
        (r.passo ?? "") === (nova.passo ?? "") &&
        r.casamento === nova.casamento &&
        normalizarTexto(r.frase) === frase &&
        r.intencao !== nova.intencao,
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */

export type DadosDoSimulador = {
  passos: readonly {
    codigo: string;
    ramo: Ramo;
    texto: string;
    variantes: readonly string[];
    repeticao: string | null;
    ativo: boolean;
  }[];
  respostas: readonly {
    passo: string | null;
    intencao: string;
    frase: string;
    casamento: "igual" | "comeca" | "contem";
    ativo: boolean;
  }[];
  horarios: readonly { dia_semana: number; abre: string; fecha: string; ativo: boolean }[];
  feriados: readonly {
    data: string;
    fechado: boolean;
    abre: string | null;
    fecha: string | null;
  }[];
  config: {
    max_mensagens: number;
    max_tentativas_por_passo: number;
    intervalo_minimo_s: number;
    atraso_min_s: number;
    atraso_max_s: number;
    espera_resposta_min: number;
    retomar_ate_horas: number;
    link_parceiro: string | null;
  };
};

export type OpcoesDoSimulador = {
  /** Horário de atendimento: dentro (segunda 10h) ou fora (sábado 20h). */
  horario: "dentro" | "fora";
  /** O contato veio de anúncio de parceiro (a Onda A marcou o lead como parceiro). */
  anuncioDeParceiro: boolean;
  /** O número do chat não é um celular comum (identificador longo do WhatsApp). */
  numeroDoChatEstranho: boolean;
};

export const OPCOES_PADRAO_DO_SIMULADOR: OpcoesDoSimulador = {
  horario: "dentro",
  anuncioDeParceiro: false,
  numeroDoChatEstranho: false,
};

const INTENCOES_DO_MOTOR = new Set<string>([
  "sim",
  "nao",
  "mudar",
  "primeira_vez",
  "ja_cliente",
  "pular",
  "recusar",
  "parar",
  "falar_com_equipe",
  "parceiro",
  "pergunta_preco",
  "saudacao",
  "agradecimento",
  "automatica",
  "reclamacao",
]);

/** O contexto do motor feito do que está salvo no banco e aparece na tela. É o mesmo texto que o robô usaria agora. */
export function contextoDaSimulacao(d: DadosDoSimulador, o: OpcoesDoSimulador): ContextoDaTriagem {
  const passos: PassoDeTexto[] = d.passos.map((p) => ({
    codigo: p.codigo,
    ramo: p.ramo,
    texto: p.texto,
    variantes: [...p.variantes],
    repeticao: p.repeticao,
    ativo: p.ativo,
  }));
  const quadro: RespostaDoQuadro[] = d.respostas
    .filter((r) => r.ativo && INTENCOES_DO_MOTOR.has(r.intencao))
    .map((r) => ({
      passo: r.passo,
      intencao: r.intencao as RespostaDoQuadro["intencao"],
      frase: r.frase,
      casamento: r.casamento,
    }));
  const config: ConfigDaTriagem = {
    ...CONFIG_PADRAO_DA_TRIAGEM,
    maxMensagens: d.config.max_mensagens,
    maxTentativasPorPasso: d.config.max_tentativas_por_passo,
    intervaloMinimoS: d.config.intervalo_minimo_s,
    atrasoMinS: d.config.atraso_min_s,
    atrasoMaxS: d.config.atraso_max_s,
    esperaRespostaMin: d.config.espera_resposta_min,
    retomarAteHoras: d.config.retomar_ate_horas,
    // link vazio fica VAZIO: sem link o robô de verdade não manda cadastro, passa a conversa para a equipe
    linkParceiro: d.config.link_parceiro?.trim() ? d.config.link_parceiro.trim() : null,
  };
  return contextoPadrao({
    config,
    passos,
    quadro,
    horario: {
      semana: d.horarios.map((h) => ({
        diaSemana: h.dia_semana,
        abre: h.abre,
        fecha: h.fecha,
        ativo: h.ativo,
      })),
      feriados: d.feriados.map((f) => ({
        data: f.data,
        fechado: f.fechado,
        abre: f.abre,
        fecha: f.fecha,
      })),
    },
    telefoneDoChat: o.numeroDoChatEstranho
      ? { normalizado: "253386293268636", ehLid: true }
      : { normalizado: "96991112233", ehLid: false },
    leadTipo: o.anuncioDeParceiro ? "parceiro" : null,
  });
}

/** Começa uma conversa de mentira. O relógio da sessão é uma segunda de manhã ou um sábado à noite, conforme a escolha. */
export function novaSimulacao(d: DadosDoSimulador, o: OpcoesDoSimulador): SessaoSimulada {
  return iniciarSessao({
    modo: "ensaio",
    agora: o.horario === "dentro" ? SEGUNDA_AS_10H : SABADO_AS_20H,
    ctx: contextoDaSimulacao(d, o),
  });
}

/* ------------------------------------------------------------------ */
/* Números de teste                                                    */
/* ------------------------------------------------------------------ */

/** Só os dígitos. A tela mostra "96 99111-2233" e guarda 96991112233 (o banco normaliza de novo). */
export function digitosDoNumero(v: string): string {
  return v.replace(/\D/g, "");
}

/** O número cabe no formato de celular do Brasil, com ou sem 55 na frente? */
export function numeroDeTesteValido(v: string): boolean {
  const d = digitosDoNumero(v);
  const sem55 = (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
  return /^[1-9][1-9]9\d{8}$/.test(sem55) || /^[1-9][1-9][6-9]\d{7}$/.test(sem55);
}

export function numeroEmTexto(v: string): string {
  const d = digitosDoNumero(v);
  const sem55 = (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
  if (sem55.length === 11) return `${sem55.slice(0, 2)} ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `${sem55.slice(0, 2)} ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return v;
}

/* ------------------------------------------------------------------ */
/* Horário e feriados                                                  */
/* ------------------------------------------------------------------ */

export const NOME_DO_DIA = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** "2026-12-25" para "25/12/2026". Por fatia da string, nunca por Date: o servidor roda em UTC. */
export function dataEmTexto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "25/12/2026" para "2026-12-25"; nulo se a data não existe. */
export function dataEmIso(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(a, mes - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== mes - 1 || t.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Nomes para o dono                                                   */
/* ------------------------------------------------------------------ */

/** O nome de cada etapa em palavras simples. Código novo sem nome aqui aparece como o próprio código. */
export const ROTULO_DO_PASSO: Record<string, string> = {
  nome: "Pedir o nome e o sobrenome",
  nome_curto: "Pedir o nome, quando a pessoa já disse o que quer",
  sobrenome: "Pedir só o sobrenome",
  primeira_vez: "Perguntar se já é cliente",
  cep: "Pedir o CEP",
  telefone: "Confirmar o telefone",
  telefone_direto: "Pedir o telefone, quando o número do chat não é celular comum",
  telefone_novo: "Pedir outro telefone",
  fechamento_fora: "Despedida fora do horário",
  fechamento_fora_sem_horario: "Despedida fora do horário, sem dia de atendimento",
  fechamento_dentro: "Despedida dentro do horário",
  ack_ja_cliente: "Boas-vindas de volta para quem já é cliente",
  ack_cep_ok: "Confirmar o CEP com bairro e cidade",
  ack_cep_sem_consulta: "Confirmar o CEP sem endereço",
  ack_endereco: "Confirmar o endereço escrito",
  ack_cep_pulado: "Quando a pessoa pula o CEP",
  ack_preco: "Quando a pessoa pergunta valor",
  aviso_audio: "Aviso de que o robô só lê texto",
  aviso_arquivo: "Aviso de que o arquivo foi guardado",
  aviso_equipe: "Quando a pessoa pede a equipe",
  aviso_parar: "Quando a pessoa pede para parar",
  reabertura: "Quando a pessoa volta depois de um tempo",
  parceiro_nome: "Parceiro: pedir o nome",
  parceiro_link: "Parceiro: mandar o link de cadastro",
  parceiro_link_fora: "Parceiro: link de cadastro fora do horário",
  parceiro_valor: "Parceiro: quando pergunta valor",
};

export function rotuloDoPasso(codigo: string): string {
  return ROTULO_DO_PASSO[codigo] ?? codigo;
}

/** Quem ou o que desligou a triagem, para a frase da tela. */
export function motivoDeDesligar(codigo: string | null | undefined): string {
  switch (codigo) {
    case null:
    case undefined:
    case "":
      return "Ainda não foi ligada.";
    case "botao_desligar_tudo":
      return "Desligada pelo botão Desligar tudo.";
    case "freio_falhas_de_envio":
      return "Desligou sozinha: houve falhas seguidas no envio.";
    case "freio_erros_de_leitura":
      return "Desligou sozinha: houve erros demais ao ler as conversas.";
    case "freio_textos_barrados":
      return "Desligou sozinha: textos foram barrados mais de uma vez.";
    default:
      return `Desligada. Motivo: ${codigo.replace(/_/g, " ")}.`;
  }
}

export function statusEmTexto(status: string): string {
  const m: Record<string, string> = {
    ativa: "Em andamento",
    concluida: "Concluídas",
    expirada: "Sem resposta",
    pausada_humano: "A equipe assumiu",
    pausada_desligada: "Paradas por desligar",
    parada_pelo_contato: "Pediram para parar",
    entregue_equipe: "Entregues à equipe",
    pulada: "Puladas",
    ensaio: "Em ensaio",
  };
  return m[status] ?? status;
}

/** Data de um instante, no fuso de Belém, como "13/11/2026". Nunca pela data em UTC. */
export function diaEmBelem(instante: string | Date): string {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Belem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
