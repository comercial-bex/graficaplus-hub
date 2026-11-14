/**
 * Tipos da base de respostas aprovadas do agente (C2). Funções puras: nada aqui
 * fala com banco, rede ou WhatsApp, e nenhum consumidor do agente lê esta base
 * ainda. A resposta só vale depois de o dono aprovar, uma a uma.
 */

export type StatusDaResposta = "rascunho" | "aprovada" | "arquivada";
export const STATUS_DA_RESPOSTA: readonly StatusDaResposta[] = [
  "rascunho",
  "aprovada",
  "arquivada",
] as const;

export type RamoDaBase = "cliente" | "parceiro";

export type RespostaDaBase = {
  id: string;
  tema: string;
  pergunta: string;
  frases_gatilho: string[];
  ramos: RamoDaBase[];
  produto_id: string | null;
  familia: string | null;
  resposta: string;
  status: StatusDaResposta;
  texto_aprovado: string | null;
  versao: number;
  aprovada_por: string | null;
  aprovada_em: string | null;
  origem: "semente" | "dono" | "conversas";
  contagem_ocorrencias: number;
  atualizado_em: string;
};

export type EventoDoHistorico =
  | "criada"
  | "editada"
  | "aprovada"
  | "voltou_a_rascunho"
  | "editada_e_voltou_a_rascunho"
  | "arquivada"
  | "reaberta";

export type LinhaDoHistorico = {
  id: string;
  resposta_id: string;
  versao: number;
  evento: EventoDoHistorico;
  status: StatusDaResposta;
  resposta: string;
  por: string | null;
  em: string;
};

/**
 * Um produto como a tela da base o vê: só id, nome, família e se está ativo.
 * Nenhum preço, custo nem margem passa por aqui. Produto desativado continua
 * na lista quando alguma resposta cita ele, para a tela nunca esconder a
 * ligação que a resposta tem.
 */
export type ProdutoDaBase = {
  id: string;
  nome: string;
  familia: string | null;
  ativo: boolean;
};
