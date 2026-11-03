/** Venda direta: o revendedor compra da gráfica, sem cliente final e sem PDF. */
export type PagamentoDaVendaDireta = "metade_metade" | "a_vista";

export const PAGAMENTOS_DA_VENDA_DIRETA: { chave: PagamentoDaVendaDireta; rotulo: string; detalhe: string }[] = [
  { chave: "metade_metade", rotulo: "Sinal (50%)", detalhe: "Metade agora, o restante na entrega." },
  { chave: "a_vista", rotulo: "À vista", detalhe: "O valor total agora." },
];

const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Quanto se paga agora e quanto fica para a entrega. */
export function valoresDoPagamento(total: number, modelo: PagamentoDaVendaDireta) {
  const t = arred(Number(total) || 0);
  const agora = modelo === "a_vista" ? t : arred(t * 0.5);
  return { agora, restante: arred(t - agora) };
}

export function situacaoDoPagamento(modelo: string | null | undefined): string {
  return modelo === "a_vista" ? "Pago" : "Parcial";
}
