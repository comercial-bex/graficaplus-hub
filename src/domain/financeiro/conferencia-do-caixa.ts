/**
 * Conferência do caixa (Fase 2A, 16/11/2026): o que está pago sem prova ou sem origem, e o que no
 * extrato importado não parece lançamento de verdade. Só aponta; nada aqui grava.
 *
 * "Conta de origem" de uma conta paga = a saída que o pagamento lançou no caixa (origem
 * 'conta_pagar') com a conta bancária preenchida. Dinheiro / caixa físico é origem também: vem
 * na forma de pagamento, sem conta bancária.
 */

export interface ContaPagaParaConferir {
  id: string;
  descricao: string;
  fornecedor: string | null;
  valor: number | string;
  vencimento: string;
  data_pagamento: string | null;
  status: string;
  forma_pagamento: string | null;
  comprovante_url: string | null;
  compromisso_id: string | null;
}

export interface SaidaDaConta {
  conta_pagar_id: string | null;
  conta_id: string | null;
  origem: string | null;
}

export interface AnexoDaConferencia {
  conta_pagar_id: string;
  tipo: string;
}

export interface LinhaDoExtrato {
  id: string;
  conta_id: string | null;
  data: string;
  descricao: string | null;
  valor: number | string;
  tipo: string | null;
}

export type MotivoSemOrigem = "sem_saida_no_caixa" | "saida_sem_conta";

export interface ConferenciaDasContas {
  semOrigem: { conta: ContaPagaParaConferir; motivo: MotivoSemOrigem }[];
  semComprovante: ContaPagaParaConferir[];
  semData: ContaPagaParaConferir[];
  saidaRepetida: { conta: ContaPagaParaConferir; saidas: number }[];
}

const ehDinheiro = (forma: string | null) => (forma ?? "").trim().toLowerCase() === "dinheiro";

export function conferirContasPagas(
  contas: readonly ContaPagaParaConferir[],
  saidas: readonly SaidaDaConta[],
  anexos: readonly AnexoDaConferencia[],
): ConferenciaDasContas {
  const saidasDa = new Map<string, SaidaDaConta[]>();
  for (const s of saidas) {
    if (!s.conta_pagar_id || s.origem !== "conta_pagar") continue;
    const lista = saidasDa.get(s.conta_pagar_id) ?? [];
    lista.push(s);
    saidasDa.set(s.conta_pagar_id, lista);
  }
  const comComprovante = new Set(
    anexos.filter((a) => a.tipo === "comprovante").map((a) => a.conta_pagar_id),
  );

  const r: ConferenciaDasContas = {
    semOrigem: [],
    semComprovante: [],
    semData: [],
    saidaRepetida: [],
  };
  for (const c of contas) {
    if (c.status !== "paga") continue;
    const minhas = saidasDa.get(c.id) ?? [];
    if (!ehDinheiro(c.forma_pagamento) && !minhas.some((s) => s.conta_id)) {
      r.semOrigem.push({
        conta: c,
        motivo: minhas.length === 0 ? "sem_saida_no_caixa" : "saida_sem_conta",
      });
    }
    if (!comComprovante.has(c.id) && !(c.comprovante_url ?? "").trim()) r.semComprovante.push(c);
    if (!c.data_pagamento) r.semData.push(c);
    if (minhas.length > 1) r.saidaRepetida.push({ conta: c, saidas: minhas.length });
  }
  return r;
}

export const FRASE_DO_MOTIVO: Record<MotivoSemOrigem, string> = {
  sem_saida_no_caixa: "Paga sem saída no caixa",
  saida_sem_conta: "Saída no caixa sem conta bancária",
};

/**
 * O extrato do Itaú traz o saldo do fim do dia como se fosse lançamento ("SALDO TOTAL DISPONÍVEL
 * DIA"); importado, ele vira crédito e infla o saldo. Também aponta linhas idênticas na mesma conta
 * e no mesmo dia (mesmo valor, tipo e descrição): podem ser dois Pix iguais legítimos, ou cópia.
 */
const PARECE_SALDO = /^\s*(saldo|sdo)\b/i;

export interface SuspeitasDoExtrato {
  saldoDoDia: LinhaDoExtrato[];
  repetidas: { chave: string; linhas: LinhaDoExtrato[] }[];
}

export function linhasSuspeitasDoExtrato(linhas: readonly LinhaDoExtrato[]): SuspeitasDoExtrato {
  const saldoDoDia: LinhaDoExtrato[] = [];
  const grupos = new Map<string, LinhaDoExtrato[]>();
  for (const l of linhas) {
    if (PARECE_SALDO.test(l.descricao ?? "")) {
      saldoDoDia.push(l);
      continue;
    }
    const chave = [
      l.conta_id ?? "",
      l.data,
      l.tipo ?? "",
      Number(l.valor).toFixed(2),
      (l.descricao ?? "").trim().toLowerCase(),
    ].join("|");
    const g = grupos.get(chave) ?? [];
    g.push(l);
    grupos.set(chave, g);
  }
  const repetidas = [...grupos.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([chave, g]) => ({ chave, linhas: g }))
    .sort((a, b) => a.linhas[0].data.localeCompare(b.linhas[0].data));
  saldoDoDia.sort((a, b) => a.data.localeCompare(b.data));
  return { saldoDoDia, repetidas };
}

export const somaDosValores = (itens: readonly { valor: number | string }[]) =>
  itens.reduce((s, i) => s + Math.abs(Number(i.valor) || 0), 0);
