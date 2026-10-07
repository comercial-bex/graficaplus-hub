import { ClipboardCheck } from "lucide-react";
import { fraseDoResumo, type EntradaDoResumo } from "@/domain/orcamentos/resumo-do-item";

/**
 * A linha de conferência antes de "Adicionar item": quantidade, produto,
 * medida, metragem e — para quem vê preço — o total. É a mesma conta que
 * vai para a tabela e para o PDF, dita em uma frase.
 */
export function ResumoDoItem(entrada: EntradaDoResumo) {
  const vazio = !entrada.descricao.trim();
  return (
    <p
      className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground"
      data-testid="resumo-do-item"
      aria-live="polite"
    >
      <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {vazio ? (
          <span className="text-muted-foreground">Escolha um produto ou escreva a descrição para ver o resumo.</span>
        ) : (
          <>
            <span className="font-medium">Vai entrar: </span>
            {fraseDoResumo(entrada)}
          </>
        )}
      </span>
    </p>
  );
}
