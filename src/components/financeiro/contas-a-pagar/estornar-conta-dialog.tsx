import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";
import { MINIMO_DO_MOTIVO, problemaDoMotivo } from "@/domain/financeiro/contas-a-pagar-anexos";
import { useEstornarConta } from "./use-conta-a-pagar";

export interface ContaParaEstornar {
  id: string;
  descricao: string;
  fornecedor: string | null;
  valor: number;
  data_pagamento: string | null;
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/**
 * Desfazer um pagamento. Só o admin chega aqui (a tela esconde o botão, o banco recusa os
 * outros). O que acontece está escrito antes do botão, e o botão repete o valor: estorno é a
 * única ação desta tela que tira dinheiro do "realizado".
 */
export function EstornarContaDialog({
  conta,
  onFechar,
  onEstornado,
}: {
  conta: ContaParaEstornar | null;
  onFechar: () => void;
  onEstornado: () => void;
}) {
  const estornar = useEstornarConta();
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const problema = problemaDoMotivo(motivo);

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!conta) throw new Error("Nenhuma conta escolhida.");
      if (problema) throw new Error(problema);
      return estornar(conta.id, motivo);
    },
    onSuccess: (r) => {
      const partes = ["Pagamento estornado: a conta voltou a ficar em aberto"];
      const reembolsos = Number(r.reembolsos_reabertos ?? 0);
      const desconciliadas = Number(r.transacoes_desconciliadas ?? 0);
      if (reembolsos > 0) partes.push(`${reembolsos} reembolso(s) voltaram a aprovado`);
      if (desconciliadas > 0)
        partes.push(`${desconciliadas} lançamento(s) do extrato voltaram para conciliar`);
      toast.success(`${partes.join("; ")}.`);
      onEstornado();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <Dialog open={!!conta} onOpenChange={(aberto) => !aberto && !confirmar.isPending && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar pagamento</DialogTitle>
          <DialogDescription>
            A conta volta a ficar em aberto, a saída sai do caixa e o estorno fica no histórico com
            o seu nome e o motivo. Os anexos continuam guardados.
          </DialogDescription>
        </DialogHeader>

        {conta && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm">
              <dt className="text-muted-foreground">Descrição</dt>
              <dd className="min-w-0 break-words font-medium">{conta.descricao}</dd>
              <dt className="text-muted-foreground">Fornecedor</dt>
              <dd className="min-w-0 break-words">{conta.fornecedor || "sem fornecedor"}</dd>
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="font-bold tabular-nums">{brl(conta.valor)}</dd>
              <dt className="text-muted-foreground">Pago em</dt>
              <dd className="tabular-nums">
                {conta.data_pagamento ? dia(conta.data_pagamento) : "data não informada"}
              </dd>
            </dl>

            <div className="space-y-1.5">
              <Label htmlFor="estorno-motivo">Motivo do estorno *</Label>
              <Textarea
                id="estorno-motivo"
                value={motivo}
                rows={3}
                disabled={confirmar.isPending}
                placeholder="Ex.: pagamento lançado na conta errada"
                aria-invalid={tentou && !!problema}
                aria-describedby="estorno-motivo-ajuda"
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={() => setTentou(true)}
              />
              <p
                id="estorno-motivo-ajuda"
                className={
                  tentou && problema ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {tentou && problema
                  ? problema
                  : `Obrigatório, pelo menos ${MINIMO_DO_MOTIVO} caracteres.`}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={confirmar.isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!conta || confirmar.isPending}
            onClick={() => {
              setTentou(true);
              if (!problema) confirmar.mutate();
            }}
          >
            {confirmar.isPending
              ? "Estornando…"
              : conta
                ? `Estornar ${brl(conta.valor)}`
                : "Estornar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
