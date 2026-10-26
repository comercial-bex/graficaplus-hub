import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ItemDaConferencia } from "@/domain/orcamentos/acordo";

/** O último olhar antes de criar a OS: o que está certo e o que a OS vai herdar de errado. */
export function ConferenciaAntesDeConverter({
  aberto,
  onFechar,
  itens,
  convertendo,
  aprovaJunto,
  onConfirmar,
}: {
  aberto: boolean;
  onFechar: () => void;
  itens: ItemDaConferencia[];
  convertendo: boolean;
  /** o orçamento ainda não está aprovado: confirmar também registra a aprovação da equipe */
  aprovaJunto: boolean;
  onConfirmar: () => void;
}) {
  const faltaObrigatorio = itens.some((i) => !i.ok && i.nivel === "obrigatorio");
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !convertendo && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Antes de criar a OS</DialogTitle>
          <DialogDescription>
            {aprovaJunto
              ? "Confirmar registra a aprovação da equipe no histórico e cria a OS."
              : "Confira o que a OS vai herdar deste orçamento."}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2" data-testid="conferencia-antes-de-converter">
          {itens.map((i) => (
            <li key={i.chave} className="flex items-start gap-2 text-sm">
              {i.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${i.nivel === "obrigatorio" ? "text-destructive" : "text-amber-500"}`}
                  aria-hidden
                />
              )}
              <span>
                <span className="font-medium">{i.rotulo}</span>
                <span className="block text-xs text-muted-foreground">{i.detalhe}</span>
              </span>
            </li>
          ))}
        </ul>
        {faltaObrigatorio && (
          <p className="text-xs text-destructive">
            Falta algo importante. Dá para criar a OS mesmo assim, mas ela vai herdar o problema.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={convertendo}>
            Voltar e corrigir
          </Button>
          <Button onClick={onConfirmar} disabled={convertendo}>
            {convertendo ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {convertendo ? "Criando a OS..." : "Criar a OS"} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
