import { cn } from "@/lib/utils";

type Tone = "cyan" | "magenta" | "lime" | "amber" | "muted";

const toneMap: Record<Tone, { dot: string; text: string; bg: string; border: string }> = {
  cyan: {
    dot: "bg-[color:var(--bex-cyan)]",
    text: "text-[color:var(--bex-cyan)]",
    bg: "bg-[color:var(--bex-cyan)]/10",
    border: "border-[color:var(--bex-cyan)]/30",
  },
  magenta: {
    dot: "bg-[color:var(--bex-magenta)]",
    text: "text-[color:var(--bex-magenta)]",
    bg: "bg-[color:var(--bex-magenta)]/10",
    border: "border-[color:var(--bex-magenta)]/30",
  },
  lime: {
    dot: "bg-[color:var(--bex-lime)]",
    text: "text-[color:var(--bex-lime)]",
    bg: "bg-[color:var(--bex-lime)]/10",
    border: "border-[color:var(--bex-lime)]/30",
  },
  amber: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
  },
  muted: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted",
    border: "border-border",
  },
};

export function StatusChip({
  label,
  tone = "cyan",
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  const t = toneMap[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        t.bg,
        t.border,
        t.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {label}
    </span>
  );
}
