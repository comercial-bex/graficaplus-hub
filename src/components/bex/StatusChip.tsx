import { cn } from "@/lib/utils";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

const toneMap: Record<Tone, string> = {
  cyan: "bg-chip-cyan text-chip-cyan-foreground",
  magenta: "bg-chip-magenta text-chip-magenta-foreground",
  lime: "bg-chip-positive text-chip-positive-foreground",
  amber: "bg-chip-warning text-chip-warning-foreground",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Selo de status padronizado em todo o sistema: pílula tingida com um ponto na
 * cor do estado e o texto em caixa baixa (pele de 31/10/2026).
 *
 * 13 px no celular: o selo carrega o aviso mais importante do cartão
 * ("3 dias de atraso") e letra menor não se lê a um braço de distância na
 * oficina (decisão de 21/10/2026). O computador fica em 12 px.
 */
export function StatusChip({
  label,
  tone = "cyan",
  compacto = false,
  className,
}: {
  label: string;
  tone?: Tone;
  /** Para cantos apertados (capa do cartão do quadro): 20 px de altura, 11 px de letra. */
  compacto?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // min-w-0 + max-w-full: dentro de um vizinho apertado o selo encolhe (o rótulo
        // ganha reticências) em vez de passar por cima do que está ao lado.
        "inline-flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full font-semibold",
        compacto ? "h-5 gap-1 px-1.5 text-[11px]" : "h-7 gap-1.5 px-2.5 text-[13px] md:h-6 md:text-xs",
        toneMap[tone] ?? toneMap.cyan,
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{label}</span>
    </span>
  );
}
