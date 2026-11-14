/**
 * A fila do gestor (14/11/2026).
 *
 * Cada "pedir ao gestor" fica registrado em `os_pedidos_ao_gestor` e a autorização
 * do gestor resolve o pedido no banco. Mesmo assim, o pedido pode perder o sentido
 * sem autorização nenhuma: a entrada foi paga, o preço foi revisto, a OS foi
 * cancelada. Por isso a fila só mostra o pedido cuja TRAVA ainda está de pé — a trava
 * é a verdade (`os_bloqueios_do_quadro`), o pedido só diz quem pediu e quando.
 */

export type AssuntoDoGestor = "atendimento" | "saldo_devedor" | "margem_baixa";

/** A trava que cada pedido quer destravar. */
export const TRAVA_DO_ASSUNTO: Record<AssuntoDoGestor, string> = {
  atendimento: "atendimento_nao_validado",
  saldo_devedor: "sem_pagamento",
  margem_baixa: "margem_baixa",
};

export const ROTULO_DO_ASSUNTO: Record<AssuntoDoGestor, string> = {
  atendimento: "Validar o atendimento",
  saldo_devedor: "Cliente vai ficar devendo",
  margem_baixa: "Margem abaixo do mínimo",
};

export type PedidoAoGestor = {
  id: string;
  os_id: string;
  assunto: AssuntoDoGestor;
  pedido_por: string;
  pedido_em: string;
};

type Travas = ReadonlyMap<string, readonly { codigo: string }[]>;

const temTrava = (travas: Travas, osId: string, codigo: string) =>
  (travas.get(osId) ?? []).some((t) => t.codigo === codigo);

/** Os pedidos que ainda valem (a trava continua), do mais antigo para o mais novo. */
export function filaDoGestor(pedidos: readonly PedidoAoGestor[], travas: Travas): PedidoAoGestor[] {
  return pedidos
    .filter((p) => TRAVA_DO_ASSUNTO[p.assunto] && temTrava(travas, p.os_id, TRAVA_DO_ASSUNTO[p.assunto]))
    .sort((a, b) => a.pedido_em.localeCompare(b.pedido_em));
}

/** As OS no Atendimento esperando validação sem que ninguém tenha pedido ainda. */
export function esperandoValidacaoSemPedido(pedidos: readonly PedidoAoGestor[], travas: Travas): string[] {
  const pedidas = new Set(pedidos.filter((p) => p.assunto === "atendimento").map((p) => p.os_id));
  return [...travas.keys()].filter((id) => temTrava(travas, id, "atendimento_nao_validado") && !pedidas.has(id));
}
