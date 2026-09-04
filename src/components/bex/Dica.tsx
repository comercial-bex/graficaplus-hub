import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Dica de ajuda em português usada em todo o sistema.
 *
 * `Dica` embrulha qualquer elemento (botão, ícone, linha) e mostra a
 * explicação ao passar o mouse. O <span> ao redor é necessário porque botão
 * desabilitado não dispara eventos de mouse — sem ele, justamente a dica que
 * explica o bloqueio nunca apareceria.
 */
export function Dica({
  texto,
  children,
  lado = "top",
  className,
}: {
  texto?: string | null;
  children: React.ReactNode;
  lado?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  if (!texto) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent side={lado} className="max-w-xs text-xs leading-relaxed">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Ícone de interrogação com a explicação. Use ao lado de títulos e rótulos
 * que já existem, quando não dá para embrulhar o elemento inteiro.
 */
export function DicaIcone({
  texto,
  lado = "top",
  rotulo,
  className,
}: {
  texto?: string | null;
  lado?: "top" | "right" | "bottom" | "left";
  rotulo?: string;
  className?: string;
}) {
  if (!texto) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={rotulo ? `Ajuda: ${rotulo}` : "Ajuda"}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[color:var(--bex-cyan)]",
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={lado} className="max-w-xs text-xs leading-relaxed">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}
