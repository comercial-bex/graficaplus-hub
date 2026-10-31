import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { DicaIcone } from "@/components/bex/Dica";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

/** Ícone num quadrado tingido e chip de variação, no tom do indicador. */
const tons: Record<Tone, string> = {
  cyan: "bg-chip-cyan text-chip-cyan-foreground",
  magenta: "bg-chip-magenta text-chip-magenta-foreground",
  lime: "bg-chip-positive text-chip-positive-foreground",
  amber: "bg-chip-warning text-chip-warning-foreground",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Cartão de indicador (pele de 31/10/2026): ícone em quadrado tingido, rótulo
 * em caixa baixa, número grande tabular e um chip com a variação. Sobe 2 px
 * no hover. `destaque` é o cartão herói da tela — de tinta, com a linha CMYK
 * no topo; use um só por tela.
 */
export function KpiCard({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  tone = "cyan",
  destaque = false,
  className,
}: {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  destaque?: boolean;
  className?: string;
}) {
  const tom = tons[tone] ?? tons.cyan;
  const tingido = destaque ? "bg-surface-hero-foreground/10 text-surface-hero-foreground" : tom;

  return (
    <div
      className={cn(
        "bex-sobe relative flex flex-col gap-3 overflow-hidden rounded-card border p-4 md:p-5",
        destaque
          ? "border-transparent bg-surface-hero text-surface-hero-foreground shadow-card"
          : "bex-vidro text-card-foreground",
        className,
      )}
    >
      {destaque && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: "var(--gradient-cmyk)" }}
        />
      )}
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
              tingido,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <p
          className={cn(
            // Quebra linha em vez de cortar: "WhatsApp nã…" no celular não diz nada.
            "min-w-0 text-[13px] font-semibold leading-snug",
            destaque ? "text-surface-hero-foreground/70" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        <DicaIcone texto={hint} rotulo={label} />
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="text-[1.75rem] font-bold leading-none tracking-tight tabular-nums md:text-[2rem]">
          {value}
        </h3>
        {delta && (
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
              tingido,
            )}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}
