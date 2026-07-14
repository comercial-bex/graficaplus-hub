import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Label com ícone de "?" que abre tooltip explicando o campo.
 * Usado no formulário de orçamento 3D — cada campo importante tem sua dica
 * com médias de mercado quando faz sentido.
 */
export function FieldTooltip({
  label,
  hint,
  required,
  className,
}: {
  label: string;
  hint: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Label className="text-sm">
        {label}
        {required && <span className="text-[color:var(--bex-magenta)] ml-0.5">*</span>}
      </Label>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Ajuda: ${label}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-[color:var(--bex-cyan)] transition-colors"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="max-w-xs bg-popover text-popover-foreground border border-border text-xs leading-relaxed shadow-xl"
          >
            {hint}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
