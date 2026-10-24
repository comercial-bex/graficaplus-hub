import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PASSOS_DO_ORCAMENTO,
  type EstadoDoPasso,
  type PassoDoOrcamento,
} from "@/domain/parceiros/passos-do-orcamento";

/**
 * A barra de passos do orçamento do parceiro: um botão por passo, cada um com o
 * que o passo já tem. Clicar vai direto ao passo — nada obriga a ordem, só a
 * sugere. No celular os quatro cabem lado a lado porque o resumo some e fica só
 * o número e o nome.
 */
export function BarraDePassosDoOrcamento({
  atual,
  estados,
  onIr,
}: {
  atual: PassoDoOrcamento;
  estados: EstadoDoPasso[];
  onIr: (p: PassoDoOrcamento) => void;
}) {
  return (
    <ol
      className="grid grid-cols-4 gap-1.5"
      aria-label="Passos do orçamento"
      data-testid="passos-do-orcamento"
    >
      {estados.map((e) => {
        const ativo = e.n === atual;
        return (
          <li key={e.n}>
            <button
              type="button"
              aria-current={ativo ? "step" : undefined}
              onClick={() => onIr(e.n)}
              className={cn(
                "flex min-h-12 w-full flex-col items-start rounded-xl border px-2.5 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold md:text-sm">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]",
                    e.situacao === "preenchido" && "bg-primary text-primary-foreground",
                    e.situacao === "problema" && "bg-destructive text-destructive-foreground",
                    e.situacao === "vazio" && "border text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {e.situacao === "preenchido" ? (
                    <Check className="h-3 w-3" />
                  ) : e.situacao === "problema" ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    e.n
                  )}
                </span>
                {e.titulo}
              </span>
              <span
                className={cn(
                  "hidden w-full truncate text-[11px] md:block",
                  e.situacao === "problema" ? "text-destructive" : "text-muted-foreground",
                )}
              >
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
export function PerguntaDoPasso({ passo }: { passo: PassoDoOrcamento }) {
  return (
    <h2 className="text-lg font-semibold" data-testid="pergunta-do-passo">
      {PASSOS_DO_ORCAMENTO[passo - 1].pergunta}
    </h2>
  );
}
