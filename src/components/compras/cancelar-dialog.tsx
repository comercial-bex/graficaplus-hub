import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PedidoDeCompra } from "@/components/compras/pedido";

/**
 * Cancelar um pedido de compra, com motivo.
 *
 * O status 'cancelado' e a permissão compras.cancel existiam desde a criação
 * do módulo, e nada os gravava: um pedido feito por engano ficava "aguardando
 * entrega" para sempre e o aviso do topo da tela nunca zerava. O motivo vai
 * para as observações do pedido (é o que a tela mostra); quem e quando ficam
 * também na trilha de auditoria.
 */
export function CancelarPedidoDialog({
  pedido,
  onOpenChange,
  onCancelado,
}: {
  pedido: PedidoDeCompra | null;
  onOpenChange: (v: boolean) => void;
  onCancelado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    setMotivo("");
    setErro(null);
  }, [pedido]);

  const algoChegou = (pedido?.pedido_compra_itens ?? []).some((i) => Number(i.quantidade_recebida) > 0);

  async function cancelar() {
    if (!pedido) return;
    if (!motivo.trim()) {
      setErro("Diga por que o pedido está sendo cancelado.");
      return;
    }
    setCancelando(true);
    const { error } = await (supabase.rpc as any)("cancelar_pedido_compra", {
      p_pedido_id: pedido.id,
      p_motivo: motivo.trim(),
    });
    setCancelando(false);
    if (error) {
      const msg = mensagemErro(error, "Não foi possível cancelar o pedido.");
      setErro(msg);
      toast.error(msg);
      return;
    }
    toast.success(`Pedido #${pedido.numero} cancelado.`);
    onOpenChange(false);
    onCancelado();
  }

  return (
    <AlertDialog open={!!pedido} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar o pedido #{pedido?.numero}?</AlertDialogTitle>
          <AlertDialogDescription>
            {algoChegou
              ? "O que já chegou continua no estoque. O que faltava deixa de ser esperado e o pedido vira histórico."
              : "Nada deste pedido chegou. Ele deixa de ser esperado e vira histórico — não dá para reabrir."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="cancelar-motivo">Motivo</Label>
          <Textarea
            id="cancelar-motivo"
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: o fornecedor não tem o material; comprado em outro lugar"
          />
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9">Voltar</AlertDialogCancel>
          {/* Botão comum, não AlertDialogAction: a ação fecharia o diálogo antes
              de o banco responder, e um erro sumiria junto. */}
          <Button variant="destructive" className="h-11 md:h-9" disabled={cancelando} onClick={cancelar}>
            {cancelando ? "Cancelando…" : "Cancelar o pedido"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
