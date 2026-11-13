/**
 * Tipos da triagem de boas-vindas do WhatsApp (Onda B, PR B2).
 *
 * Tudo aqui é domínio puro: nada de banco, rede ou relógio interno. As funções
 * recebem o estado, a mensagem, o relógio (`agora`) e o contexto (configuração,
 * quadro de respostas, textos, horário) como argumento. O servidor (B5) lê o
 * banco, chama estas funções e grava o que elas mandam gravar.
 */

export type Ramo = "cliente" | "parceiro";
export type MotivoDoRamo = "anuncio_mapeado" | "palavra" | "padrao";

export type StatusDaTriagem =
  | "ativa"
  | "concluida"
  | "expirada"
  | "pausada_humano"
  | "pausada_desligada"
  | "parada_pelo_contato"
  | "entregue_equipe"
  | "pulada"
  | "ensaio";

export type PassoDaTriagem =
  | "nome"
  | "sobrenome"
  | "primeira_vez"
  | "cep"
  | "telefone"
  | "telefone_novo"
  | "fechamento"
  | "parceiro_nome"
  | "parceiro_link";

export type Intencao =
  | "sim"
  | "nao"
  | "mudar"
  | "primeira_vez"
  | "ja_cliente"
  | "pular"
  | "recusar"
  | "parar"
  | "falar_com_equipe"
  | "parceiro"
  | "pergunta_preco"
  | "saudacao"
  | "agradecimento"
  | "automatica"
  | "reclamacao"
  | "nao_sei";

export type Casamento = "igual" | "comeca" | "contem";

/** Uma linha do quadro de respostas (`whatsapp_triagem_respostas`). É DADO, não código. */
export type RespostaDoQuadro = {
  /** Código do passo em que a frase vale; nulo vale em qualquer passo. */
  passo: string | null;
  intencao: Exclude<Intencao, "nao_sei">;
  /** Já normalizada por `normalizarTexto`. */
  frase: string;
  casamento: Casamento;
  ativo?: boolean;
};

export type TipoDeEntrada =
  | "texto"
  | "audio"
  | "figurinha"
  | "imagem"
  | "documento"
  | "video"
  | "localizacao"
  | "contato";

export type EntradaDeMensagem = {
  /** Id da mensagem de entrada; repetido (webhook entregue duas vezes) é ignorado. */
  id: string | null;
  tipo: TipoDeEntrada;
  texto: string | null;
  /** Instante em que a mensagem chegou, em ms desde 1970. */
  recebidaEm: number;
  /** `automacao` vem do banco para robô de empresa. */
  origem?: string | null;
};

export type PrimeiraVez = "sim" | "nao" | "ja_cliente" | "nao_sei";
export type TelefoneConfirmado = "sim" | "alternativo" | "pendente";

export type EnderecoDoCep = {
  cep: string;
  rua?: string | null;
  bairro: string | null;
  cidade: string | null;
  estado?: string | null;
};

/** O que o contato disse, na forma que a triagem guarda (seção 2.7 do projeto). */
export type DadosColetados = {
  nomeInformado: string | null;
  nomeCompleto: boolean;
  primeiraVez: PrimeiraVez | null;
  cep: string | null;
  cepEndereco: EnderecoDoCep | null;
  enderecoTexto: string | null;
  enderecoRecusado: boolean;
  telefoneConfirmado: TelefoneConfirmado | null;
  telefoneAlternativo: string | null;
  /** O alternativo NUNCA é verificado pela triagem: só gente confirma. */
  telefoneAlternativoVerificado: false;
  pediuPreco: boolean;
  pediuTabelaEspecial: boolean;
  pediuEquipe: boolean;
  pediuParceria: boolean;
  mandouAudio: boolean;
  reclamou: boolean;
};

export type EstadoDaTriagem = {
  triagemId: string;
  conversaId: string;
  modo: "ensaio" | "real";
  ramo: Ramo;
  ramoMotivo: MotivoDoRamo;
  status: StatusDaTriagem;
  /** Nulo até a primeira mensagem do robô sair. */
  passo: PassoDaTriagem | null;
  tentativasPasso: number;
  /** Mensagens automáticas desta triagem, contando as de repetição. */
  mensagensEnviadas: number;
  avisosAudio: number;
  avisosArquivo: number;
  audios: number;
  figurinhas: number;
  perguntasDePreco: number;
  etapasEsgotadasSeguidas: number;
  versao: number;
  dados: DadosColetados;
  ultimaEntradaId: string | null;
  ultimaEntradaEm: number | null;
  ultimaEntradaNormalizada: string | null;
  ultimoEnvioEm: number | null;
  avisoGrupoDecidido: boolean;
  motivoFim: string | null;
};

