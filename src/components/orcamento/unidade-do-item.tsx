import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { opcoesDaUnidade, unidadeDaLista } from "@/domain/orcamentos/unidades-do-item";
import { DicaIcone } from "@/components/bex/Dica";

/**
 * A unidade do item, em lista. O valor gravado continua o de sempre ("un",
 * "m2", "mil"…): só deixou de ser texto livre, onde um erro de digitação mudava
 * o comportamento da tela sem avisar (ver unidades-do-item.ts).
 */
export function UnidadeDoItem({
  valor,
  onMudar,
  desabilitado = false,
  id = "item-unidade",
}: {
  valor: string;
  onMudar: (valor: string) => void;
  desabilitado?: boolean;
  id?: string;
}) {
  const opcoes = opcoesDaUnidade(valor);
  // "m²" gravado à mão aparece como a opção "m² (por área)", sem trocar o valor.
  const selecionada = unidadeDaLista(valor) ?? valor.trim();
  return (
    <div>
      {/* A explicação de cada unidade estava no title de cada opção da lista (só
          com o mouse parado). Agora a da escolhida fica na dica do rótulo. */}
      <Label htmlFor={id} className="flex items-center gap-1">
        Vendido por
        <DicaIcone texto={opcoes.find((o) => o.valor === selecionada)?.dica} rotulo="Vendido por" />
      </Label>
      <Select value={selecionada} onValueChange={onMudar} disabled={desabilitado}>
        <SelectTrigger id={id} className="h-11 sm:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
