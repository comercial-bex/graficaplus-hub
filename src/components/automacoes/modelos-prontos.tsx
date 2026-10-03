import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MODELOS } from "@/domain/automacoes/modelos";
import type { FormAutomacao } from "@/domain/automacoes/formulario";

/**
 * Pontos de partida que o motor executa. Clicar só ABRE o formulário
 * preenchido: nada é gravado até a pessoa pôr o número e salvar.
 */
export function ModelosProntos({ onUsar }: { onUsar: (form: FormAutomacao) => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Modelos prontos
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {MODELOS.map((m) => (
          <div key={m.id} className="flex flex-col justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{m.titulo}</p>
              <p className="text-xs text-muted-foreground">{m.porque}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onUsar(m.form)}>
              Usar este modelo
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground md:col-span-3">
          Os modelos avisam a equipe. O cliente já recebe sozinho os avisos de arte para aprovar,
          produção, pronto para retirada, saiu para entrega e concluído (Respostas rápidas › Avisos
          automáticos ao cliente).
        </p>
      </CardContent>
    </Card>
  );
}
