import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Search, Star, History, Repeat } from "lucide-react";
import type { Produto } from "@/lib/produtos-catalogo";
import { categoriaLabel } from "@/lib/produtos-catalogo";

/**
 * Escolher o produto é o caminho principal de lançamento do item — por isso a
 * busca é larga e, antes mesmo de digitar, oferece três atalhos: o que a
 * gráfica mais vende, o que este cliente já comprou e o que já está neste
 * orçamento (para repetir com outra medida).
 */
export function OrcamentoProdutoPicker({
  clienteId,
  produtosNoOrcamento,
  onSelect,
}: {
  clienteId?: string | null;
  produtosNoOrcamento?: string[];
  onSelect: (p: Produto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const { canSeeFinancials } = useAuth();

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-catalog-picker", canSeeFinancials ? "financeiro" : "operacional"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await fromFinancialView("produtos", canSeeFinancials)
        .select("*")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Produto[];
    },
  });

  // Ranking simples: quantas vezes cada produto apareceu nos itens recentes.
  const { data: maisUsados = [] } = useQuery({
    queryKey: ["produtos-mais-usados"],
    enabled: open,
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

  const { data: doCliente = [] } = useQuery({
    queryKey: ["produtos-do-cliente", clienteId],
    enabled: open && !!clienteId,
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
      return [...new Set(((data ?? []) as { produto_id: string }[]).map((i) => i.produto_id))].slice(
        0,
        6,
      );
    },
  });

  const porId = new Map(produtos.map((p) => [p.id, p]));
  const resolver = (ids: string[]) =>
    ids.map((pid) => porId.get(pid)).filter((p): p is Produto => !!p);

  const escolher = (p: Produto) => {
    onSelect(p);
    setOpen(false);
    setBusca("");
  };

  const linha = (p: Produto, chave: string) => (
    <CommandItem
      key={chave}
      value={`${p.nome} ${p.sku ?? ""} ${p.descricao ?? ""} ${categoriaLabel(p.categoria)}`}
      onSelect={() => escolher(p)}
      className="flex items-start justify-between gap-2"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{p.nome}</div>
        <div className="text-xs text-muted-foreground flex gap-2">
          {p.sku && <span className="font-mono">{p.sku}</span>}
          <span>{categoriaLabel(p.categoria)}</span>
        </div>
      </div>
      <div className="text-right text-xs font-mono whitespace-nowrap">
        R$ {Number(p.preco_base ?? 0).toFixed(2)}
        <div className="text-muted-foreground">/{p.unidade}</div>
      </div>
    </CommandItem>
  );

  const semBusca = busca.trim().length === 0;
  const sugeridosCliente = resolver(doCliente as string[]);
  const sugeridosUsados = resolver(maisUsados as string[]).filter(
    (p) => !sugeridosCliente.some((c) => c.id === p.id),
  );
  const sugeridosOrcamento = resolver(produtosNoOrcamento ?? []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 text-muted-foreground font-normal"
        >
          <Search className="h-4 w-4" />
          Buscar produto do catálogo…
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[420px]"
        align="start"
      >
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="Nome, código ou categoria…"
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList className="max-h-[380px]">
            <CommandEmpty>Nenhum produto encontrado — pode digitar o item à mão.</CommandEmpty>

            {semBusca && sugeridosOrcamento.length > 0 && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1">
                    <Repeat className="h-3 w-3" /> Neste orçamento
                  </span>
                }
              >
                {sugeridosOrcamento.map((p) => linha(p, `orc-${p.id}`))}
              </CommandGroup>
            )}

            {semBusca && sugeridosCliente.length > 0 && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1">
                    <History className="h-3 w-3" /> Este cliente já comprou
                  </span>
                }
              >
                {sugeridosCliente.map((p) => linha(p, `cli-${p.id}`))}
              </CommandGroup>
            )}

            {semBusca && sugeridosUsados.length > 0 && (
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1">
                    <Star className="h-3 w-3" /> Mais vendidos
                  </span>
                }
              >
                {sugeridosUsados.map((p) => linha(p, `top-${p.id}`))}
              </CommandGroup>
            )}

            <CommandGroup heading="Catálogo">
              {produtos.map((p) => linha(p, p.id))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
