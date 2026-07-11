import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Botão com borda CMYK que preenche no hover. Use para CTA primária. */
export const NeonButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        {...props}
        className={cn(
          "group relative overflow-hidden rounded-lg p-[1px] transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ background: "var(--gradient-cmyk)" }}
        />
        <span className="relative flex items-center justify-center gap-2 rounded-[7px] bg-background group-hover:bg-transparent transition-colors duration-300 px-4 py-2.5 text-sm font-bold tracking-wide text-foreground group-hover:text-background">
          {children}
        </span>
      </button>
    );
  },
);
NeonButton.displayName = "NeonButton";
