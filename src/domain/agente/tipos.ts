import type { Degrau } from "../whatsapp/triagem/escada";
import type { RamoDaBase, RespostaDaBase } from "../agente-base/tipos";

/**
 * Tipos do agente que ESCOLHE respostas aprovadas (C3). Funções puras: nada aqui fala com banco, rede ou WhatsApp.
 *
 * REGRAS DO DONO, que este módulo carrega:
 *  - o agente NUNCA escreve texto livre: só escolhe um código (a resposta aprovada de um ramo) ou entrega à equipe;
 *  - o texto que sai é SEMPRE o `texto_aprovado` da base, palavra por palavra, lido pelo banco na hora de enfileirar;
 *  - nunca cita preço, prazo, desconto nem orçamento; pergunta de preço tem a resposta aprovada de que a equipe confirma
 *    e a segunda pergunta de preço entrega à equipe;
 *  - nunca pergunta o tipo do contato (o ramo vem da triagem);
 *  - dado pessoal nunca vai para evento nem log: só códigos e contagens; a frase do contato sem resposta NÃO é guardada.
 */

export type ConfigDoAgente = {
  estado: Degrau;
  percentual: number;
  /** Números de teste, só dígitos com 55, como o banco guarda. */
  numerosDeTeste: readonly string[];
  /** Instante em que o agente saiu de desligada pela primeira vez; nulo se nunca. */
  valeAPartirDe: number | null;
  /** Teto de mensagens do AGENTE por conversa. */
  maxMensagens: number;
  atrasoMinS: number;
  atrasoMaxS: number;
  maxPorHora: number;
  maxPorDia: number;
  avisarGrupo: boolean;
};

export const CONFIG_PADRAO_DO_AGENTE: ConfigDoAgente = {
  estado: "desligada",
  percentual: 0,
  numerosDeTeste: [],
  valeAPartirDe: null,
  maxMensagens: 3,
  atrasoMinS: 3,
  atrasoMaxS: 8,
  maxPorHora: 20,
  maxPorDia: 100,
  avisarGrupo: true,
};

/** A mensagem do contato que o agente vai ler. O texto NUNCA é guardado em lugar nenhum. */
export type EntradaDoAgente = {
  id: string;
  /** Tipo do banco: texto, audio, imagem, documento, video, sticker, localizacao, contato, sistema. */
  tipo: string;
  texto: string | null;
  legenda: string | null;
  origem: string | null;
  /** Veio depois de a triagem terminar? A mensagem que fechou a triagem é da triagem, não do agente. */
  posteriorATriagem: boolean;
};

export type ContextoDoAgente = {
  config: ConfigDoAgente;
  conversaId: string;
  /** `whatsapp_conversas.telefone`, o mesmo que o despachante usa. */
  telefone: string | null;
  telefoneNormalizado: string | null;
  ehDeGrupo: boolean;
  humanoNaConversa: boolean;
  bloqueado: boolean;
  /** `triagem_dono_da_conversa`. */
  dono: string | null;
  triagem: { id: string; ramo: RamoDaBase; liberou: boolean } | null;
  mensagem: EntradaDoAgente | null;
  /** Esta mensagem de entrada já tem decisão do agente (webhook entregue duas vezes). */
  jaDecidida: boolean;
  /** Mensagens do agente já enfileiradas nesta conversa. */
  enviadas: number;
  enviadasNaHora: number;
  enviadasNoDia: number;
  /** Decisões desta conversa que foram pergunta de preço. */
  perguntasDePreco: number;
  /** Uma resposta do agente ainda espera na fila. */
  envioPendente: boolean;
  /** Milissegundos desde a última saída automática da conversa; nulo se não houve. */
  msDesdeUltimaAutomatica: number | null;
  /** Só as respostas APROVADAS, com `resposta` igual a `texto_aprovado`. */
  base: readonly RespostaDaBase[];
};

/** Tema da resposta que diz que a equipe confirma o valor. A pergunta de preço só pode receber esta. */
export const TEMA_DE_PRECO = "valor_do_produto";

/** Temas cuja resposta promete avisar a equipe: depois de enviá-la o agente entrega a conversa. */
export const TEMAS_QUE_PASSAM_PARA_A_EQUIPE: readonly string[] = ["falar_com_a_equipe"];

export type MotivoDeNada =
  | "desligada"
  | "sem_triagem_liberada"
  | "mensagem_inexistente"
  | "mensagem_da_triagem"
  | "nao_e_pessoa"
  | "ja_decidida"
  | "grupo"
  | "fora_do_degrau"
  | "dono_nao_e_o_agente";

export type MotivoDeBarra =
  | "humano_na_conversa"
  | "bloqueado"
  | "sem_numero_alcancavel"
  | "robo"
  | "figurinha"
  | "sem_texto"
  | "cortesia"
  | "parar";

export type MotivoDeEntrega =
  | "teto_de_mensagens"
  /** O limite de respostas por hora ou por dia chegou: o contato não pode ficar sem resposta e sem ninguém sabendo. */
  | "freio_de_volume"
  /** A resposta anterior do agente ainda está na fila e chegou outra pergunta: a conversa vai à equipe. */
  | "rajada"
  | "nao_e_texto"
  | "texto_longo"
  | "link"
  | "reclamou"
  | "pediu_equipe"
  | "preco_de_novo"
  | "sem_resposta"
  | "empate"
  | "texto_reprovado"
  | "resposta_mudou";

export type DecisaoDoAgente =
  /** Silêncio sem evento: a conversa não é do agente ou o degrau não a cobre. */
  | { acao: "nada"; motivo: MotivoDeNada }
  /** Evento `barrado`: o agente é dono, mas não fala agora. Nada vai à equipe. */
  | { acao: "barrar"; motivo: MotivoDeBarra }
  /** O contato pediu para parar: evento `barrado` e bloqueio (só no envio real). */
  | { acao: "parar"; motivo: "parar" }
  /** Evento `entregou`: a conversa vai à equipe e o agente não fala mais nela. */
  | { acao: "entregar"; motivo: MotivoDeEntrega; ehPreco: boolean; regras: string[] }
  /** Evento `escolheu`: sai a resposta aprovada, e só ela. */
  | {
      acao: "escolher";
      respostaId: string;
      versao: number;
      tema: string;
      /** O texto aprovado, só para o ensaio e o teste mostrarem. O banco lê o seu próprio e ignora este. */
      texto: string;
      especificidade: 1 | 2 | 3;
      candidatas: number;
      ehPreco: boolean;
      passarParaEquipe: boolean;
      atrasoS: number;
    };

export type ModoDoAgente = "ensaio" | "real";
