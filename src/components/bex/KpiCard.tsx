import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

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
  tone?: "cyan" | "magenta" | "lime" | "muted";
  className?: string;
}) {
  const toneColor: Record<string, string> = {
    cyan: "text-[color:var(--bex-cyan)]",
    magenta: "text-[color:var(--bex-magenta)]",
    lime: "text-[color:var(--bex-lime)]",
    muted: "text-muted-foreground",
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border border-border bg-card p-5 transition-colors hover:border-border/80",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className={cn("h-4 w-4", toneColor[tone])} />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-black tracking-tight text-foreground">{value}</span>
        {delta && (
          <span className={cn("font-mono text-xs", toneColor[tone])}>{delta}</span>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-muted-foreground truncate">{hint}</div>
      )}
    </div>
  );
}
