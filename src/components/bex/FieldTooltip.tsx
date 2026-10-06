import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";

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
      <DicaIcone texto={hint} rotulo={label} />
    </div>
  );
}
