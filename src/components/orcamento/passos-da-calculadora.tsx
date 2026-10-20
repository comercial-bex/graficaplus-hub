import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PASSOS,
  type EstadoDoPasso,
  type PassoDaCalculadora,
} from "@/domain/orcamentos/passos-da-calculadora";

/**
 * A barra de passos da calculadora: quatro botões, cada um com o que o passo já
 * tem. Clicar vai direto ao passo — nada obriga a ordem, só a sugere.
 */
export function BarraDePassos({
  atual,
  estados,
  onIr,
}: {
  atual: PassoDaCalculadora;
  estados: EstadoDoPasso[];
  onIr: (p: PassoDaCalculadora) => void;
}) {
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label="Passos da calculadora" data-testid="passos-da-calculadora">
      {estados.map((e) => {
        const ativo = e.n === atual;
        return (
          <li key={e.n}>
            <button
              type="button"
              aria-current={ativo ? "step" : undefined}
              onClick={() => onIr(e.n)}
              className={cn(
                "flex min-h-11 w-full flex-col items-start rounded-md border px-2 py-1.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                <span
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    e.situacao === "preenchido" && "bg-primary text-primary-foreground",
                    e.situacao === "problema" && "bg-destructive text-destructive-foreground",
                    e.situacao === "vazio" && "border text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {e.situacao === "preenchido" ? <Check className="h-3 w-3" /> : e.situacao === "problema" ? <AlertTriangle className="h-3 w-3" /> : e.n}
                </span>
                {e.titulo}
              </span>
              <span className={cn("truncate text-[11px]", e.situacao === "problema" ? "text-destructive" : "text-muted-foreground")}>
                {e.resumo}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** A pergunta do passo, como título da seção à vista. */
export function PerguntaDoPasso({ passo }: { passo: PassoDaCalculadora }) {
  const p = PASSOS[passo - 1];
  return (
    <h3 className="text-sm font-semibold" data-testid="pergunta-do-passo">
      {p.pergunta}
    </h3>
  );
}
