import { useQuery } from "@tanstack/react-query";
import { Sigma } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import type { FormulaDoProduto, LinhaDeFormula } from "@/domain/orcamentos/material-por-formula";
import { rotuloDaBase, type LinhaDeTerceirizado, type TerceirizadoDoProduto } from "@/domain/orcamentos/terceirizados";

/**
 * Material por fórmula no item do orçamento (fase 4 do plano de 02/11/2026).
 * As fórmulas vêm da aba Fórmulas da pasta do produto; aqui só aparece o que
 * entra, com a quantidade por peça. O custo em reais aparece para quem vê
 * custo; o banco é quem o grava.
 */

/** As fórmulas do produto, com o nome e a unidade do material. Só consulta com produto. */
export function useFormulasDoProduto(produtoId: string | null) {
  return useQuery({
    queryKey: ["produto-formulas", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<FormulaDoProduto[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_formulas")
        .select("id, material_id, script, descricao, material:material_id(nome, unidade)")
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as FormulaDoProduto[];
    },
  });
}

/** O custo de compra dos materiais, só para quem vê custo (a view financeira barra os demais). */
export function useCustoDosMateriais(ids: readonly string[], habilitado: boolean) {
  const chave = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["materiais-custo", chave],
    enabled: habilitado && ids.length > 0,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await fromFinancialView("materiais", "financeiro")
        .select("id, custo_medio, custo_unitario")
        .in("id", [...ids]);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Map(((data ?? []) as any[]).map((m) => [m.id as string, Number(m.custo_medio ?? m.custo_unitario ?? 0)]));
    },
  });
}

/**
 * Os terceirizados do produto (fase 3): valor é custo, então só quem vê custo
 * consulta (a RLS barra os demais; o gatilho do banco soma para todo mundo).
 */
export function useTerceirizadosDoProduto(produtoId: string | null, habilitado: boolean) {
  return useQuery({
    queryKey: ["produto-terceirizados", produtoId],
    enabled: habilitado && !!produtoId,
    queryFn: async (): Promise<TerceirizadoDoProduto[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("produto_terceirizados")
        .select("id, descricao, valor, base, fornecedor_id, fornecedor:fornecedor_id(nome)")
        .eq("produto_id", produtoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as TerceirizadoDoProduto[];
    },
  });
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function MaterialPorFormula({
  linhas,
  custo,
  terceirizados = [],
}: {
  linhas: readonly LinhaDeFormula[];
  /** Custo por peça das fórmulas válidas; nulo para quem não vê custo. */
  custo: { total: number; semCusto: string[] } | null;
  /** Os terceirizados do produto, por peça, já na medida do item (só quem vê custo recebe). */
  terceirizados?: readonly LinhaDeTerceirizado[];
}) {
  if (linhas.length === 0 && terceirizados.length === 0) return null;
  const titulo =
    linhas.length > 0 && terceirizados.length > 0
      ? "Material por fórmula e terceirizados"
      : linhas.length > 0
        ? "Material por fórmula"
        : "Terceirizados";
  return (
    <section className="space-y-2 rounded-lg border bg-muted/20 p-3" aria-label={titulo} data-testid="material-por-formula">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Sigma className="h-4 w-4 text-link" aria-hidden="true" />
        {titulo}
      </h3>
      {terceirizados.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="terceirizados-do-item">
          {terceirizados.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span>
                {t.descricao}
                {t.fornecedor && <span className="ml-1.5 text-xs text-muted-foreground">{t.fornecedor}</span>}
              </span>
              <span className="font-mono text-xs">
                {brl(t.valor)} {rotuloDaBase(t.base)} = {brl(t.porPeca)} por peça
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 text-sm">
        {linhas.map((l) => (
          <li key={l.formula_id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span>
              {l.nome}
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{l.script}</span>
            </span>
            {l.erro ? (
              <span className="text-xs text-destructive">{l.erro}</span>
            ) : (
              <span className="font-mono text-xs">
                {l.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} {l.unidade} por peça
              </span>
            )}
          </li>
        ))}
      </ul>
      {custo && (
        <p className="text-xs text-muted-foreground" data-testid="custo-das-formulas">
          Custo por peça:{" "}
          <strong className="font-mono text-foreground">
            {brl(custo.total + terceirizados.reduce((s, t) => s + t.porPeca, 0))}
          </strong>
          {custo.semCusto.length > 0 && ` · ${custo.semCusto.length === 1 ? "1 material" : `${custo.semCusto.length} materiais`} sem custo de compra`}
          . Entra no custo do item quando ele é salvo.
        </p>
      )}
    </section>
  );
}
