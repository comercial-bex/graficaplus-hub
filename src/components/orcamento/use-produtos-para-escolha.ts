import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { useAuth } from "@/lib/auth-context";
import type { ProdutoDaEscolha } from "./escolha-de-produto";

/**
 * O catálogo e os três atalhos da escolha de produto: o que já está neste
 * orçamento, o que este cliente já comprou e o que a gráfica mais vende.
 *
 * As consultas vieram do seletor antigo (busca em lista). O catálogo vem da
 * view do nível de quem olha: a comercial traz preço de venda; a operacional,
 * nenhum valor. `select("*")` de propósito — cada view devolve só o que tem,
 * e pedir coluna que a view não tem derrubaria a consulta inteira.
 */
export function useProdutosParaEscolha({
  ativo,
  clienteId,
}: {
  /** Só consulta quando o formulário está na tela. */
  ativo: boolean;
  clienteId: string | null;
}) {
  const { nivelDeVisao } = useAuth();

  const catalogo = useQuery({
    queryKey: ["produtos-catalog-picker", nivelDeVisao],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await fromFinancialView("produtos", nivelDeVisao)
        .select("*")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ProdutoDaEscolha[];
    },
  });

  // Ranking simples: quantas vezes cada produto apareceu nos itens recentes.
  const maisUsados = useQuery({
    queryKey: ["produtos-mais-usados"],
    enabled: ativo,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("orcamento_itens")
        .select("produto_id, created_at")
        .not("produto_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(400);
      const contagem = new Map<string, number>();
      for (const linha of (data ?? []) as { produto_id: string }[]) {
        contagem.set(linha.produto_id, (contagem.get(linha.produto_id) ?? 0) + 1);
      }
      return [...contagem.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([produtoId]) => produtoId);
    },
  });

  const doCliente = useQuery({
    queryKey: ["produtos-do-cliente", clienteId],
    enabled: ativo && !!clienteId,
    queryFn: async () => {
      const { data: orcs } = await (supabase as any)
        .from("orcamentos")
        .select("id")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(20);
      const ids = ((orcs ?? []) as { id: string }[]).map((o) => o.id);
      if (ids.length === 0) return [] as string[];
      const { data } = await (supabase as any)
        .from("orcamento_itens")
        .select("produto_id")
        .in("orcamento_id", ids)
        .not("produto_id", "is", null);
      return [...new Set(((data ?? []) as { produto_id: string }[]).map((i) => i.produto_id))].slice(0, 6);
    },
  });

  return {
    produtos: catalogo.data ?? [],
    carregando: catalogo.isPending && ativo,
    erro: catalogo.error,
    tentarDeNovo: () => void catalogo.refetch(),
    maisUsados: (maisUsados.data ?? []) as string[],
    doCliente: (doCliente.data ?? []) as string[],
  };
}
