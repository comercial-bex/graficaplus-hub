import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A linha de passos da janela "Novo item": tipo → produto → medida → preço. */
export function PassosDoItem({ passos }: { passos: { rotulo: string; feito: boolean }[] }) {
  const atual = passos.findIndex((p) => !p.feito);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Passos do item">
      {passos.map((p, i) => {
        const ativo = i === atual;
        return (
          <li key={p.rotulo} className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full border text-[10px] font-semibold",
                p.feito && "border-primary bg-primary text-primary-foreground",
                ativo && "border-primary text-primary",
                !p.feito && !ativo && "text-muted-foreground",
              )}
              aria-current={ativo ? "step" : undefined}
            >
              {p.feito ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn(ativo ? "font-medium text-foreground" : "text-muted-foreground")}>{p.rotulo}</span>
            {i < passos.length - 1 && <span className="h-px w-4 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
