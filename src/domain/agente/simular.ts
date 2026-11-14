import type { RamoDaBase, RespostaDaBase } from "../agente-base/tipos";
import { quadroDoBanco } from "../whatsapp/triagem/orquestrador";
import type { RespostaDoQuadro } from "../whatsapp/triagem/tipos";
import type { RegraDoBanco } from "../whatsapp/triagem/verificador";
import { decidirDoAgente } from "./decidir";
import { respostaServe } from "./escolher";
import {
  CONFIG_PADRAO_DO_AGENTE,
  type ContextoDoAgente,
  type DecisaoDoAgente,
  type MotivoDeBarra,
  type MotivoDeEntrega,
  type MotivoDeNada,
} from "./tipos";

/**
 * O simulador do agente (C4): o dono digita uma pergunta, escolhe o ramo e vê qual resposta aprovada o agente escolheria, ou
 * por que entregaria à equipe. Roda no navegador, na MESMA função de decisão que o servidor usa (`decidirDoAgente`), com a
 * base e o quadro que estão salvos. Não envia nada, não grava nada e não chama o servidor: não existe caminho daqui até o
 * WhatsApp, e a frase digitada vive só na memória da tela.
 *
 * A conversa simulada é uma conversa limpa e liberada: triagem terminada, ninguém da equipe, número de celular comum, nenhuma
 * mensagem do agente ainda. Duas coisas o dono pode mudar, porque mudam a decisão de verdade: o ramo e se o contato já
 * perguntou preço antes (a segunda pergunta de preço vai à equipe).
 *
 * O que o simulador NÃO mostra: o degrau (ele responde como se o agente estivesse ligado), o teto de mensagens, o freio de
 * volume e a conferência do banco. Quem manda de verdade é o servidor, e o banco lê o texto da base de novo.
 */

export type EntradaDoSimulador = {
  pergunta: string;
  ramo: RamoDaBase;
  /** O contato já fez uma pergunta de preço nesta conversa. */
  jaPerguntouPreco: boolean;
};

export type DesfechoSimulado = "responderia" | "entregaria" | "silencio" | "pararia" | "nada";

export type RespostaSimulada = {
  id: string;
  tema: string;
  /** A pergunta da base que esta resposta responde, como o dono a escreveu na tela de aprovação. */
  perguntaDaBase: string;
  /** O texto aprovado, palavra por palavra: é o que o contato receberia. */
  texto: string;
  /** Quantas respostas aprovadas serviam; mais de uma quer dizer que esta ganhou. */
  candidatas: number;
  ehPreco: boolean;
  /** Depois de mandar esta resposta o agente entrega a conversa à equipe. */
  passaParaEquipe: boolean;
};

export type ResultadoDaSimulacao = {
  desfecho: DesfechoSimulado;
  titulo: string;
  explicacao: string;
  /** O código do motivo, para o dono comparar com as métricas. Nulo quando o agente responderia. */
  motivo: string | null;
  resposta: RespostaSimulada | null;
};

const MOTIVO_DE_ENTREGA: Record<MotivoDeEntrega, string> = {
  teto_de_mensagens: "O agente já escolheu o máximo de respostas desta conversa.",
  freio_de_volume:
    "O agente atingiu o limite de respostas por hora ou por dia. Ele entrega a conversa à equipe, para o contato não ficar sem resposta.",
  rajada:
    "O contato mandou outra mensagem antes de a resposta anterior sair da fila. O agente entrega à equipe em vez de responder duas vezes seguidas.",
  nao_e_texto: "A mensagem não é texto, como um áudio ou uma foto. O agente não lê isso.",
  texto_longo:
    "A mensagem é longa. Quem escreve muito quer que uma pessoa leia, então o agente não responde.",
  link: "A mensagem tem um link. O agente não responde e deixa a equipe ver.",
  reclamou: "O contato parece estar reclamando. O agente não responde e deixa a equipe cuidar.",
  pediu_equipe: "O contato pediu para falar com uma pessoa e não há resposta aprovada para isso.",
  preco_de_novo:
    "É a segunda pergunta de preço desta conversa. O agente já disse que a equipe confirma o valor e não responde de novo.",
  sem_resposta:
    "Nenhuma resposta aprovada serve para esta pergunta. Talvez falte escrever uma resposta para ela.",
  empate: "Duas respostas aprovadas servem com a mesma força. O agente não sorteia, então entrega.",
  texto_reprovado:
    "A resposta escolhida foi barrada na conferência final do texto. Confira a resposta na tela Respostas do agente.",
  resposta_mudou:
    "A resposta mudou entre a leitura e o envio. O agente entrega em vez de mandar um texto que o dono não leu.",
};

const MOTIVO_DE_SILENCIO: Record<MotivoDeBarra, string> = {
  humano_na_conversa: "Alguém da equipe já está na conversa.",
  bloqueado: "Este contato pediu para não receber mensagem automática.",
  sem_numero_alcancavel: "O número do chat não é um celular que o agente alcança.",
  robo: "A mensagem parece de outro robô, como uma empresa.",
  figurinha: "Figurinha não é pergunta. O agente não responde.",
  sem_texto: "A mensagem está vazia.",
  cortesia: "É um cumprimento ou um agradecimento, não uma pergunta. O agente fica em silêncio.",
  parar: "O contato pediu para parar.",
};

const MOTIVO_DE_NADA: Record<MotivoDeNada, string> = {
  desligada: "O agente está desligado.",
  sem_triagem_liberada: "A triagem desta conversa ainda não liberou o agente.",
  mensagem_inexistente: "Não há mensagem para ler.",
  mensagem_da_triagem: "Esta mensagem pertence à triagem, não ao agente.",
  nao_e_pessoa: "A mensagem não veio de uma pessoa.",
  ja_decidida: "Esta mensagem já teve uma decisão.",
  grupo: "Conversa de grupo. O agente não fala em grupo.",
  fora_do_degrau: "O degrau atual não cobre esta conversa.",
  dono_nao_e_o_agente: "Outro dono cuida desta conversa.",
};

