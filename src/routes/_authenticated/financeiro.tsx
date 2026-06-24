import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — BEX PRINT OS" }] }),
  component: FinanceiroPage,
});

const statusVariant: Record<string, any> = {
  pago: "default",
  pendente: "outline",
  atrasado: "destructive",
  cancelado: "secondary",
};

function FinanceiroPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    os_id: "",
    valor: "",
    data_vencimento: "",
    forma_pagamento: "pix",
    parcela: "1",
    total_parcelas: "1",
  });

  const { data: pagamentos = [], isLoading } = useQuery({
    queryKey: ["pagamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("*, ordens_servico(numero, titulo, clientes(nome))")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: oss = [] } = useQuery({
    queryKey: ["os-select-fin"],
    queryFn: async () => {
      const { data } = await fromFinancialView("ordens_servico", true)
        .select("id, numero, titulo, cliente_nome")
        .order("numero", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const totalRecebido = pagamentos
    .filter((p: any) => p.status === "pago")
    .reduce((s: number, p: any) => s + Number(p.valor), 0);
  const totalPendente = pagamentos
    .filter((p: any) => p.status === "pendente")
    .reduce((s: number, p: any) => s + Number(p.valor), 0);
  const totalAtrasado = pagamentos
    .filter((p: any) => p.status !== "pago" && p.data_vencimento && p.data_vencimento < today)
    .reduce((s: number, p: any) => s + Number(p.valor), 0);

  async function handleCreate() {
    if (!form.os_id || !form.valor) return toast.error("OS e valor são obrigatórios");
    const { error } = await supabase.from("pagamentos").insert({
      os_id: form.os_id,
      valor: parseFloat(form.valor),
      data_vencimento: form.data_vencimento || null,
      forma_pagamento: form.forma_pagamento,
      parcela: parseInt(form.parcela),
      total_parcelas: parseInt(form.total_parcelas),
      status: "pendente",
    });
    if (error) return toast.error(error.message);
    toast.success("Pagamento registrado");
    setOpen(false);
    setForm({
      os_id: "",
      valor: "",
      data_vencimento: "",
      forma_pagamento: "pix",
      parcela: "1",
      total_parcelas: "1",
    });
    qc.invalidateQueries({ queryKey: ["pagamentos"] });
  }

  async function marcarPago(p: any) {
    const { error } = await supabase.rpc("confirmar_pagamento_registrado", {
      p_pagamento_id: p.id,
      p_data: today,
      p_referencia_externa: null,
    });
    if (error) return toast.error(error.message);
    toast.success("Pagamento confirmado");
    qc.invalidateQueries({ queryKey: ["pagamentos"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground">Pagamentos e recebimentos</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Registrar pagamento
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo pagamento</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>OS *</Label>
                <Select value={form.os_id} onValueChange={(v) => setForm({ ...form, os_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {oss.map((o: any) => (
                      <SelectItem key={o.id} value={o.id}>
                        #{o.numero} — {o.titulo} ({o.cliente_nome})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Valor (R$) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor}
                    onChange={(e) => setForm({ ...form, valor: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vencimento</Label>
                  <Input
                    type="date"
                    value={form.data_vencimento}
                    onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Forma</Label>
                  <Select
                    value={form.forma_pagamento}
                    onValueChange={(v) => setForm({ ...form, forma_pagamento: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="cartao">Cartão</SelectItem>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="transferencia">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Parcela</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.parcela}
                    onChange={(e) => setForm({ ...form, parcela: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Total parcelas</Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.total_parcelas}
                    onChange={(e) => setForm({ ...form, total_parcelas: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate}>Registrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Recebido</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">R$ {totalRecebido.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">A receber</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ {totalPendente.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Atrasado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">R$ {totalAtrasado.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && pagamentos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Nenhum pagamento
                  </TableCell>
                </TableRow>
              )}
              {pagamentos.map((p: any) => {
                const atrasado =
                  p.status !== "pago" && p.data_vencimento && p.data_vencimento < today;
                const status = atrasado ? "atrasado" : p.status;
                return (
                  <TableRow key={p.id}>
                    <TableCell>#{p.ordens_servico?.numero}</TableCell>
                    <TableCell>{p.ordens_servico?.clientes?.nome}</TableCell>
                    <TableCell>R$ {Number(p.valor).toFixed(2)}</TableCell>
                    <TableCell>
                      {p.parcela}/{p.total_parcelas}
                    </TableCell>
                    <TableCell>{p.data_vencimento ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[status] ?? "outline"}>{status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status !== "pago" && (
                        <Button size="sm" variant="outline" onClick={() => marcarPago(p)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Marcar pago
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
