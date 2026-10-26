import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import type { CompraNoFornecedor, MaterialDoCadastro } from "@/domain/fornecedores/compras";

export type Fornecedor = {
  id: string;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  site: string | null;
  endereco: string | null;
  categorias: string[];
  observacoes: string | null;
  ativo: boolean;
};

export const CHAVE_DOS_FORNECEDORES = ["fornecedores"] as const;
export const CHAVE_DAS_COMPRAS = ["compras-no-fornecedor"] as const;

const COLUNAS_DO_FORNECEDOR = "id, nome, razao_social, cnpj, telefone, email, site, endereco, categorias, observacoes, ativo";

export async function buscarFornecedores(): Promise<Fornecedor[]> {
  const { data, error } = await (supabase as any)
    .from("fornecedores")
    .select(COLUNAS_DO_FORNECEDOR)
    .order("nome");
  if (error) throw error;
  return (data ?? []) as Fornecedor[];
}

/** Documentos de todos os fornecedores, com os itens. Numeric chega como texto do PostgREST: vira número aqui. */
export async function buscarComprasNoFornecedor(): Promise<CompraNoFornecedor[]> {
  const { data, error } = await (supabase as any)
    .from("compras_fornecedor")
    .select(
      "id, fornecedor_id, documento, tipo, data_operacao, comprador_nome, comprador_cnpj, codigo_cliente, forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, devolve_compra_id, observacoes, fonte, itens:compras_fornecedor_itens(id, ordem, codigo, descricao, unidade, quantidade, preco_lista, desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material)",
    )
    .order("data_operacao", { ascending: false });
  if (error) throw error;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return ((data ?? []) as any[]).map((d) => ({
    ...d,
    total_bruto: Number(d.total_bruto),
    desconto: Number(d.desconto),
    total: Number(d.total),
    itens: ((d.itens ?? []) as any[])
      .map((i) => ({
        ...i,
        quantidade: Number(i.quantidade),
        preco_lista: num(i.preco_lista),
        desconto_pct: num(i.desconto_pct),
        preco_unitario: Number(i.preco_unitario),
        total: Number(i.total),
        rende_do_material: num(i.rende_do_material),
      }))
      .sort((a, b) => a.ordem - b.ordem),
  })) as CompraNoFornecedor[];
}

/**
 * Só os materiais que aparecem nas compras, para comparar o preço pago com o
 * custo do cadastro. Custo de material só se lê pela visão financeira — a
 * tabela crua recusa a consulta inteira. Quem cuida de compras sem
 * financeiro.read vê o nome, sem o custo.
 */
export async function buscarMateriaisDasCompras(ids: string[], veCusto: boolean): Promise<MaterialDoCadastro[]> {
  if (ids.length === 0) return [];
  const { data, error } = await fromFinancialView("materiais", veCusto)
    .select(veCusto ? "id, nome, unidade, custo_medio, custo_unitario" : "id, nome, unidade")
    .in("id", ids);
  if (error) throw error;
  return ((data ?? []) as any[]).map((m) => ({
    id: m.id,
    nome: m.nome,
    unidade: m.unidade,
    custo_medio: m.custo_medio == null ? null : Number(m.custo_medio),
    custo_unitario: m.custo_unitario == null ? null : Number(m.custo_unitario),
  }));
}
