import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { opcoesDaUnidade, unidadeDaLista } from "@/domain/orcamentos/unidades-do-item";

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
      <Label htmlFor={id}>Vendido por</Label>
      <Select value={selecionada} onValueChange={onMudar} disabled={desabilitado}>
        <SelectTrigger id={id} className="h-11 sm:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => (
            <SelectItem key={o.valor} value={o.valor} title={o.dica}>
              {o.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
