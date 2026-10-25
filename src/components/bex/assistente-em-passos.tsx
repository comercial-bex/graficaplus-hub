import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUsoDoAssistente } from "@/lib/uso-de-telas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";

export type PassoDoAssistente = { n: number; titulo: string; pergunta: string };

/**
 * A casca dos assistentes em passos (25/10/2026): diálogo, barra de passos, pergunta do passo,
 * pendência e os botões Voltar, Avançar e o de criar. O conteúdo de cada passo é de quem usa.
 *
 * `passos` é a lista dos passos que ESTE caso percorre (um passo que não se aplica não aparece),
 * `atual` o número do passo e `onIr` volta a um passo já feito. Passos de um clique só escondem o
 * "Avançar" (`semAvancar`): escolher o cartão já avança.
 */
export function AssistenteEmPassos({
  aberto,
  onFechar,
  titulo,
  passos,
  atual,
  onIr,
  pendencia,
  semAvancar = false,
  rotuloCriar,
  criando = false,
  onCriar,
  testId,
  tela,
  children,
}: {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  passos: readonly PassoDoAssistente[];
  atual: number;
  onIr: (n: number) => void;
  pendencia: string | null;
  semAvancar?: boolean;
  rotuloCriar: string;
  criando?: boolean;
  onCriar: () => void;
  testId?: string;
  /** nome da tela para medir o uso (abriu, passo, fechou); a tela anota `concluiu` */
  tela?: string;
  children: ReactNode;
}) {
  const indice = Math.max(
    0,
    passos.findIndex((p) => p.n === atual),
  );
  const passo = passos[indice];
  useUsoDoAssistente(tela, aberto, atual);
  const ultimo = indice === passos.length - 1;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{passo?.pergunta}</DialogDescription>
        </DialogHeader>

        <Stepper value={indice + 1} onValueChange={(i) => onIr(passos[i - 1]?.n ?? atual)}>
          <StepperNav>
            {passos.map((p, i) => (
              <StepperItem
                key={p.n}
                step={i + 1}
                className="relative flex-1 items-start"
                disabled={i > indice}
              >
                <StepperTrigger className="flex flex-col items-start gap-1">
                  <StepperIndicator>{i + 1}</StepperIndicator>
                  <StepperTitle className="text-xs">{p.titulo}</StepperTitle>
                </StepperTrigger>
                {i < passos.length - 1 && (
                  <StepperSeparator className="absolute inset-x-0 left-[calc(50%+0.875rem)] top-3 m-0 group-data-[orientation=horizontal]/stepper-nav:w-[calc(100%-2rem+0.225rem)] group-data-[orientation=horizontal]/stepper-nav:flex-none group-data-[state=completed]/step:bg-primary" />
                )}
              </StepperItem>
            ))}
          </StepperNav>
        </Stepper>

        <div className="min-h-56 space-y-3 pt-2">{children}</div>

        {pendencia && <p className="text-sm text-destructive">{pendencia}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onIr(passos[indice - 1].n)}
            disabled={indice <= 0 || criando}
          >
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          {ultimo ? (
            <Button type="button" onClick={onCriar} disabled={!!pendencia || criando}>
              <Check className="h-4 w-4" /> {criando ? "Criando…" : rotuloCriar}
            </Button>
          ) : (
            !semAvancar && (
              <Button
                type="button"
                onClick={() => onIr(passos[indice + 1].n)}
                disabled={!!pendencia}
              >
                Avançar <ArrowRight className="h-4 w-4" />
              </Button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
