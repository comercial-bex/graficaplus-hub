import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/orcamentos")({
  head: () => ({ meta: [{ title: "Orçamentos — BEX PRINT OS" }] }),
  component: OrcamentosPage,
});

const statusLabels: Record<string, { label: string; variant: any }> = {
  rascunho: { label: "Rascunho", variant: "secondary" },
  enviado: { label: "Enviado", variant: "default" },
  aprovado: { label: "Aprovado", variant: "default" },
  rejeitado: { label: "Rejeitado", variant: "destructive" },
  expirado: { label: "Expirado", variant: "outline" },
  convertido: { label: "Convertido em OS", variant: "default" },
};

function OrcamentosPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ cliente_id: "", titulo: "", valor_total: "" });

  const { data: orcamentos = [], isLoading } = useQuery({
    queryKey: ["orcamentos", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("orcamentos", canSeeFinancials)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-select"],
    queryFn: async () => {
      const { data } = await supabase.from("clientes").select("id, nome").order("nome");
      return data ?? [];
    },
  });

  async function handleCreate() {
    if (!form.cliente_id || !form.titulo) return toast.error("Cliente e título são obrigatórios");
    const valor = parseFloat(form.valor_total || "0");
    const { error } = await supabase.from("orcamentos").insert({
      cliente_id: form.cliente_id,
      titulo: form.titulo,
      valor_total: valor,
      valor_subtotal: valor,
    });
    if (error) return toast.error(error.message);
    toast.success("Orçamento criado");
    setOpen(false);
    setForm({ cliente_id: "", titulo: "", valor_total: "" });
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
  }

  async function converterEmOS(orc: any) {
    const { data, error } = await supabase.rpc("converter_orcamento_em_os", {
      p_orcamento_id: orc.id,
      p_opcoes: {},
    });
    if (error) return toast.error(error.message);
    const osId = typeof data === "object" && data && "os_id" in data ? String(data.os_id) : "";
    toast.success(`OS criada${osId ? ` (${osId})` : ""}`);
    qc.invalidateQueries({ queryKey: ["orcamentos"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orçamentos</h1>
          <p className="text-muted-foreground">Propostas comerciais</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Novo orçamento
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo orçamento</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <Select
                  value={form.cliente_id}
                  onValueChange={(v) => setForm({ ...form, cliente_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientes.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Valor total (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.valor_total}
                  onChange={(e) => setForm({ ...form, valor_total: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                {canSeeFinancials && <TableHead>Valor</TableHead>}
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && orcamentos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhum orçamento
                  </TableCell>
                </TableRow>
              )}
              {orcamentos.map((o: any) => {
                const s = statusLabels[o.status] ?? {
                  label: o.status,
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link to="/orcamentos/$id" params={{ id: o.id }} className="hover:underline">
                        #{o.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link to="/orcamentos/$id" params={{ id: o.id }} className="hover:underline">
                        {o.titulo}
                      </Link>
                    </TableCell>
                    <TableCell>{o.cliente_nome}</TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    {canSeeFinancials && (
                      <TableCell>R$ {Number(o.valor_total).toFixed(2)}</TableCell>
                    )}
                    <TableCell className="text-right">
                      {o.status !== "convertido" && (
                        <Button size="sm" variant="outline" onClick={() => converterEmOS(o)}>
                          Converter em OS <ArrowRight className="h-3 w-3 ml-1" />
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
