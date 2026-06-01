import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Package } from "lucide-react";
import type { Produto } from "@/lib/produtos-catalogo";
import { categoriaLabel } from "@/lib/produtos-catalogo";

export function ProdutoAutocomplete({
  onSelect,
  label = "Catálogo",
}: {
  onSelect: (p: Produto) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-catalog-picker"],
    queryFn: async () => {
      const { data } = await supabase
        .from("produtos")
        .select("*")
        .eq("ativo", true)
        .order("nome");
      return (data ?? []) as unknown as Produto[];
    },
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <Package className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[420px]" align="start">
        <Command
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar por nome ou SKU…" />
          <CommandList>
            <CommandEmpty>Nenhum item</CommandEmpty>
            <CommandGroup>
              {produtos.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.nome} ${p.sku ?? ""} ${p.descricao ?? ""}`}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
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
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
