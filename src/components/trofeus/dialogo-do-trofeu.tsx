import { Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CalculadoraDeTrofeu } from "@/components/trofeus/calculadora-de-trofeu";
import { ehItemDeArteDeTrofeu, ehItemDeTrofeu } from "@/domain/trofeus/tela";

/**
 * O diálogo do troféu dentro da tela do orçamento (22/11/2026): o mesmo lugar e o mesmo tamanho do diálogo da peça 3D.
 * Mora aqui, e não na rota, porque a rota do orçamento já é grande e tem um teto de linhas (orcamento-tela-em-partes).
 */
export function DialogoDoTrofeu({
  aberto,
  itemId,
  orcamentoId,
  clienteId,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  itemId: string | null;
  orcamentoId: string;
  clienteId: string | null;
  aoFechar: () => void;
  aoSalvar: () => void | Promise<void>;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[94vh] w-[96vw] max-w-6xl overflow-y-auto p-4 sm:p-6" data-testid="dialogo-trofeu">
        <DialogTitle className="sr-only">Troféu de acrílico</DialogTitle>
        {aberto && (
          <CalculadoraDeTrofeu
            modo="embutido"
            orcamentoId={orcamentoId}
            clienteId={clienteId}
            itemId={itemId}
            onCancelar={aoFechar}
            onSalvo={aoSalvar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** O que a linha do orçamento diz sobre um item de troféu ou de arte de troféu. Nada para os outros itens. */
export function NotaDoItemDeTrofeu({ item }: { item: { tipo_produto?: string | null } }) {
  if (ehItemDeTrofeu(item)) {
    return (
      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-link" data-trofeu="">
        <Trophy className="h-3.5 w-3.5" aria-hidden /> Troféu de acrílico: o preço vem da calculadora do troféu
      </p>
    );
  }
  if (ehItemDeArteDeTrofeu(item)) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground" data-arte-de-trofeu="">
        Arte do troféu: para mudar, edite o troféu.
      </p>
    );
  }
  return null;
}
