import { supabase } from "@/integrations/supabase/client";
import type { ContaLida, ParcelaLida } from "@/domain/relacionados/elos";

/**
 * As contas a receber, lidas pela MESMA função do banco que a tela "A receber" usa (`contas_a_receber`), para a faixa
 * "Relacionados" das fichas mostrar exatamente os mesmos números (o banco calcula `a_receber` e `vencido` com o "hoje" de
 * Macapá) em vez de refazer a conta no navegador. A função só responde a quem vê o financeiro (`can_see_financials`); quem
 * não vê nem chega aqui, porque a faixa só chama com `canSeeFinancials`.
 *
 * A função devolve a carteira inteira (hoje 39 contas); as fichas filtram por cliente ou por OS. Se a carteira crescer a
 * ponto de pesar, o passo seguinte é um filtro no banco, não aqui.
 */

type RpcSemTipo = (nome: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcSemTipo;

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parcela(bruta: unknown): ParcelaLida {
  const p = (bruta ?? {}) as Record<string, unknown>;
  return {
    numero: numero(p.numero),
    valor: numero(p.valor),
    vencimento: texto(p.vencimento),
    status: typeof p.status === "string" ? p.status : "prevista",
    atrasada: p.atrasada === true,
  };
}

export async function lerContasAReceber(): Promise<ContaLida[]> {
  const { data, error } = await rpc("contas_a_receber", { p_incluir_quitadas: true });
  if (error) throw error;
  const bruto = (data ?? {}) as { contas?: unknown };
  const contas = Array.isArray(bruto.contas) ? bruto.contas : [];
  return contas.map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    return {
      conta_id: String(x.conta_id ?? ""),
      cliente_id: texto(x.cliente_id),
      os_id: texto(x.os_id),
      recebido: numero(x.recebido),
      a_receber: numero(x.a_receber),
      vencido: numero(x.vencido),
      parcelas: Array.isArray(x.parcelas) ? x.parcelas.map(parcela) : [],
    };
  });
}
