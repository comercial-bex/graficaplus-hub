import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, PackageMinus } from "lucide-react";
import { toast } from "sonner";
import {
  aplicarBaixaEstoque,
  calcularConsumoPrevisto,
  type LinhaConsumo,
} from "@/lib/estoque-baixa";

export function BaixaEstoqueDialog({
  open,
  onOpenChange,
  osId,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  osId: string;
  userId: string | null;
  onDone: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: plano, isLoading, refetch } = useQuery({
    queryKey: ["baixa-preview", osId],
    queryFn: () => calcularConsumoPrevisto(osId),
    enabled: open,
  });

  useEffect(() => {
    if (open && plano?.linhas) {
      const initial: Record<string, string> = {};
      for (const l of plano.linhas) initial[l.material_id] = String(l.quantidade_prevista);
      setEdits(initial);
    }
  }, [open, plano]);

  const linhas: LinhaConsumo[] = plano?.linhas ?? [];

  const linhasComCalculo = linhas.map((l) => {
    const editado = Number(edits[l.material_id] ?? l.quantidade_prevista);
    const restante = l.estoque_atual - (isNaN(editado) ? 0 : editado);
    return { ...l, editado: isNaN(editado) ? 0 : editado, restante };
  });

  const algumNegativo = linhasComCalculo.some((l) => l.restante < 0);
  const totalLinhasAtivas = linhasComCalculo.filter((l) => l.editado > 0).length;

  async function confirmar() {
    setSaving(true);
    const res = await aplicarBaixaEstoque(
      osId,
      linhasComCalculo.map((l) => ({
        material_id: l.material_id,
        quantidade: l.editado,
      })),
      userId,
    );
    setSaving(false);
    if (res.ok) {
      toast.success(res.mensagem);
      onOpenChange(false);
      onDone();
    } else {
      if (res.insuficientes.length > 0) {
        toast.error(
          `${res.mensagem} ${res.insuficientes
            .map((f) => `${f.material}: precisa ${f.necessario}, tem ${f.disponivel}`)
            .join("; ")}`,
        );
      } else {
        toast.error(res.mensagem);
      }
      refetch();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5" />
            Baixar estoque {plano?.os_numero ? `— OS #${plano.os_numero}` : ""}
          </DialogTitle>
          <DialogDescription>
            Revise as quantidades antes de confirmar. Operação bloqueada se algum
            material ficar negativo. Linhas com quantidade 0 são ignoradas.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-muted-foreground text-sm">Calculando consumo…</div>
        ) : plano && !plano.ok ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <div>{plano.motivo}</div>
          </div>
        ) : linhas.length === 0 ? (
          <div className="py-6 text-muted-foreground text-sm">
            Nenhum material a baixar.
          </div>
        ) : (
          <div className="border rounded-md max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">Estoque atual</TableHead>
                  <TableHead className="text-right w-[140px]">A baixar</TableHead>
                  <TableHead className="text-right">Restante</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasComCalculo.map((l) => {
                  const status =
                    l.restante < 0
                      ? "bloqueio"
                      : l.editado === 0
                        ? "ignorada"
                        : l.restante < l.estoque_atual * 0.1
                          ? "alerta"
                          : "ok";
                  return (
                    <TableRow key={l.material_id}>
                      <TableCell>
                        <div className="font-medium">{l.material_nome}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.origens
                            .map(
                              (o) =>
                                `${o.produto_nome}: ${o.qtd_item} × ${o.consumo_por_unidade}`,
                            )
                            .join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {l.estoque_atual} {l.unidade}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          className="text-right font-mono h-8"
                          value={edits[l.material_id] ?? ""}
                          onChange={(e) =>
                            setEdits({ ...edits, [l.material_id]: e.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-sm ${
                          l.restante < 0
                            ? "text-destructive font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        {l.restante.toFixed(2)} {l.unidade}
                      </TableCell>
                      <TableCell>
                        {status === "bloqueio" && (
                          <Badge variant="destructive">Insuficiente</Badge>
                        )}
                        {status === "alerta" && (
                          <Badge className="bg-amber-500 hover:bg-amber-500">Crítico</Badge>
                        )}
                        {status === "ok" && <Badge variant="secondary">OK</Badge>}
                        {status === "ignorada" && (
                          <Badge variant="outline">Ignorada</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {algumNegativo && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Ajuste as quantidades — não é possível baixar deixando estoque negativo.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={
              saving || !plano?.ok || algumNegativo || totalLinhasAtivas === 0
            }
            onClick={confirmar}
          >
            {saving ? "Aplicando…" : `Confirmar baixa (${totalLinhasAtivas})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
