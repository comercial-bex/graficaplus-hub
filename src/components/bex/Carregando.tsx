import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Carregando, com a forma do que vem (21/10/2026).
 *
 * Eram 73 "Carregando..." em texto solto: a tela piscava de uma palavra para o
 * conteúdo, e numa tela lenta parecia travada. O esqueleto ocupa o lugar do
 * conteúdo, o pulso diz que está vivo, e o leitor de tela ouve "Carregando…".
 * Quem pede menos movimento não vê o pulso (regra global em styles.css).
 */
export function Carregando({
  tela = false,
  linhas = 3,
  className,
}: {
  /** A tela inteira ainda não chegou: cabeçalho e blocos. */
  tela?: boolean;
  /** Quantas linhas de lista desenhar (fora do modo tela). */
  linhas?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn(tela ? "space-y-6 p-1" : "space-y-2 py-2", className)}>
      <span className="sr-only">Carregando…</span>
      {tela ? (
        <>
          <div className="space-y-2 border-b border-border pb-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </>
      ) : (
        Array.from({ length: linhas }, (_, i) => (
          <Skeleton key={i} className={cn("h-9", i === linhas - 1 && linhas > 1 && "w-2/3")} />
        ))
      )}
    </div>
  );
}
