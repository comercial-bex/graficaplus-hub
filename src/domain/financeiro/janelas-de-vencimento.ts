/**
 * Dinheiro a vencer por janela (31/10/2026), Onda 4 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`. Vem da função
 * `vencimentos_por_janela()`; aqui só se lê a resposta com cuidado: número que
 * chega como texto, nulo ou lixo vira zero, nunca NaN na tela.
 */

export interface JanelaDoDinheiro {
  /** O que já passou do dia e continua em aberto. */
  atrasado: number;
  hoje: number;
  amanha: number;
  /** De hoje até hoje + 6 (inclui hoje e amanhã). */
  dias7: number;
  /** De hoje até hoje + 29 (inclui as outras). */
  dias30: number;
}

export interface JanelasDeVencimento {
  /** Hoje no Brasil, como veio do banco (AAAA-MM-DD). */
  hoje: string | null;
  receber: JanelaDoDinheiro;
  pagar: JanelaDoDinheiro;
}

export const COLUNAS_DA_JANELA = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "amanha", rotulo: "Amanhã" },
  { chave: "dias7", rotulo: "7 dias" },
  { chave: "dias30", rotulo: "30 dias" },
] as const;

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const lerJanela = (bruto: unknown): JanelaDoDinheiro => {
  const j = (bruto ?? {}) as Record<string, unknown>;
  return { atrasado: num(j.atrasado), hoje: num(j.hoje), amanha: num(j.amanha), dias7: num(j.dias7), dias30: num(j.dias30) };
};

export function lerJanelas(bruto: unknown): JanelasDeVencimento {
  const r = (bruto ?? {}) as Record<string, unknown>;
  return {
    hoje: typeof r.hoje === "string" ? r.hoje : null,
    receber: lerJanela(r.receber),
    pagar: lerJanela(r.pagar),
  };
}
