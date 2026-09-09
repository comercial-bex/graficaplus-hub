import { cn } from "@/lib/utils";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

const toneMap: Record<Tone, string> = {
  cyan: "bg-[color:var(--bex-cyan)]/20 text-[color:var(--bex-cyan)] border-[color:var(--bex-cyan)]/30",
  magenta:
    "bg-[color:var(--bex-magenta)]/20 text-[color:var(--bex-magenta)] border-[color:var(--bex-magenta)]/30",
  lime: "bg-[color:var(--bex-amber)]/20 text-[color:var(--bex-amber)] border-[color:var(--bex-amber)]/30",
  amber:
    "bg-[color:var(--bex-amber)]/20 text-[color:var(--bex-amber)] border-[color:var(--bex-amber)]/30",
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
        "inline-flex items-center rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wide whitespace-nowrap",
        toneMap[tone] ?? toneMap.cyan,
        className,
      )}
    >
      {label}
    </span>
  );
}
