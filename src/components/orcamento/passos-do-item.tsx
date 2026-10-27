import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type PassoDoItem = { rotulo: string; liberado: boolean; onIr: () => void };

/**
 * A linha de passos da janela "Novo item": tipo → produto → medida → preço.
 * Passo liberado é clicável e volta (ou avança) sem apagar o que foi preenchido.
 */
export function PassosDoItem({ passos, atual }: { passos: PassoDoItem[]; atual: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Passos do item">
      {passos.map((p, i) => {
        const numero = i + 1;
        const ativo = numero === atual;
        const feito = numero < atual;
        return (
          <li key={p.rotulo} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!p.liberado || ativo}
              onClick={p.onIr}
              aria-current={ativo ? "step" : undefined}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 enabled:hover:bg-muted disabled:cursor-default"
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full border text-[10px] font-semibold",
                  feito && "border-primary bg-primary text-primary-foreground",
                  ativo && "border-primary text-primary",
                  !feito && !ativo && "text-muted-foreground",
                )}
              >
                {feito ? <Check className="h-3 w-3" /> : numero}
              </span>
              <span className={cn(ativo ? "font-medium text-foreground" : p.liberado ? "text-foreground/80" : "text-muted-foreground")}>
                {p.rotulo}
              </span>
            </button>
            {i < passos.length - 1 && <span className="h-px w-4 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
