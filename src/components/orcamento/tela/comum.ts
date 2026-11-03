import { PENDENCIA_ITEM_SEM_CUSTO } from "@/domain/orcamentos/acordo";

export const statusTone: Record<string, "cyan" | "magenta" | "lime" | "amber" | "muted"> = {
  rascunho: "muted",
  enviado: "cyan",
  aprovado: "lime",
  rejeitado: "magenta",
  expirado: "amber",
  convertido: "lime",
};

/** O status como se fala na gráfica (o valor gravado continua o do enum). */
export const ROTULO_DO_STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado ao cliente",
  aprovado: "Aprovado",
  rejeitado: "Recusado",
  expirado: "Expirado",
  convertido: "Virou OS",
};

/** Onde cada pendência se resolve: o aviso do topo leva até o campo. */
export const ONDE_RESOLVER: Record<string, string> = {
  "data de entrega": "acordo-entrega",
  "condição de pagamento": "acordo-pagamento",
  "aprovação do desconto": "acordo-desconto",
  itens: "itens-do-orcamento",
  [PENDENCIA_ITEM_SEM_CUSTO]: "itens-do-orcamento",
};
