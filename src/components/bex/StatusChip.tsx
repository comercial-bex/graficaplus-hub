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
  compacto = false,
  className,
}: {
  label: string;
  tone?: Tone;
  /** Para cantos apertados (capa do cartão do quadro): menos altura, mesma letra de 12 px. */
  compacto?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        // 12px: o selo carrega o aviso mais importante do cartão ("3 dias de atraso") e
        // letra menor não se lê a um braço de distância na oficina.
        // min-w-0 + max-w-full: ao lado de um vizinho apertado o selo encolhe (o rótulo
        // ganha reticências) em vez de passar por cima do que está ao lado.
        "inline-flex min-w-0 max-w-full items-center rounded border px-2 text-xs font-bold uppercase tracking-wide whitespace-nowrap",
        compacto ? "px-1.5 py-0.5 tracking-normal" : "py-1.5 md:py-1",
        toneMap[tone] ?? toneMap.cyan,
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
