/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { ehFuncaoAusente } from "./parceiro-api";
import type { LinhaSemContato } from "@/domain/parceiros/sem-contato";

export type ParceiroAtendimento = LinhaSemContato & {
  conversa_id: string | null;
  aberto_em: string;
  ultima_saida_equipe: string | null;
  ultima_entrada: string | null;
  sem_contato: boolean;
  comprou: boolean;
};

/** null = a migração 20261116150000 ainda não foi aplicada. */
export async function parceirosSemContato(): Promise<{
  horas: number;
  lista: ParceiroAtendimento[];
} | null> {
  const { data, error } = await (supabase.rpc as any)("parceiros_sem_contato");
  if (error) {
    if (ehFuncaoAusente(error)) return null;
    throw error;
  }
  return {
    horas: Number(data?.horas ?? 48),
    lista: (data?.lista ?? []).map((l: ParceiroAtendimento) => ({
      ...l,
      credito: Number(l.credito ?? 0),
    })),
  };
}

export type ResultadoDaReabertura = { reaberto: boolean; jaAberto: boolean; numero: string | null };

/**
 * Reabre o chamado do parceiro que foi fechado sem nenhuma mensagem da equipe (`parceiro_reabrir_chamado`, migração
 * 20261122600000). O banco confere quem pode e se o chamado merece ser reaberto, e devolve o que de fato aconteceu: a
 * tela só diz "reaberto" quando o banco disse `reaberto: true`.
 */
export async function reabrirChamadoDoParceiro(parceiroId: string): Promise<ResultadoDaReabertura> {
  const { data, error } = await (supabase.rpc as any)("parceiro_reabrir_chamado", { p_parceiro: parceiroId });
  if (error) {
    if (ehFuncaoAusente(error)) throw new Error("Reabrir chamado ainda não foi ativado no banco.");
    throw error;
  }
  const r = (data ?? {}) as { reaberto?: boolean; motivo?: string; numero?: string | null };
  if (r.reaberto === true) return { reaberto: true, jaAberto: false, numero: r.numero ?? null };
  if (r.motivo === "ja_aberto") return { reaberto: false, jaAberto: true, numero: null };
  throw new Error("O banco não confirmou a reabertura do chamado. Atualize a página e confira.");
}

/** null = coluna e_teste ainda não existe. */
export async function eContaDeTeste(id: string): Promise<boolean | null> {
  const { data, error } = await (supabase as any)
    .from("parceiros")
    .select("e_teste")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (["42703", "PGRST204"].includes(error.code)) return null;
    throw error;
  }
  return !!data?.e_teste;
}

export async function marcarContaDeTeste(id: string, teste: boolean) {
  const { error } = await (supabase.rpc as any)("parceiro_marcar_teste", {
    p_parceiro: id,
    p_teste: teste,
  });
  if (error) throw error;
}
