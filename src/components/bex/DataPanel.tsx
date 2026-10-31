import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Moldura padrão das listas: barra de busca/filtros no topo, tabela no meio e
 * rodapé com a contagem de registros. Sólida, sem vidro: é lida em massa.
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
    <div
      className={cn(
        "overflow-hidden rounded-card border border-border bg-card shadow-card",
        className,
      )}
    >
      {temBarra && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3 md:p-4">
          {onBusca ? (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              {/* text-base no celular: abaixo de 16px o iOS dá zoom ao focar. */}
              <Input
                value={busca ?? ""}
                onChange={(e) => onBusca(e.target.value)}
                placeholder={placeholder}
                className="h-11 w-full rounded-full bg-background pl-10 text-base md:h-10 md:text-sm"
              />
            </div>
          ) : (
            <span />
          )}
          {filtros && <div className="flex flex-wrap items-center gap-2">{filtros}</div>}
        </div>
      )}
      {/* px-3 no celular: 48px de padding por célula (px-6) fazia a tabela de
          6 colunas rolar na horizontal em 375px. As células são de ui/table,
          por isso o ajuste entra pelo seletor aqui e o desktop fica igual. */}
      <div className="overflow-x-auto [&_th]:px-3 [&_td]:px-3 md:[&_th]:px-6 md:[&_td]:px-6">
        {children}
      </div>
      {rodape && (
        <div className="flex items-center justify-between border-t border-border p-3 md:p-4 text-xs md:text-[11px] text-muted-foreground">
          {rodape}
        </div>
      )}
    </div>
  );
}
