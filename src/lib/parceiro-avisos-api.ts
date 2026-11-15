/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { ehFuncaoAusente } from "./parceiro-api";
import type { DestinatarioAviso, PublicoAviso } from "@/domain/parceiros/avisos";
export type HistoricoAviso = {
  id: string;
  titulo: string;
  texto: string;
  publico: PublicoAviso;
  status: string;
  total: number;
  sairam: number;
  falharam: number;
  na_fila: number;
  cancelados: number;
  created_at: string;
};
export async function publicoAviso(publico: PublicoAviso): Promise<DestinatarioAviso[] | null> {
  const { data, error } = await (supabase.rpc as any)("parceiro_aviso_publico", {
    p_publico: publico,
  });
  if (error) {
    if (ehFuncaoAusente(error)) return null;
    throw error;
  }
  return (data ?? []).map((p: DestinatarioAviso) => ({ ...p, credito: Number(p.credito) }));
}
export async function historicoAvisos(): Promise<HistoricoAviso[] | null> {
  const { data, error } = await (supabase.rpc as any)("parceiro_aviso_historico");
  if (error) {
    if (ehFuncaoAusente(error)) return null;
    throw error;
  }
  return data ?? [];
}
export async function salvarAviso(
  titulo: string,
  texto: string,
  publico: PublicoAviso,
): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("parceiro_aviso_salvar", {
    p_titulo: titulo,
    p_texto: texto,
    p_publico: publico,
  });
  if (error) throw error;
  return data;
}
export async function enviarAviso(
  id: string,
  ids: string[],
): Promise<{
  enviados: { parceiro_id: string }[];
  recusados: { parceiro_id: string; motivo: string }[];
}> {
  const { data, error } = await (supabase.rpc as any)("parceiro_aviso_enviar", {
    p_aviso: id,
    p_ids: ids,
  });
  if (error) throw error;
  return data;
}
export async function validarParceiro(id: string, nota: string) {
  const { error } = await (supabase.rpc as any)("parceiro_validar", {
    p_parceiro: id,
    p_nota: nota,
  });
  if (error) throw error;
}
export async function preferenciaAvisos(id: string, sair: boolean) {
  const { error } = await (supabase.rpc as any)("parceiro_avisos_preferencia", {
    p_parceiro: id,
    p_sair: sair,
  });
  if (error) throw error;
}
export async function detalhesValidacao(
  id: string,
): Promise<{
  validado_em: string | null;
  validado_por: string | null;
  validacao_nota: string | null;
  nao_receber_avisos_em: string | null;
  comprovacao_url: string | null;
} | null> {
  const { data, error } = await (supabase as any)
    .from("parceiros")
    .select("validado_em,validado_por,validacao_nota,nao_receber_avisos_em,comprovacao_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (["42703", "PGRST204"].includes(error.code)) return null;
    throw error;
  }
  return data;
}
