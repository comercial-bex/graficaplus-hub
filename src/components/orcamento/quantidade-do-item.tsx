import { Minus, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import type { CamposDoItem } from "@/domain/orcamentos/tipos-de-produto";

/**
 * Contador de quantidade com o rótulo certo para a unidade: "peças" para o
 * que é vendido por m² e por unidade, "milheiros" para cartão e panfleto,
 * "metros" para a bainha, "horas" para a instalação. Os botões têm 44 px
 * porque no balcão isto é usado no celular, com o dedo.
 */
export function QuantidadeDoItem({
  valor,
  campos,
  onMudar,
  desabilitado = false,
}: {
  valor: string;
  campos: CamposDoItem;
  onMudar: (valor: string) => void;
  desabilitado?: boolean;
}) {
  const atual = Number(String(valor).replace(",", "."));
  const n = Number.isFinite(atual) ? atual : 0;
  const passo = campos.passo;
  // Em passo inteiro o mínimo é 1 peça; em decimal, meio metro/meia hora.
  const minimo = passo;
  const arredondar = (v: number) => String(Math.round(v * 100) / 100);

  return (
    <div>
      <Label htmlFor="item-qtd" className="flex items-center gap-1">
        {campos.rotuloQuantidade}
        <DicaIcone texto={dicaCampo("/orcamentos", "quantidade")} rotulo="Quantidade" className="h-5 w-5" />
      </Label>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-label="Diminuir a quantidade"
          disabled={desabilitado || n - passo < minimo}
          onClick={() => onMudar(arredondar(Math.max(minimo, n - passo)))}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-l-md border border-input bg-card text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-10"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <Input
          id="item-qtd"
          type="number"
          min="0"
          step={passo}
          inputMode="decimal"
          className="h-11 rounded-none text-center tabular-nums sm:h-9"
          value={valor}
          disabled={desabilitado}
          onChange={(e) => onMudar(e.target.value)}
        />
        <button
          type="button"
          aria-label="Aumentar a quantidade"
          disabled={desabilitado}
          onClick={() => onMudar(arredondar(n + passo))}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-r-md border border-input bg-card text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-10"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