/** O texto de um motivo, para a simulação e para as métricas. Código que o agente não conhece volta escrito sem sublinhado. */
export function motivoEmTexto(motivo: string): string {
  const todos = {
    ...MOTIVO_DE_NADA,
    ...MOTIVO_DE_SILENCIO,
    ...MOTIVO_DE_ENTREGA,
  } as Record<string, string>;
  return todos[motivo] ?? motivo.replace(/_/g, " ");
}

/** Os motivos de entrega e de silêncio que a tela das métricas sabe explicar, para o teste conferir que nenhum ficou sem texto. */
export const CODIGOS_DE_ENTREGA = Object.keys(MOTIVO_DE_ENTREGA) as MotivoDeEntrega[];
export const CODIGOS_DE_SILENCIO = Object.keys(MOTIVO_DE_SILENCIO) as MotivoDeBarra[];

/** Motivo que existe só no rastro do agente real, fora da decisão pura, e a frase que o dono lê. */
export const MOTIVOS_SO_DO_RASTRO: Record<string, string> = {
  passou_com_a_resposta:
    "O agente escolheu a resposta aprovada de falar com a equipe, colocou na fila e passou a conversa para a equipe.",
};

export function motivoDoRastroEmTexto(motivo: string): string {
  return MOTIVOS_SO_DO_RASTRO[motivo] ?? motivoEmTexto(motivo);
}

/** Só a base que o agente PODE usar: aprovada, com texto aprovado e que ainda diz o que o dono leu. */
export function baseQueServe(base: readonly RespostaDaBase[]): RespostaDaBase[] {
  return base.filter(respostaServe);
}

export function contextoDaSimulacao(
  entrada: EntradaDoSimulador,
  base: readonly RespostaDaBase[],
): ContextoDoAgente {
  const telefone = "5596991112233";
  return {
    config: { ...CONFIG_PADRAO_DO_AGENTE, estado: "ligada" },
    conversaId: "simulacao",
    telefone,
    telefoneNormalizado: telefone,
    ehDeGrupo: false,
    humanoNaConversa: false,
    bloqueado: false,
    dono: "agente",
    triagem: { id: "simulacao", ramo: entrada.ramo, liberou: true },
    mensagem: {
      id: "simulacao",
      tipo: "texto",
      texto: entrada.pergunta,
      legenda: null,
      origem: null,
      posteriorATriagem: true,
    },
    jaDecidida: false,
    enviadas: 0,
    enviadasNaHora: 0,
    enviadasNoDia: 0,
    perguntasDePreco: entrada.jaPerguntouPreco ? 1 : 0,
    envioPendente: false,
    msDesdeUltimaAutomatica: null,
    base: baseQueServe(base),
  };
}

function descrever(d: DecisaoDoAgente, base: readonly RespostaDaBase[]): ResultadoDaSimulacao {
  switch (d.acao) {
    case "escolher": {
      const r = base.find((x) => x.id === d.respostaId);
      return {
        desfecho: "responderia",
        titulo: d.passarParaEquipe
          ? "O agente responderia e depois passaria para a equipe"
          : "O agente responderia com uma resposta aprovada",
        explicacao: d.ehPreco
          ? "É pergunta de preço. A única resposta que o agente pode mandar é a de que a equipe confirma o valor."
          : d.candidatas > 1
            ? `${d.candidatas} respostas aprovadas serviam. Ganhou a que casa com a frase mais específica.`
            : "Uma resposta aprovada serve para esta pergunta.",
        motivo: null,
        resposta: {
          id: d.respostaId,
          tema: d.tema,
          perguntaDaBase: r?.pergunta ?? "",
          texto: d.texto,
          candidatas: d.candidatas,
          ehPreco: d.ehPreco,
          passaParaEquipe: d.passarParaEquipe,
        },
      };
    }
    case "entregar":
      return {
        desfecho: "entregaria",
        titulo: "O agente entregaria à equipe",
        explicacao: motivoEmTexto(d.motivo),
        motivo: d.motivo,
        resposta: null,
      };
    case "barrar":
      return {
        desfecho: "silencio",
        titulo: "O agente ficaria em silêncio",
        explicacao: motivoEmTexto(d.motivo),
        motivo: d.motivo,
        resposta: null,
      };
    case "parar":
      return {
        desfecho: "pararia",
        titulo: "O agente pararia de falar com este contato",
        explicacao:
          "O contato pediu para parar. Ele entra na lista de quem não recebe mais mensagem automática.",
        motivo: d.motivo,
        resposta: null,
      };
    case "nada":
      return {
        desfecho: "nada",
        titulo: "O agente não faria nada",
        explicacao: motivoEmTexto(d.motivo),
        motivo: d.motivo,
        resposta: null,
      };
  }
}

/**
 * A simulação. `quadro` são as linhas do quadro de frases da triagem (as que leem a intenção: parar, preço, cortesia,
 * reclamação, robô), no formato do banco; `termos` são os termos proibidos que o dono acrescentou. Ambos vêm do servidor,
 * os mesmos que o agente de verdade lê.
 */
export function simularAgente(
  entrada: EntradaDoSimulador,
  base: readonly RespostaDaBase[],
  quadro: unknown,
  termos: readonly RegraDoBanco[] = [],
): ResultadoDaSimulacao {
  const q: RespostaDoQuadro[] = quadroDoBanco(quadro);
  const ctx = contextoDaSimulacao(entrada, base);
  return descrever(decidirDoAgente(ctx, q, termos), ctx.base);
}
