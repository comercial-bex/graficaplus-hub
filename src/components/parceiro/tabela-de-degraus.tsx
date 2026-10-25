import { cn } from "@/lib/utils";
import { brl } from "@/domain/parceiros/preco";
import type { Degrau } from "@/domain/parceiros/degraus";

/**
 * Os degraus de quantidade do produto, como a tabela das lojas online: clicar
 * numa linha põe aquela quantidade no item. O preço de VENDA do parceiro não
 * muda — é dele —; só a quantidade.
 */
export function TabelaDeDegraus({
  degraus,
  unidade,
  desabilitado,
  onEscolher,
}: {
  degraus: Degrau[];
  unidade: string;
  desabilitado: boolean;
  onEscolher: (quantidade: number) => void;
}) {
  if (degraus.length === 0) return null;
  return (
    <div className="space-y-1.5 md:col-span-2" data-testid="tabela-de-degraus">
      <p className="text-xs text-muted-foreground">
        Quanto mais, mais barato para você ({unidade})
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
        {degraus.map((d) => (
          <li key={d.quantidadeMinima}>
            <button
              type="button"
              disabled={desabilitado}
              aria-pressed={d.atual}
              onClick={() => onEscolher(d.quantidadeMinima)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                d.atual ? "bg-primary/10" : "hover:bg-muted disabled:hover:bg-transparent",
              )}
            >
              <span className={cn("tabular-nums", d.atual && "font-semibold")}>
                a partir de {d.quantidadeMinima.toLocaleString("pt-BR")}
              </span>
              <span className="flex items-center gap-2">
                {d.economiaPct !== null && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium">
                    −{d.economiaPct}%
                  </span>
                )}
                <span className={cn("tabular-nums", d.atual && "font-semibold")}>
                  {brl(d.precoParceiro)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
