import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { recusaDoBanco } from "@/domain/financeiro/contas-a-pagar-anexos";
import type {
  FaturaDeConsumo,
  TipoDeConsumo,
  UnidadeDeConsumo,
} from "@/domain/financeiro/contas-de-consumo";

/**
 * Quem pode o quê nas contas de consumo. As mesmas regras que o banco cobra (20261116220000):
 *   cadastrar/editar unidade  admin ou gestor, pelo papel (RLS de unidades_consumo)
 *   lançar fatura             admin, ou financeiro.read E pagamentos.create (= "Nova conta a pagar")
 *   corrigir dados da fatura  admin, ou financeiro.read E (pagamentos.create ou .update)
 * Pagar a fatura é o "Confirmar pagamento" de sempre, com as regras dele.
 */
export function usePodeNasContasDeConsumo() {
  const { hasRole, hasPermission } = useAuth();
  const admin = hasRole("admin");
  const veFinanceiro = hasPermission("financeiro.read");
  return {
    podeCadastrarUnidade: admin || hasRole("gestor"),
    podeLancarFatura: admin || (veFinanceiro && hasPermission("pagamentos.create")),
    podeCorrigirDados:
      admin ||
      (veFinanceiro && (hasPermission("pagamentos.create") || hasPermission("pagamentos.update"))),
  };
}

export const CHAVES = {
  unidades: ["unidades-consumo"] as const,
  faturas: ["faturas-consumo"] as const,
  fornecedores: ["fornecedores-ativos"] as const,
  bancos: ["contas-bancarias-ativas"] as const,
};

export function useUnidadesDeConsumo() {
  return useQuery({
    queryKey: CHAVES.unidades,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("unidades_consumo")
        .select(
          "id, tipo, fornecedor_id, identificador, endereco, dia_vencimento, conta_bancaria_id, observacoes, ativo, fornecedores(nome, razao_social)",
        )
        .order("tipo")
        .order("identificador");
      if (error) throw error;
      return (data ?? []) as UnidadeDeConsumo[];
    },
  });
}

export function useFaturasDeConsumo() {
  return useQuery({
    queryKey: CHAVES.faturas,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("faturas_consumo")
        .select(
          "conta_pagar_id, unidade_id, competencia, consumo, bandeira_taxas, iluminacao_publica, numero_nf, contas_pagar(id, descricao, fornecedor, valor, vencimento, status, data_pagamento, comprovante_url)",
        )
        .order("competencia", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FaturaDeConsumo[];
    },
  });
}

export interface FornecedorDaLista {
  id: string;
  nome: string;
  razao_social: string | null;
}

export function useFornecedoresAtivos() {
  return useQuery({
    queryKey: CHAVES.fornecedores,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fornecedores")
        .select("id, nome, razao_social")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as FornecedorDaLista[];
    },
  });
}

export interface BancoDaLista {
  id: string;
  nome: string;
  banco: string | null;
}

export function useContasBancariasAtivas() {
  return useQuery({
    queryKey: CHAVES.bancos,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_bancarias")
        .select("id, nome, banco")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as BancoDaLista[];
    },
  });
}

export interface DadosDaUnidade {
  tipo: TipoDeConsumo;
  fornecedor_id: string;
  identificador: string;
  endereco: string | null;
  dia_vencimento: number | null;
  conta_bancaria_id: string | null;
  observacoes: string | null;
  ativo: boolean;
}

const RECUSA_DA_UNIDADE = "Só o administrador e o gestor cadastram ou editam unidade consumidora.";

/**
 * Grava a unidade direto na tabela: quem decide é a regra do banco (RLS). Edição que o banco filtra
 * volta com 0 linhas e nenhum erro; sem esta conferência a tela diria "salvo".
 */
export function useSalvarUnidade() {
  const { podeCadastrarUnidade } = usePodeNasContasDeConsumo();
  return useCallback(
    async (dados: DadosDaUnidade, id: string | null): Promise<string> => {
      if (!podeCadastrarUnidade) throw new Error(RECUSA_DA_UNIDADE);
      const tabela = (supabase as any).from("unidades_consumo");
      const { data, error } = id
        ? await tabela.update(dados).eq("id", id).select("id")
        : await tabela.insert(dados).select("id");
      if (error) {
        if (error.code === "42501") throw new Error(RECUSA_DA_UNIDADE);
        if (error.code === "23505")
          throw new Error("Esta unidade já está cadastrada para este fornecedor.");
        throw error;
      }
      const salva = (data as { id: string }[] | null)?.[0];
      if (!salva) throw new Error(`A unidade não foi salva. ${RECUSA_DA_UNIDADE}`);
      return salva.id;
    },
    [podeCadastrarUnidade],
  );
}

/** Fornecedor novo direto da unidade: o banco pede catalogo.manage (admin e gestor, os mesmos). */
export async function criarFornecedor(nome: string): Promise<string> {
  const { data, error } = await supabase
    .from("fornecedores")
    .insert({ nome: nome.trim(), categorias: ["servicos"] })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export interface PedidoDeFatura {
  unidadeId: string;
  competencia: string; // AAAA-MM-01
  vencimento: string;
  valor: number;
  consumo: number | null;
  bandeiraTaxas: number | null;
  iluminacaoPublica: number | null;
  numeroNf: string | null;
}

/** Cria a conta a pagar e a fatura numa chamada só; a duplicidade o banco recusa com a frase pronta. */
export function useLancarFatura() {
  const { podeLancarFatura } = usePodeNasContasDeConsumo();
  return useCallback(
    async (p: PedidoDeFatura): Promise<{ contaId: string; descricao: string }> => {
      if (!podeLancarFatura) throw new Error("Lançar fatura é com o financeiro.");
      const { data, error } = await (supabase.rpc as any)("lancar_fatura_consumo", {
        p_unidade_id: p.unidadeId,
        p_competencia: p.competencia,
        p_vencimento: p.vencimento,
        p_valor: p.valor,
        p_consumo: p.consumo,
        p_bandeira_taxas: p.bandeiraTaxas,
        p_iluminacao_publica: p.iluminacaoPublica,
        p_numero_nf: p.numeroNf,
      });
      if (error) throw error;
      const recusa = recusaDoBanco(data);
      if (recusa) throw new Error(recusa);
      const r = data as { conta_id?: string; descricao?: string } | null;
      if (!r?.conta_id) throw new Error("A fatura não foi lançada: o banco não devolveu a conta.");
      return { contaId: r.conta_id, descricao: r.descricao ?? "" };
    },
    [podeLancarFatura],
  );
}

export interface DadosDaFatura {
  consumo: number | null;
  bandeiraTaxas: number | null;
  iluminacaoPublica: number | null;
  numeroNf: string | null;
}

export function useCorrigirDadosDaFatura() {
  const { podeCorrigirDados } = usePodeNasContasDeConsumo();
  return useCallback(
    async (contaId: string, d: DadosDaFatura): Promise<void> => {
      if (!podeCorrigirDados) throw new Error("Corrigir os dados da fatura é com o financeiro.");
      const { data, error } = await (supabase.rpc as any)("corrigir_dados_fatura_consumo", {
        p_conta_pagar_id: contaId,
        p_consumo: d.consumo,
        p_bandeira_taxas: d.bandeiraTaxas,
        p_iluminacao_publica: d.iluminacaoPublica,
        p_numero_nf: d.numeroNf,
      });
      if (error) throw error;
      const recusa = recusaDoBanco(data);
      if (recusa) throw new Error(recusa);
    },
    [podeCorrigirDados],
  );
}
