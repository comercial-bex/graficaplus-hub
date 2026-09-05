import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Moldura padrão das listas: barra de busca/filtros no topo, tabela no meio e
 * rodapé com a contagem de registros.
 */
export function DataPanel({
  busca,
  onBusca,
  placeholder = "Buscar...",
  filtros,
  rodape,
  children,
  className,
}: {
  busca?: string;
  onBusca?: (v: string) => void;
  placeholder?: string;
  filtros?: ReactNode;
  rodape?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const temBarra = onBusca !== undefined || filtros !== undefined;
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-2xl", className)}>
      {temBarra && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          {onBusca ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={busca ?? ""}
                onChange={(e) => onBusca(e.target.value)}
                placeholder={placeholder}
                className="h-9 w-64 bg-background pl-9 text-xs"
              />
            </div>
          ) : (
            <span />
          )}
          {filtros && <div className="flex flex-wrap items-center gap-2">{filtros}</div>}
        </div>
      )}
      <div className="overflow-x-auto">{children}</div>
      {rodape && (
        <div className="flex items-center justify-between border-t border-border p-4 text-[11px] text-muted-foreground">
          {rodape}
        </div>
      )}
    </div>
  );
}
