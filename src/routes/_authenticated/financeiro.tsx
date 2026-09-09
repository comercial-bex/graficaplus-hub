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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, CheckCircle2 , Undo2} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { Textarea } from "@/components/ui/textarea";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";
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
  const { hasPermission } = useAuth();
  const podeEstornar = hasPermission("pagamentos.reverse");
  const [estorno, setEstorno] = useState<any | null>(null);
  const [motivoEstorno, setMotivoEstorno] = useState("");
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
    if (error) return toast.error(mensagemErro(error));
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

  /**
   * Estorno de pagamento.
   *
   * Confirmar já existia; desfazer, não. Um lançamento errado só saía do
   * sistema por SQL — e a função `estornar_pagamento` estava pronta e sem
   * chamador desde sempre.
   *
   * O motivo é obrigatório de propósito: estorno sem justificativa transforma o
   * histórico financeiro em algo que não dá para auditar. Quem confere depois
   * precisa saber se foi engano de digitação, devolução ou cancelamento.
   */
  async function estornar() {
    if (!estorno || !motivoEstorno.trim()) return;
    const { error } = await (supabase.rpc as any)("estornar_pagamento", {
      p_pagamento_id: estorno.id,
      p_motivo: motivoEstorno.trim(),
    });
    if (error) return toast.error(error.message);
    toast.success("Pagamento estornado");
    setEstorno(null);
    setMotivoEstorno("");
    qc.invalidateQueries({ queryKey: ["pagamentos"] });
    qc.invalidateQueries({ queryKey: ["fluxo-caixa"] });
  }

  async function marcarPago(p: any) {
    const { error } = await (supabase.rpc as any)("confirmar_pagamento_registrado", {
      p_pagamento_id: p.id,
      p_data: today,
      p_referencia_externa: null,
    });
    if (error) return toast.error(mensagemErro(error));
    toast.success("Pagamento confirmado");
    qc.invalidateQueries({ queryKey: ["pagamentos"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
            <DicaIcone texto={dicaTela("/financeiro")} rotulo="Financeiro" lado="bottom" className="h-5 w-5" />
          </div>
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
                <Label className="flex items-center gap-1.5">OS *<DicaIcone texto={dicaCampo("/financeiro", "OS *")} rotulo="OS *" /></Label>
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
                  <Label className="flex items-center gap-1.5">Valor (R$) *<DicaIcone texto={dicaCampo("/financeiro", "Valor (R$) *")} rotulo="Valor (R$) *" /></Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor}
                    onChange={(e) => setForm({ ...form, valor: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">Vencimento<DicaIcone texto={dicaCampo("/financeiro", "Vencimento")} rotulo="Vencimento" /></Label>
                  <Input
                    type="date"
                    value={form.data_vencimento}
                    onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">Forma<DicaIcone texto={dicaCampo("/financeiro", "Forma")} rotulo="Forma" /></Label>
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
                  <Label className="flex items-center gap-1.5">Parcela<DicaIcone texto={dicaCampo("/financeiro", "Parcela")} rotulo="Parcela" /></Label>
                  <Input
                    type="number"
                    min="1"
                    value={form.parcela}
                    onChange={(e) => setForm({ ...form, parcela: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">Total parcelas<DicaIcone texto={dicaCampo("/financeiro", "Total parcelas")} rotulo="Total parcelas" /></Label>
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
                      {p.status !== "pago" ? (
                        <Button size="sm" variant="outline" onClick={() => marcarPago(p)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Marcar pago
                        </Button>
                      ) : p.pagamento_estornado_id ? (
                        <span className="text-xs text-muted-foreground">estorno</span>
                      ) : (
                        podeEstornar && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEstorno(p);
                              setMotivoEstorno("");
                            }}
                          >
                            <Undo2 className="h-3 w-3 mr-1" /> Estornar
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={!!estorno} onOpenChange={(o) => !o && setEstorno(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estornar pagamento</DialogTitle>
            <DialogDescription>
              {estorno
                ? `R$ ${Number(estorno.valor).toFixed(2)} da OS #${estorno.ordens_servico?.numero ?? "—"}. O valor volta a constar como pendente.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-estorno">Por que está estornando? *</Label>
            <Textarea
              id="motivo-estorno"
              rows={3}
              value={motivoEstorno}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMotivoEstorno(e.target.value)}
              placeholder="Erro de digitação · devolução ao cliente · cobrança cancelada"
            />
            <p className="text-xs text-muted-foreground">
              Estorno sem justificativa deixa o histórico financeiro impossível de auditar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstorno(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={!motivoEstorno.trim()} onClick={estornar}>
              Estornar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
