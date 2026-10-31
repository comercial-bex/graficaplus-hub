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
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold md:h-6 md:text-xs",
        toneMap[tone] ?? toneMap.cyan,
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
