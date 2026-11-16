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
