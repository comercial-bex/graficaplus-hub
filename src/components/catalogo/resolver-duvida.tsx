import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mensagemErro } from "@/lib/erros";
import { PRECO_POR, UNIDADES_DE_PRECO, type UnidadeDePreco } from "@/domain/catalogo/modalidades";
import type { ItemDoCatalogo } from "@/domain/catalogo/itens";
import { resolverDuvida } from "@/components/catalogo/consultas";

/**
 * A tabela não diz se o valor é do pacote ou de cada peça: erro de 2× a 100×
 * no preço ao cliente. Enquanto ninguém confirma com o fornecedor, o item fica
 * "sob consulta". Aqui quem confirmou registra a unidade certa e o que o
 * fornecedor disse — e o item passa a ter preço pela regra.
 */
export function ResolverDuvidaDialog({
  item,
  onOpenChange,
  onResolvida,
}: {
  item: ItemDoCatalogo | null;
  onOpenChange: (aberto: boolean) => void;
  onResolvida: () => void;
}) {
  const [unidade, setUnidade] = useState<UnidadeDePreco>("unidade");
  const [nota, setNota] = useState("");
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (item) setUnidade(item.unidade_preco);
    setNota("");
  }, [item]);

  async function gravar() {
    if (!item || !nota.trim()) return;
    setGravando(true);
    try {
      await resolverDuvida(item.id, unidade, nota.trim());
      toast.success(`Dúvida de ${item.codigo_bex} resolvida: o preço passa a seguir a regra de venda.`);
      onResolvida();
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolver a dúvida da unidade</DialogTitle>
          <DialogDescription>{item ? `${item.codigo_bex} · ${item.descricao}` : ""}</DialogDescription>
        </DialogHeader>
        {item?.duvida && <p className="rounded-md bg-muted p-3 text-sm">{item.duvida}</p>}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>O custo da tabela é…</Label>
            <Select value={unidade} onValueChange={(v) => setUnidade(v as UnidadeDePreco)}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIDADES_DE_PRECO.map((u) => (
                  <SelectItem key={u} value={u}>
                    {PRECO_POR[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="duvida-nota">O que o fornecedor confirmou</Label>
            <Textarea
              id="duvida-nota"
              value={nota}
              maxLength={500}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ex.: confirmado com o fornecedor em 06/10, por WhatsApp: o valor é do pacote com 10."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="h-11 md:h-9" disabled={gravando || !nota.trim()} onClick={() => void gravar()}>
            {gravando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
