/**
 * Uma execução da fila (`automacao_execucoes`) em uma palavra e uma cor.
 *
 * O CHECK da tabela só tem quatro status — pendente, processando, sucesso,
 * erro —, e dois deles dizem mais de uma coisa:
 *
 *   pendente  pode estar AGENDADA (espera configurada, scheduled_at no futuro)
 *             ou PARADA (scheduled_at vencido há mais de 15 min: ninguém está
 *             consumindo a fila)
 *   erro      pode ser falha de envio ou CANCELAMENTO: desligar a automação
 *             fecha o que ela tinha na fila com erro 'Cancelada: …'
 *             (gatilho tg_automacao_desligada_cancela_fila, migração
 *             20261002103002 — alargar o CHECK pediria DROP CONSTRAINT)
 */

/** Pendente com horário vencido há mais que isto = fila parada. */
export const PARADA_APOS_MS = 15 * 60 * 1000;

/** O texto que o gatilho de desligar grava. Contrato com a migração. */
export const PREFIXO_CANCELADA = "Cancelada:";

export type ExecucaoResumo = {
  status: string;
  erro: string | null;
  scheduled_at: string | null;
};

export type Tom = "lime" | "cyan" | "amber" | "magenta" | "muted";

export function ehCancelamento(erro: string | null | undefined): boolean {
  return !!erro && erro.startsWith(PREFIXO_CANCELADA);
}

export function situacaoDaExecucao(
  e: ExecucaoResumo,
  agora: Date = new Date(),
): { rotulo: string; tom: Tom; detalhe: string | null } {
  if (e.status === "sucesso") return { rotulo: "Enviada", tom: "lime", detalhe: null };
  if (e.status === "processando") return { rotulo: "Enviando", tom: "cyan", detalhe: null };
  if (e.status === "erro") {
    if (ehCancelamento(e.erro)) return { rotulo: "Cancelada", tom: "muted", detalhe: e.erro };
    return { rotulo: "Falhou", tom: "magenta", detalhe: e.erro ?? "sem motivo registrado" };
  }
  if (e.status === "pendente") {
    const quando = e.scheduled_at ? new Date(e.scheduled_at).getTime() : NaN;
    if (Number.isFinite(quando) && quando > agora.getTime()) {
      return { rotulo: "Agendada", tom: "cyan", detalhe: null };
    }
    if (Number.isFinite(quando) && agora.getTime() - quando > PARADA_APOS_MS) {
      return {
        rotulo: "Parada na fila",
        tom: "amber",
        detalhe:
          "Ninguém processou ainda: confira o WhatsApp e o processador da fila no alto da tela.",
      };
    }
    return { rotulo: "Na fila", tom: "cyan", detalhe: null };
  }
  return { rotulo: e.status, tom: "muted", detalhe: null };
}
