import { Badge } from "@/components/ui/badge";
import { dataBr, type FaturaDeConsumo } from "@/domain/financeiro/contas-de-consumo";

/** Paga (com a data), cancelada, vencida ou em aberto: a situação da conta a pagar da fatura. */
export function SituacaoDaFatura({ fatura, hoje }: { fatura: FaturaDeConsumo; hoje: string }) {
  const c = fatura.contas_pagar;
  if (!c) return <Badge variant="secondary">sem conta</Badge>;
  if (c.status === "paga")
    return (
      <Badge variant="secondary">
        paga{c.data_pagamento ? ` em ${dataBr(c.data_pagamento)}` : " sem data"}
      </Badge>
    );
  if (c.status === "cancelada") return <Badge variant="secondary">cancelada</Badge>;
  return c.vencimento < hoje ? (
    <Badge variant="destructive">vencida em {dataBr(c.vencimento)}</Badge>
  ) : (
    <Badge variant="outline">em aberto, vence {dataBr(c.vencimento)}</Badge>
  );
}
