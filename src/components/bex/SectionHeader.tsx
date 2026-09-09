import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";

/** Barra de cabeçalho da tela: caminho, título e ações. */
export function SectionHeader({
  breadcrumb,
  title,
  description,
  ajuda,
  actions,
  className,
}: {
  breadcrumb?: string;
  title: string;
  description?: string;
  /** Explicação do que a tela faz, mostrada no "?" ao lado do título. */
  ajuda?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border pb-4 mb-6",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <DicaIcone texto={ajuda} rotulo={title} lado="bottom" className="h-5 w-5" />
        </div>
        {breadcrumb && (
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {breadcrumb}
          </p>
        )}
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}
