import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Estado vivo do que falta no sistema, contado no banco.
 *
 * Existe porque o Bex Print sabia muita coisa e não contava para ninguém: em
 * 20/09/2026 os três orçamentos do sistema estavam sem uma única linha de
 * item, as duas OS não tinham material previsto e nenhum dos 17 materiais
 * jamais recebeu entrada. Cada um desses é um pedido que não anda — e nenhuma
 * tela dizia isso a quem podia resolver.
 *
 * A conta é feita uma vez, no banco, com o mesmo filtro para todo mundo. Cada
 * linha já vem com o rótulo de QUEM resolve, e o painel de cada papel filtra
 * por aí (ver `rotulosDoPapel` em `pendenciasGuia.ts`).
 *
 * Contas de valor só voltam para quem pode ver dinheiro — para os demais a
 * linha nem é devolvida pela função.
 */
export type Severidade = "critico" | "atencao" | "ok";

export interface Pendencia {
  chave: string;
  titulo: string;
  quantidade: number;
  total: number | null;
  severidade: Severidade;
  quem_resolve: string;
  o_que_fazer: string;
  link: string;
}

export function usePendencias() {
  return useQuery({
    queryKey: ["pendencias-do-sistema"],
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<Pendencia[]> => {
      // `as any` no nome da RPC: o types.ts é gerado pelo Lovable e ainda não
      // conhece funções aplicadas por migração. Mesmo escape do resto do projeto.
      const { data, error } = await (supabase.rpc as any)("pendencias_do_sistema");
      if (error) throw error;
      return (data ?? []) as Pendencia[];
    },
  });
}
