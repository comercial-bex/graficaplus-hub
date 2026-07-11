import { cn } from "@/lib/utils";

export function BexBackground({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden bg-background", className)}>
      <div className="pointer-events-none absolute inset-0 bex-grid opacity-40" />
      <div
        className="pointer-events-none absolute -top-[10%] -right-[10%] h-[40%] w-[40%] rounded-full blur-[120px]"
        style={{ backgroundColor: "rgba(0, 212, 255, 0.10)" }}
      />
      <div
        className="pointer-events-none absolute -bottom-[10%] -left-[10%] h-[40%] w-[40%] rounded-full blur-[120px]"
        style={{ backgroundColor: "rgba(233, 30, 99, 0.10)" }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
