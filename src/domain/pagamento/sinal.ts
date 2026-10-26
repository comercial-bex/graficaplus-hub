import { lerCondicao, parcelasDoOrcamento } from "@/domain/orcamentos/acordo";

/**
 * O sinal em Pix que vai junto com o orçamento (decisão do dono, 27/10/2026).
 *
 * Pagamento combinado em Pix (ou ainda sem forma): o envio do orçamento já manda a chave, o
 * QR Code com o valor e pede o comprovante de volta. Parcelado, o sinal é a 1ª parcela; à vista,
 * 50% na entrada e 50% na entrega — a condição geral da gráfica. Combinado em cartão, dinheiro
 * ou outra forma, nada de Pix. Domínio puro.
 */
export function pedidoDeSinal(a: {
  total: number;
  condicao: unknown;
  chaveConfigurada: boolean;
}): { enviar: boolean; valor: number; parcelas: number; motivo: string | null } {
  if (!a.chaveConfigurada) return { enviar: false, valor: 0, parcelas: 1, motivo: "sem chave Pix cadastrada" };
  const total = Number(a.total) || 0;
  if (total <= 0) return { enviar: false, valor: 0, parcelas: 1, motivo: "orçamento sem valor" };
  const c = lerCondicao(a.condicao);
  const forma = String(c.forma ?? "").trim().toLowerCase();
  if (forma && forma !== "pix") return { enviar: false, valor: 0, parcelas: 1, motivo: `pagamento combinado em ${c.forma}` };
  const recebido = (a.condicao as { pix_recebido?: { valor?: unknown } } | null)?.pix_recebido;
  if (recebido && Number(recebido.valor) > 0) return { enviar: false, valor: 0, parcelas: 1, motivo: "Pix já recebido" };
  const parcelas = Math.max(1, Math.round(Number(c.parcelas ?? 1) || 1));
  const valor =
    parcelas > 1
      ? (parcelasDoOrcamento(total, { ...c, parcelas })[0]?.valor ?? total)
      : Math.round(total * 50) / 100;
  return { enviar: valor > 0, valor, parcelas, motivo: null };
}

/** A frase que explica o que é o valor pedido. */
export function notaDoSinal(parcelas: number): string {
  return parcelas > 1
    ? `É a 1ª de ${parcelas} parcelas.`
    : "É o sinal de 50% para a peça entrar na produção; o restante fica para a entrega.";
}
