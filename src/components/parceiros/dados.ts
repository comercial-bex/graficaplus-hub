/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MetricaDaMeta } from "@/domain/parceiros/painel";

/**
 * Leituras compartilhadas pelas abas da gestão de parceiros.
 *
 * As tabelas do módulo não estão nos tipos gerados (migração aplicada à mão),
 * por isso o `as any` — os nomes de coluna abaixo foram conferidos no banco.
 */

export type Nivel = {
  id: string;
  nome: string;
  ordem: number;
  compra_minima_90d: number;
  desconto_pct: number;
  desconto_faixa_pct: number;
  cashback_pct: number;
  cor: string;
  beneficios: string[];
};

export function useNiveis() {
  return useQuery({
    queryKey: ["parceiros-niveis"],
    queryFn: async (): Promise<Nivel[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_niveis")
        .select("id, nome, ordem, compra_minima_90d, desconto_pct, desconto_faixa_pct, cashback_pct, cor, beneficios")
        .order("ordem");
      if (error) throw error;
      return (data ?? []).map((n: any) => ({
        ...n,
        compra_minima_90d: Number(n.compra_minima_90d),
        desconto_pct: Number(n.desconto_pct),
        desconto_faixa_pct: Number(n.desconto_faixa_pct),
        cashback_pct: Number(n.cashback_pct),
        beneficios: n.beneficios ?? [],
      }));
    },
  });
}

const PAPEIS_DA_EQUIPE = ["admin", "gestor", "financeiro", "vendedor", "designer", "operador", "estoque", "instalador"];

export type PessoaDaEquipe = { id: string; nome: string | null; email: string | null };

/**
 * Quem pode ser atendente de parceiro. Quando o perfil não lê os papéis, a lista
 * vem inteira — o banco recusa na hora de salvar quem não for da equipe.
 */
export function useEquipe() {
  return useQuery({
    queryKey: ["parceiros-equipe"],
    queryFn: async (): Promise<PessoaDaEquipe[]> => {
      const [usuarios, papeis] = await Promise.all([
        supabase.from("usuarios").select("id, nome, email").eq("ativo", true).order("nome"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const lista = (usuarios.data ?? []) as PessoaDaEquipe[];
      const daEquipe = new Set(
        ((papeis.data ?? []) as { user_id: string; role: string }[])
          .filter((p) => PAPEIS_DA_EQUIPE.includes(p.role))
          .map((p) => p.user_id),
      );
      return daEquipe.size > 0 ? lista.filter((u) => daEquipe.has(u.id)) : lista;
    },
    staleTime: 5 * 60_000,
  });
}

export type ProdutoSimples = { id: string; nome: string; unidade: string; categoria: string | null };

export function useProdutosAtivos() {
  return useQuery({
    queryKey: ["parceiros-produtos"],
    queryFn: async (): Promise<ProdutoSimples[]> => {
      const { data, error } = await (supabase as any)
        .from("produtos_operacional")
        .select("id, nome, unidade, categoria")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ProdutoSimples[];
    },
    staleTime: 5 * 60_000,
  });
}

export type CampanhaDaGestao = {
  id: string;
  titulo: string;
  descricao: string | null;
  metrica: MetricaDaMeta;
  meta: number;
  inicio: string;
  fim: string;
  recompensa_tipo: "credito" | "produto" | "brinde";
  recompensa_valor: number | null;
  recompensa_descricao: string;
  nivel_minimo_id: string | null;
  ativa: boolean;
};

export type OfertaDaGestao = {
  id: string;
  titulo: string;
  mensagem: string;
  produto_id: string | null;
  preco_oferta: number | null;
  inicio: string;
  fim: string;
  exibir_popup: boolean;
  nivel_minimo_id: string | null;
  ativa: boolean;
};

export const ROTULO_DA_METRICA: Record<MetricaDaMeta, string> = {
  valor_compras: "Valor comprado (R$)",
  metragem_compras: "Metragem comprada (m²)",
  quantidade_pedidos: "Quantidade de pedidos",
};

/** "2026-09-16" de hoje no fuso de quem usa — para campos <input type="date">. */
export function hojeIso(somaDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + somaDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
