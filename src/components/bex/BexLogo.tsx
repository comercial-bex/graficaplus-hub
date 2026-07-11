import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const sizes: Record<Size, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-6xl",
};

export function BexLogo({
  size = "md",
  showTagline = false,
  className,
}: {
  size?: Size;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className={cn("font-black tracking-tighter leading-none flex items-center", sizes[size])}>
        <span className="text-foreground">BE</span>
        <span className="bex-gradient-text">X</span>
      </div>
      {showTagline && (
        <div className="mt-2 flex items-center gap-3">
          <span className="h-px w-6 bg-border" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Print OS · 3D · Visual
          </span>
          <span className="h-px w-6 bg-border" />
        </div>
      )}
    </div>
  );
}
