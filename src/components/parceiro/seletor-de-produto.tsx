import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { brl, unidadeLegivel, type ItemDoCatalogo } from "@/domain/parceiros/preco";

/** Destaque neutro: o amarelo padrão do item selecionado apaga a linha de preço em cinza. */
const ITEM_NEUTRO = "data-[selected=true]:bg-foreground/10 data-[selected=true]:text-foreground";

/** "R$ 63,00/m²" ou "a partir de 50 un: R$ 29,10" — o preço dele, sempre visível na escolha. */
export function precoCurto(p: ItemDoCatalogo): string {
  if (p.faixas && p.faixas.length > 0) {
    const f = p.faixas[0];
    return `a partir de ${f.quantidade_minima} ${unidadeLegivel(p.unidade)}: ${brl(f.preco_parceiro)}`;
  }
  return p.preco_parceiro === null ? "sem preço" : `${brl(p.preco_parceiro)}/${unidadeLegivel(p.unidade)}`;
}

/**
 * Escolhe um produto da tabela de parceiro — ou marca o item como livre.
 *
 * Item livre é o serviço do próprio parceiro (instalação, arte, frete): entra no
 * PDF dele com o preço dele e não vira pedido na gráfica.
 */
export function SeletorDeProduto({
  catalogo,
  produtoId,
  onEscolher,
  onItemLivre,
  desabilitado,
}: {
  catalogo: ItemDoCatalogo[];
  produtoId: string | null;
  onEscolher: (produto: ItemDoCatalogo) => void;
  onItemLivre: () => void;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const atual = produtoId ? catalogo.find((p) => p.produto_id === produtoId) : undefined;

  const grupos = useMemo(() => {
    const mapa = new Map<string, ItemDoCatalogo[]>();
    for (const p of catalogo) {
      const g = p.categoria || "Outros";
      mapa.set(g, [...(mapa.get(g) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [catalogo]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          disabled={desabilitado}
          // o hover padrão do botão é o amarelo de destaque, que apaga o texto cinza de dentro
          className="h-auto min-h-10 w-full justify-between py-2 text-left font-normal hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5"
        >
          <span className="min-w-0">
            {produtoId ? (
              <>
                <span className="block truncate font-medium">{atual?.nome ?? "Produto fora da tabela"}</span>
                {atual && <span className="block truncate text-xs text-muted-foreground">{precoCurto(atual)}</span>}
              </>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <PenLine className="h-4 w-4" /> Item livre (serviço seu)
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar produto da tabela…" />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty>Nenhum produto com esse nome.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                className={ITEM_NEUTRO}
                value="__item_livre__ item livre serviço instalação arte frete"
                onSelect={() => {
                  onItemLivre();
                  setAberto(false);
                }}
              >
                <PenLine className="mr-2 h-4 w-4" />
                <div>
                  <p>Item livre</p>
                  <p className="text-xs text-muted-foreground">Serviço seu: sai no PDF, não vira pedido</p>
                </div>
                {!produtoId && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            {grupos.map(([grupo, produtos]) => (
              <CommandGroup key={grupo} heading={grupo}>
                {produtos.map((p) => (
                  <CommandItem
                    className={ITEM_NEUTRO}
                    key={p.produto_id}
                    value={`${p.nome} ${grupo} ${p.produto_id}`}
                    onSelect={() => {
                      onEscolher(p);
                      setAberto(false);
                    }}
                  >
                    <div className="min-w-0">
                      <p className="truncate">{p.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {precoCurto(p)}
                        {p.origem === "oferta" && p.oferta_titulo ? ` · oferta: ${p.oferta_titulo}` : ""}
                      </p>
                    </div>
                    <Check className={cn("ml-auto h-4 w-4 shrink-0", produtoId === p.produto_id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
