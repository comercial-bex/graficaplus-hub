import type { QueryClient } from "@tanstack/react-query";

/**
 * Depois de qualquer movimento de dinheiro (baixa, pagamento marcado como pago,
 * estorno), o painel precisa reler: o dono dava baixa e o dashboard seguia com
 * o número de antes (24/10/2026). Toda tela que mexe em pagamento chama isto.
 */
export function invalidarPainelDoCaixa(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["dash-caixa"] });
  void qc.invalidateQueries({ queryKey: ["vw-dashboards"] });
  void qc.invalidateQueries({ queryKey: ["dashboard-operacional"] });
}
