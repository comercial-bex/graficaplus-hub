import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";

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
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 pb-6 border-b border-border mb-6",
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumb && (
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground mb-2">
            {breadcrumb}
          </div>
        )}
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-2xl md:text-3xl font-black tracking-tight text-foreground">
            {title}
          </h1>
          <DicaIcone texto={ajuda} rotulo={title} lado="bottom" className="h-5 w-5" />
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
    </header>
  );
}
