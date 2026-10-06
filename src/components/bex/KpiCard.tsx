import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { DicaIcone } from "@/components/bex/Dica";

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
        "relative overflow-hidden rounded-lg border border-border border-l-4 bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        a.border,
        className,
      )}
    >
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <DicaIcone texto={hint} rotulo={label} />
          </div>
          {Icon && <Icon className={cn("h-4 w-4", a.text)} />}
        </div>
        <h3 className="mt-1 text-3xl font-extrabold text-foreground">{value}</h3>
        {delta && (
          <div className="mt-2 flex items-center gap-2">
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", a.text)}>
              {delta}
            </span>
          </div>
        )}
      </div>
      <div className={cn("absolute -mt-10 -mr-10 top-0 right-0 h-24 w-24 rounded-full", a.glow)} />
    </div>
  );
}
