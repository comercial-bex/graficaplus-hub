import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { alternarAcabamento, temAcabamento } from "@/domain/orcamentos/tipos-de-produto";

/**
 * Acabamento como chips, com o campo livre embaixo.
 *
 * O campo gravado continua sendo o texto (`orcamento_itens.acabamento`): os
 * chips só escrevem nele — "bainha + ilhós, refile" — e marcam o que já está
 * escrito. Quem prefere digitar, digita; quem prefere tocar, toca.
 */
export function AcabamentoDoItem({
  valor,
  opcoes,
  onMudar,
  desabilitado = false,
}: {
  valor: string;
  opcoes: string[];
  onMudar: (valor: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="item-acabamento" className="flex items-center gap-1">
        Acabamento
        <DicaIcone texto={dicaCampo("/orcamentos", "acabamento")} rotulo="Acabamento" className="h-5 w-5" />
      </Label>
      {opcoes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Acabamentos comuns">
          {opcoes.map((o) => {
            const ativo = temAcabamento(valor, o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={ativo}
                disabled={desabilitado}
                onClick={() => onMudar(alternarAcabamento(valor, o))}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-8",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativo ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/60",
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
      <Input
        id="item-acabamento"
        placeholder="Refile, ilhós…"
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onMudar(e.target.value)}
      />
    </div>
  );
}
