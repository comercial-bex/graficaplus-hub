import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
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
    <Stepper
      value={atual}
      onValueChange={(n) => onIr(n as PassoDoOrcamento)}
      aria-label="Passos do orçamento"
      data-testid="passos-do-orcamento"
    >
      <StepperNav className="gap-1.5">
        {estados.map((e) => {
          const ativo = e.n === atual;
          return (
            <StepperItem key={e.n} step={e.n} className="min-w-0 flex-1 items-stretch">
              <StepperTrigger
                aria-current={ativo ? "step" : undefined}
                className={cn(
                  "flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
                  ativo ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <StepperIndicator
                    className={cn(
                      "size-5 text-[11px]",
                      e.situacao === "vazio" &&
                        "border bg-transparent text-muted-foreground data-[state=active]:bg-transparent data-[state=active]:text-muted-foreground data-[state=completed]:bg-transparent data-[state=completed]:text-muted-foreground",
                      e.situacao === "preenchido" &&
                        "bg-primary text-primary-foreground data-[state=active]:bg-primary data-[state=inactive]:bg-primary data-[state=inactive]:text-primary-foreground",
                      e.situacao === "problema" &&
                        "bg-destructive text-destructive-foreground data-[state=active]:bg-destructive data-[state=completed]:bg-destructive data-[state=inactive]:bg-destructive data-[state=inactive]:text-destructive-foreground",
                    )}
                  >
                    {e.situacao === "preenchido" ? (
                      <Check className="size-3" />
                    ) : e.situacao === "problema" ? (
                      <AlertTriangle className="size-3" />
                    ) : (
                      e.n
                    )}
                  </StepperIndicator>
                  <StepperTitle className="text-xs font-semibold leading-tight md:text-sm">
                    {e.titulo}
                  </StepperTitle>
                </span>
                <StepperDescription
                  className={cn(
                    "hidden w-full truncate text-[11px] md:block",
                    e.situacao === "problema" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {e.resumo}
                </StepperDescription>
              </StepperTrigger>
            </StepperItem>
          );
        })}
      </StepperNav>
    </Stepper>
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