export type ConfigDaTriagem = {
  maxMensagens: number;
  maxTentativasPorPasso: number;
  intervaloMinimoS: number;
  esperaRespostaMin: number;
  retomarAteHoras: number;
  atrasoMinS: number;
  atrasoMaxS: number;
  /** Resposta que chega em menos que isto depois do nosso envio, com texto longo, é robô. */
  respostaRapidaDemaisMs: number;
  /** Mostra o telefone do chat só pelo final, como pede a crítica de privacidade. */
  exibirTelefone: "final" | "inteiro";
  linkParceiro: string | null;
  /** Dígitos de DDD para número escrito sem DDD; nulo não presume (decisão do dono). */
  dddPadrao: string | null;
};

export const CONFIG_PADRAO_DA_TRIAGEM: ConfigDaTriagem = {
  maxMensagens: 8,
  maxTentativasPorPasso: 2,
  intervaloMinimoS: 20,
  esperaRespostaMin: 30,
  retomarAteHoras: 24,
  atrasoMinS: 3,
  atrasoMaxS: 8,
  respostaRapidaDemaisMs: 2500,
  exibirTelefone: "final",
  linkParceiro: null,
  dddPadrao: null,
};

/** Uma linha de `whatsapp_triagem_passos`: o texto que o dono edita. */
export type PassoDeTexto = {
  codigo: string;
  ramo: Ramo;
  texto: string;
  variantes?: readonly string[];
  repeticao?: string | null;
  ativo?: boolean;
};

export type HorarioDaSemana = {
  /** 0 = domingo … 6 = sábado. */
  diaSemana: number;
  abre: string;
  fecha: string;
  ativo: boolean;
};

export type Feriado = {
  /** AAAA-MM-DD no fuso de Belém. */
  data: string;
  fechado: boolean;
  abre?: string | null;
  fecha?: string | null;
};

export type TabelaDeHorario = {
  semana: readonly HorarioDaSemana[];
  feriados?: readonly Feriado[];
};

export type ContextoDaTriagem = {
  config: ConfigDaTriagem;
  quadro: readonly RespostaDoQuadro[];
  passos: readonly PassoDeTexto[];
  horario: TabelaDeHorario;
  telefoneDoChat: { normalizado: string | null; ehLid: boolean };
  /** Resultado da consulta de CEP feita pelo servidor para o CEP que o contato escreveu. */
  enderecoDoCep?: EnderecoDoCep | null;
  /** Gente da equipe respondeu, a conversa ganhou responsável, foi para modo humano ou foi arquivada. */
  humanoNaConversa?: boolean;
  /** Mensagens automáticas de fora da triagem (aviso de pedido, cobrança), que contam no teto. */
  automaticasDeFora?: number;
  /** `leads.tipo` da Onda A. Nulo ou ausente: sem Onda A, o ramo é cliente final. */
  leadTipo?: "parceiro" | "cliente" | null;
};

export type MotivoDoAviso =
  | "concluida"
  | "expirada"
  | "entregue_equipe"
  | "pedido_equipe"
  | "audio"
  | "parceiro"
  | "pediu_parceria"
  | "texto_barrado"
  | "limite_mensagens";

export type EventoDaTriagem = {
  tipo: "interpretada" | "pulou" | "pausa" | "texto_barrado" | "aviso_grupo" | "gate";
  passo: PassoDaTriagem | null;
  intencao: Intencao | null;
  /** Só códigos e contagens. Nunca nome, telefone, CEP nem texto do contato. */
  detalhe: Record<string, string | number | boolean | null | string[]>;
};

export type EnvioDaTriagem = {
  texto: string;
  /** Códigos dos textos usados, na ordem. */
  codigos: string[];
  /** Nomes das variáveis usadas, nunca os valores. */
  variaveis: string[];
  atrasoS: number;
  /** `triagem:<id>:<código>:<ordem da mensagem>`. */
  chaveDeIdempotencia: string;
  ordem: number;
};

export type AvisoParaOGrupo = {
  motivo: MotivoDoAviso;
  marcas: string[];
};

export type ResultadoDoPasso = {
  estado: EstadoDaTriagem;
  acao: "enviar" | "silencio";
  envio: EnvioDaTriagem | null;
  /** Só os campos que mudaram nesta rodada. */
  gravar: Partial<DadosColetados>;
  eventos: EventoDaTriagem[];
  avisarGrupo: AvisoParaOGrupo | null;
  /** O contato pediu para parar: o servidor grava o bloqueio por conversa, lid e telefone. */
  bloquearContato: boolean;
  /** Motivo curto do silêncio ou do fim, para o registro. */
  motivo: string | null;
};

export const STATUS_ENCERRADOS: readonly StatusDaTriagem[] = [
  "concluida",
  "parada_pelo_contato",
  "entregue_equipe",
  "pausada_humano",
  "pausada_desligada",
  "pulada",
];

export function emMs(agora: Date | number): number {
  return agora instanceof Date ? agora.getTime() : agora;
}
