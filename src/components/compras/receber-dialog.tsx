import { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  conferirRecebimento,
  faltaReceber,
  recebimentoCompleto,
  ROTULO_STATUS,
  type LinhaDeRecebimento,
  type PedidoDeCompra,
  type StatusDoPedido,
} from "@/components/compras/pedido";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/**
 * Receber o pedido: o que chegou entra no estoque.
 *
 * NÃO é um segundo caminho de estoque. `receber_pedido_compra` passa cada item
 * por `receber_item_compra`, que chama `registrar_entrada_material` — a mesma
 * entrada da tela de Materiais: cria o lote, grava a movimentação e recalcula
 * o custo médio. Tudo ou nada: se um item for recusado, nenhum entra.
 *
 * Vem preenchido com tudo o que falta, porque o caso comum é chegar tudo. O
 * que não veio, zera — recebimento parcial é a regra.
 */
export function ReceberPedidoDialog({
  pedido,
  podeVerCusto,
  onOpenChange,
  onRecebido,
}: {
  pedido: PedidoDeCompra | null;
  podeVerCusto: boolean;
  onOpenChange: (v: boolean) => void;
  onRecebido: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaDeRecebimento[]>([]);
  const [nota, setNota] = useState("");
  const [problemas, setProblemas] = useState<string[]>([]);
  const [recebendo, setRecebendo] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setLinhas(recebimentoCompleto(pedido.pedido_compra_itens));
    setNota("");
    setProblemas([]);
  }, [pedido]);

  const itens = pedido?.pedido_compra_itens ?? [];
  const pendentes = itens.filter((i) => faltaReceber(i) > 0);

  function alterar(itemId: string, patch: Partial<LinhaDeRecebimento>) {
    setLinhas((atual) => atual.map((l) => (l.item_id === itemId ? { ...l, ...patch } : l)));
  }

  async function receber() {
    if (!pedido) return;
    const conferido = conferirRecebimento(linhas, itens);
    setProblemas(conferido.problemas);
    if (conferido.problemas.length > 0) return;

    setRecebendo(true);
    const recebidos = conferido.itens;
    const { data, error } = await (supabase.rpc as any)("receber_pedido_compra", {
      p_pedido_id: pedido.id,
      p_itens: recebidos,
      p_nota: nota.trim() || null,
    });
    setRecebendo(false);

    if (error) {
      const msg = mensagemErro(error, "Não foi possível receber o pedido.");
      setProblemas([msg]);
      toast.error(msg);
      return;
    }
    const r = (data ?? {}) as { itens_recebidos?: number; pedido_status?: StatusDoPedido };
    const situacao = r.pedido_status ? ROTULO_STATUS[r.pedido_status] : "atualizado";
    toast.success(
      `${r.itens_recebidos ?? recebidos.length} item(ns) entraram no estoque. O pedido #${pedido.numero} agora está ${situacao}.`,
    );
    onOpenChange(false);
    onRecebido();
  }

  return (
    <Dialog open={!!pedido} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Receber o pedido #{pedido?.numero}
          </DialogTitle>
          <DialogDescription>
            {pedido?.fornecedor} — o que chegar entra no estoque com lote, e o custo médio do material
            é recalculado. Zere o que não veio: fica pendente no pedido.
          </DialogDescription>
        </DialogHeader>

        {pendentes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendente neste pedido.</p>
        ) : (
          <ul className="space-y-2">
            {pendentes.map((i) => {
              const l = linhas.find((x) => x.item_id === i.id);
              const unidade = i.material?.unidade ?? "un";
              return (
                <li
                  key={i.id}
                  className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_120px_130px] sm:items-end"
                >
                  <div className="col-span-2 sm:col-span-1">
                    <div className="font-medium">{i.material?.nome ?? "Material"}</div>
                    <div className="text-xs text-muted-foreground">
                      faltam {qtd(faltaReceber(i))} {unidade}
                      {podeVerCusto && <> · pedido a {brl(Number(i.custo_unitario))}</>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`chegou-${i.id}`} className="text-xs text-muted-foreground">
                      Chegou ({unidade})
                    </Label>
                    <Input
                      id={`chegou-${i.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={l?.quantidade ?? ""}
                      onChange={(e) => alterar(i.id, { quantidade: e.target.value })}
                      className="h-11 md:h-9"
                    />
                  </div>
                  {podeVerCusto && (
                    <div className="space-y-1">
                      <Label htmlFor={`nota-custo-${i.id}`} className="text-xs text-muted-foreground">
                        Custo da nota
                      </Label>
                      {/* O preço da nota manda sobre o do pedido: é ele que entra no
                          custo médio, e é por ele que a gráfica pagou. */}
                      <Input
                        id={`nota-custo-${i.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder={String(Number(i.custo_unitario))}
                        value={l?.custo_unitario ?? ""}
                        onChange={(e) => alterar(i.id, { custo_unitario: e.target.value })}
                        className="h-11 md:h-9"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {podeVerCusto && pendentes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Custo da nota em branco usa o custo do pedido. Se a nota veio diferente, informe o valor real.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="receber-nota">Nota fiscal</Label>
          <Input
            id="receber-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Número da NF (opcional)"
            className="h-11 md:h-9"
          />
          <p className="text-xs text-muted-foreground">
            Vai para o histórico de movimentações junto com o número do pedido.
          </p>
        </div>

        {problemas.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button className="h-11 md:h-9" disabled={recebendo || pendentes.length === 0} onClick={receber}>
            {recebendo ? "Recebendo…" : "Receber e dar entrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
