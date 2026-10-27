/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MetaDoMes } from "@/domain/metas/progresso";

/**
 * As metas de venda de cada pessoa no mês (`meta_painel()`): a soma delas é a META GERAL do mês
 * (R$ 40 mil em out/2026: 10 + 20 + 10). Um hook só para o card "Meta do mês" e o bloco "Metas da
 * equipe" lerem a mesma consulta (mesma chave) e nunca mostrarem metas diferentes.
 *
 * A RPC é mais estrita que a tela (admin, gestor ou financeiro.read): negada, a consulta falha e
 * quem usa cai no ponto de equilíbrio, sem desenhar zero.
 */
export function useMetasDaEquipe(habilitado: boolean) {
  return useQuery({
    queryKey: ["meta-painel", "painel-inicial"],
    enabled: habilitado,
    refetchInterval: 120_000,
    retry: false,
    queryFn: async (): Promise<MetaDoMes[]> => {
      const { data: d, error } = await (supabase.rpc as any)("meta_painel");
      if (error) throw error;
      return (d ?? []) as MetaDoMes[];
    },
  });
}

/** A meta geral é a soma das metas de cada pessoa; 0 quando ninguém tem meta no mês. */
export function metaGeralDaEquipe(metas: readonly { meta: number | string }[] | undefined): number {
  return (metas ?? []).reduce((t, m) => t + Number(m.meta ?? 0), 0);
}
