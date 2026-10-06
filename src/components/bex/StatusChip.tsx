import { cn } from "@/lib/utils";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

const toneMap: Record<Tone, string> = {
  cyan: "bg-[color:var(--bex-cyan)]/15 text-status-cyan border-[color:var(--bex-cyan)]/30",
  magenta:
    "bg-[color:var(--bex-magenta)]/15 text-status-magenta border-[color:var(--bex-magenta)]/30",
  lime: "bg-[color:var(--bex-lime)]/15 text-status-positive border-[color:var(--bex-lime)]/30",
  amber:
    "bg-[color:var(--bex-amber)]/15 text-status-amber border-[color:var(--bex-amber)]/30",
  muted: "bg-muted text-muted-foreground border-border",
};

/** Selo de status padronizado em todo o sistema. */
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
        // 11px no celular: o selo carrega o aviso mais importante do cartão
        // ("3 dias de atraso") e 9px em caixa alta não se lê a um braço de
        // distância na oficina. O desktop mantém a densidade de antes.
        "inline-flex items-center rounded border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap md:py-1 md:text-[9px]",
        toneMap[tone] ?? toneMap.cyan,
        className,
      )}
    >
      {label}
    </span>
  );
}
