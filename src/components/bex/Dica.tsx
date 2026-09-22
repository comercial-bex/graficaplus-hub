import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type Lado = "top" | "right" | "bottom" | "left";

/**
 * Dica de ajuda em português usada em todo o sistema.
 *
 * `Dica` embrulha qualquer elemento (botão, ícone, linha) e mostra a
 * explicação ao passar o mouse. O <span> ao redor é necessário porque botão
 * desabilitado não dispara eventos de mouse — sem ele, justamente a dica que
 * explica o bloqueio nunca apareceria.
 *
 * No celular o Tooltip não abre no toque, mas o <span> não intercepta nada:
 * o Radix só escuta os eventos e deixa o clique chegar ao filho. Para ajuda
 * que precise existir no celular, use `DicaIcone`.
 */
export function Dica({
  texto,
  children,
  lado = "top",
  className,
}: {
  texto?: string | null;
  children: React.ReactNode;
  lado?: Lado;
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
 *
 * Desktop: Tooltip ao passar o mouse. Celular: Popover ao toque, porque o
 * Tooltip nunca abre no dedo — e o botão cresce para 32px para dar alvo.
 */
export function DicaIcone({
  texto,
  lado = "top",
  rotulo,
  className,
}: {
  texto?: string | null;
  lado?: Lado;
  rotulo?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  if (!texto) return null;

  const ariaLabel = rotulo ? `Ajuda: ${rotulo}` : "Ajuda";

  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            aria-label={ariaLabel}
            // O toque na ajuda não pode abrir o cartão/linha que está por trás.
            onClick={(e) => e.stopPropagation()}
            // Tamanho por último: quem chama passa "h-5 w-5" para o desktop e
            // isso não pode encolher o alvo de toque no celular.
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:text-[color:var(--bex-cyan)]",
              className,
              "h-8 w-8",
            )}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={lado}
          collisionPadding={16}
          className="max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed"
        >
          {texto}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label={ariaLabel}
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
