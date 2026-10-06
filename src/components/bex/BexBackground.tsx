import { cn } from "@/lib/utils";

export function BexBackground({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-background", className)}>
      <div className="pointer-events-none absolute inset-0 bex-grid opacity-40" />
      <div className="relative">{children}</div>
    </div>
  );
}
