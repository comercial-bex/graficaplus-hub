import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * O que é opcional num item do orçamento, recolhido (20/10/2026).
 *
 * O formulário do item mostrava tudo de uma vez — tipo de produto, especificações,
 * artes — para todo produto, e o vendedor passava por campos que, na maioria dos
 * itens, nem precisa tocar: o tipo vem do produto escolhido. Aqui ficam fechados,
 * com um resumo do que já foi preenchido para nada ficar escondido sem aviso: quem
 * escreveu uma especificação vê "especificação" ao lado do título, mesmo fechado.
 */
export function DetalhesOpcionais({
  aberto,
  onMudar,
  preenchido,
  children,
}: {
  aberto: boolean;
  onMudar: (aberto: boolean) => void;
  /** O que já tem conteúdo ("especificação", "2 artes"): aparece mesmo com a seção fechada. */
  preenchido: string[];
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={aberto}
      onOpenChange={onMudar}
      className="rounded-lg border bg-muted/20"
      data-testid="detalhes-opcionais"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left sm:min-h-9",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">Detalhes opcionais</span>
            {preenchido.length === 0 ? (
              <span className="text-xs text-muted-foreground">tipo de produto, especificações e artes</span>
            ) : (
              preenchido.map((p) => (
                <span key={p} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {p}
                </span>
              ))
            )}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t p-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
