import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** "Instala qual item?": a instalação aponta para o item do mesmo orçamento que ela instala. */
export function VinculoDaInstalacao({
  valor,
  opcoes,
  onMudar,
  desabilitado,
}: {
  valor: string | null;
  opcoes: { id: string; descricao: string; numero: number }[];
  onMudar: (id: string) => void;
  desabilitado?: boolean;
}) {
  const valido = !!valor && opcoes.some((o) => o.id === valor);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5" id="vinculo-instalacao">
      <Label htmlFor="instala-item">Instala qual item? *</Label>
      {opcoes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Lance primeiro o item que será instalado (adesivo, placa, lona…) e depois volte aqui.
        </p>
      ) : (
        <Select value={valido ? valor! : undefined} onValueChange={onMudar} disabled={desabilitado}>
          <SelectTrigger id="instala-item" className={valido ? "" : "border-warning"}>
            <SelectValue placeholder="Escolha o item que esta instalação instala" />
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.numero} · {o.descricao}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {!valido && opcoes.length > 0 && (
        <p className="text-xs text-warning">Sem o item escolhido, o orçamento fica com pendência.</p>
      )}
    </div>
  );
}
