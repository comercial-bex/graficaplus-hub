import {
  descricaoDaCondicao,
  lerCondicao,
  modeloDaCondicao,
  parcelasDoOrcamento,
  valorDaEntrada,
} from "@/domain/orcamentos/acordo";

/**
 * O sinal em Pix que vai junto com o orçamento (decisão do dono, 27/10/2026).
 *
 * Pagamento combinado em Pix (ou ainda sem forma): o envio do orçamento já manda a chave, o
 * QR Code com o valor e pede o comprovante de volta. O valor é o que a condição combinou para a
 * aprovação (28/10/2026): à vista é o total; 50% + 50% e "entrada" é a entrada; parcelado é a 1ª
 * parcela. Acordo antigo sem modelo: parcelado é a 1ª parcela e parcela única pede 50% — a
 * condição geral da gráfica. Combinado em cartão, dinheiro ou outra forma, nada de Pix. Domínio puro.
 */
export function pedidoDeSinal(a: {
  total: number;
  condicao: unknown;
  chaveConfigurada: boolean;
}): { enviar: boolean; valor: number; parcelas: number; motivo: string | null; nota: string } {
  const nada = (motivo: string) => ({ enviar: false, valor: 0, parcelas: 1, motivo, nota: "" });
  if (!a.chaveConfigurada) return nada("sem chave Pix cadastrada");
  const total = Number(a.total) || 0;
  if (total <= 0) return nada("orçamento sem valor");
  const c = lerCondicao(a.condicao);
  const forma = String(c.forma ?? "").trim().toLowerCase();
  if (forma && forma !== "pix") return nada(`pagamento combinado em ${c.forma}`);
  const recebido = (a.condicao as { pix_recebido?: { valor?: unknown } } | null)?.pix_recebido;
  if (recebido && Number(recebido.valor) > 0) return nada("Pix já recebido");

  const parcelas = Math.max(1, Math.round(Number(c.parcelas ?? 1) || 1));
  const modelo = modeloDaCondicao(c);
  if (modelo && modelo !== "parcelado") {
    const valor = valorDaEntrada(total, c);
    if (valor <= 0) return nada("condição sem entrada: nada a pedir agora");
    return { enviar: true, valor, parcelas, motivo: null, nota: notaDoSinal(parcelas, descricaoDaCondicao(c, total)) };
  }
  const valor =
    parcelas > 1
      ? (parcelasDoOrcamento(total, { ...c, parcelas })[0]?.valor ?? total)
      : Math.round(total * 50) / 100;
  return { enviar: valor > 0, valor, parcelas, motivo: null, nota: notaDoSinal(parcelas) };
}

/**
 * A frase que explica o que é o valor pedido. Com a condição combinada (modelos de 28/10/2026)
 * ela repete o combinado; sem ela, o acordo antigo: 1ª de n parcelas ou o sinal de 50%.
 */
export function notaDoSinal(parcelas: number, condicao?: string | null): string {
  if (condicao) return `É o combinado no orçamento: ${condicao.charAt(0).toLowerCase()}${condicao.slice(1)}.`;
  return parcelas > 1
    ? `É a 1ª de ${parcelas} parcelas.`
    : "É o sinal de 50% para a peça entrar na produção; o restante fica para a entrega.";
}

/**
 * As mensagens do Pix no WhatsApp (27/10/2026), no desenho de uma operadora de telecom que o dono
 * achou boa: o QR Code, uma frase curta de apresentação e o código numa mensagem SOZINHA. Sozinho,
 * a pessoa segura o dedo na bolha e copia só o código, sem pegar texto junto.
 */
export function mensagensDoPix(a: {
  cliente?: string | null;
  valor: number;
  numeroDoOrcamento: number;
  empresa?: string | null;
  parcelas: number;
  /** A frase do combinado (`pedidoDeSinal().nota`); sem ela vale a do acordo antigo. */
  nota?: string | null;
  copiaECola: string;
}): { legendaDoQr: string; introducao: string; codigo: string } {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const primeiro = a.cliente?.trim() ? a.cliente.trim().split(/\s+/)[0] : null;
  return {
    legendaDoQr: `${primeiro ? `${primeiro}, o` : "O"} Pix do orçamento #${a.numeroDoOrcamento}${a.empresa ? ` da ${a.empresa}` : ""} é de ${brl(a.valor)}. Aponte a câmera do app do seu banco para o QR Code, ou copie o código na mensagem abaixo.`,
    introducao: `Segue o código Pix (copia e cola) 👇\n${a.nota || notaDoSinal(a.parcelas)}\nDepois de pagar, me manda o comprovante por aqui (foto ou PDF) que eu confiro e libero o seu pedido.`,
    codigo: a.copiaECola,
  };
}
