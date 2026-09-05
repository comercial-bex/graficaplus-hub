import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

const accent: Record<Tone, { border: string; text: string; glow: string }> = {
  cyan: {
    border: "border-l-[color:var(--bex-cyan)]",
    text: "text-[color:var(--bex-cyan)]",
    glow: "bg-[color:var(--bex-cyan)]/5",
  },
  magenta: {
    border: "border-l-[color:var(--bex-magenta)]",
    text: "text-[color:var(--bex-magenta)]",
    glow: "bg-[color:var(--bex-magenta)]/5",
  },
  lime: {
    border: "border-l-[color:var(--bex-amber)]",
    text: "text-[color:var(--bex-amber)]",
    glow: "bg-[color:var(--bex-amber)]/5",
  },
  amber: {
    border: "border-l-[color:var(--bex-amber)]",
    text: "text-[color:var(--bex-amber)]",
    glow: "bg-[color:var(--bex-amber)]/5",
  },
  muted: {
    border: "border-l-border",
    text: "text-muted-foreground",
    glow: "bg-foreground/5",
  },
};

/** Cartão de indicador: borda esquerda no acento, brilho circular e número em destaque. */
export function KpiCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  tone = "cyan",
  className,
}: {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  const a = accent[tone] ?? accent.cyan;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border border-l-4 bg-card p-5 shadow-lg",
        a.border,
        className,
      )}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {Icon && <Icon className={cn("h-4 w-4", a.text)} />}
        </div>
        <h3 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{value}</h3>
        {(delta || hint) && (
          <div className="mt-2 flex items-center gap-2">
            {delta && (
              <span className={cn("text-[10px] font-bold uppercase tracking-wide", a.text)}>
                {delta}
              </span>
            )}
            {hint && (
              <span className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {hint}
              </span>
            )}
          </div>
        )}
      </div>
      <div className={cn("absolute -mt-10 -mr-10 top-0 right-0 h-24 w-24 rounded-full", a.glow)} />
    </div>
  );
}
