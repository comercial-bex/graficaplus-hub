import { validadeDoOrcamento, type OrcamentoDoQuadro } from "@/domain/orcamentos/quadro";

/**
 * Renovar um orçamento que venceu (02/11/2026). O quadro mostra "venceu há N
 * dias" e a coluna Expirado, mas não dava o passo seguinte: o vendedor abria o
 * orçamento, trocava o status na mão e só então reenviava. Agora o cartão tem
 * "Renovar e reenviar": volta para Enviado com a validade contando de novo e
 * abre o orçamento para mandar ao cliente pelo botão de sempre.
 *
 * Nada aqui manda mensagem ao cliente: reenviar continua sendo um gesto
 * explícito na tela do orçamento, com o PDF e o link na frente de quem vende.
 */

export type OrcamentoRenovavel = Pick<OrcamentoDoQuadro, "status" | "enviado_em" | "validade_dias" | "valor_total">;

/** Expirado, ou enviado que passou da validade. Orçamento sem valor não vale reenviar. */
export function podeRenovar(o: OrcamentoRenovavel, agora: Date): boolean {
  if (!(Number(o.valor_total ?? 0) > 0)) return false;
  if (o.status === "expirado") return true;
  if (o.status !== "enviado") return false;
  const v = validadeDoOrcamento(o, agora);
  return !!v && v.dias < 0;
}

/** O que a renovação grava: volta a Enviado e a validade conta a partir de agora. */
export function camposDaRenovacao(agora: Date): { status: "enviado"; enviado_em: string } {
  return { status: "enviado", enviado_em: agora.toISOString() };
}
