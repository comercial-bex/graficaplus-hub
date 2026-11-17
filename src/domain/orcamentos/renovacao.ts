import type { OrcamentoDoQuadro } from "@/domain/orcamentos/quadro";
import { diaEmBrasilia, validoAteDoLink } from "@/domain/orcamentos/resposta-do-link";

/**
 * Renovar um orçamento que venceu (02/11/2026). O quadro mostra "venceu há N
 * dias" e a coluna Expirado, mas não dava o passo seguinte: o vendedor abria o
 * orçamento, trocava o status na mão e só então reenviava. Agora o cartão tem
 * "Renovar e reenviar": volta para Enviado com a validade contando de novo e
 * abre o orçamento para mandar ao cliente pelo botão de sempre.
 *
 * Desde 17/11/2026 quem grava é a função do banco `renovar_orcamento_vencido`
 * (muda o status, grava `enviado_em`, congela a versão e registra o evento).
 * A tela nunca faz UPDATE direto, nem quando a função ainda não existe: este
 * arquivo só decide se o botão aparece e o que o cliente da tela chama.
 *
 * Nada aqui manda mensagem ao cliente: reenviar continua sendo um gesto
 * explícito na tela do orçamento, com o PDF e o link na frente de quem vende.
 */

export type OrcamentoRenovavel = Pick<OrcamentoDoQuadro, "status" | "enviado_em" | "validade_dias" | "valor_total"> & {
  /** Quando não há `enviado_em`, o banco conta a validade da criação. */
  created_at?: string | null;
};

/** O nome da função do banco que renova. */
export const FUNCAO_DE_RENOVACAO = "renovar_orcamento_vencido";

/**
 * Expirado que já foi enviado, ou enviado que passou da validade. Orçamento sem valor não vale reenviar, e
 * expirado que nunca foi enviado (sem `enviado_em`) não tem o que renovar. "Passou da validade" é a mesma régua
 * do link do cliente e da função do banco: dia de Brasília, e o último dia vale inteiro.
 */
export function podeRenovar(o: OrcamentoRenovavel, agora: Date): boolean {
  if (!(Number(o.valor_total ?? 0) > 0)) return false;
  if (o.status === "expirado") return !!o.enviado_em;
  if (o.status !== "enviado") return false;
  if (!(Number(o.validade_dias ?? 0) > 0)) return false;
  const ate = validoAteDoLink({ enviado_em: o.enviado_em, created_at: o.created_at, validade_dias: o.validade_dias });
  return !!ate && diaEmBrasilia(agora) > ate;
}

/** Os argumentos da função do banco. */
export function argumentosDaRenovacao(orcamentoId: string): { p_orcamento_id: string } {
  return { p_orcamento_id: orcamentoId };
}
