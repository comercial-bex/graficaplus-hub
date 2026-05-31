import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/os")({
  head: () => ({ meta: [{ title: "Ordens de Serviço — BEX PRINT OS" }] }),
  component: OSPage,
});

function OSPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    cliente_id: "", titulo: "", briefing: "", prazo_entrega: "", prioridade: "3", valor_total: "",
  });

  const { data: os = [], isLoading } = useQuery({
    queryKey: ["os-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("*, clientes(nome)")
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
    const { data, error } = await supabase.from("ordens_servico").insert({
      cliente_id: form.cliente_id,
      titulo: form.titulo,
      briefing: form.briefing || null,
      prazo_entrega: form.prazo_entrega || null,
      prioridade: parseInt(form.prioridade),
      valor_total: parseFloat(form.valor_total || "0"),
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success(`OS #${data.numero} criada`);
    setOpen(false);
    setForm({ cliente_id: "", titulo: "", briefing: "", prazo_entrega: "", prioridade: "3", valor_total: "" });
    qc.invalidateQueries({ queryKey: ["os-list"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ordens de Serviço</h1>
          <p className="text-muted-foreground">Acompanhe todas as OS da produção</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova OS</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Nova Ordem de Serviço</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <Select value={form.cliente_id} onValueChange={(v) => setForm({ ...form, cliente_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Título *</Label><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></div>
              <div className="space-y-2"><Label>Briefing</Label><Textarea rows={3} value={form.briefing} onChange={(e) => setForm({ ...form, briefing: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Prazo entrega</Label><Input type="date" value={form.prazo_entrega} onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select value={form.prioridade} onValueChange={(v) => setForm({ ...form, prioridade: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Urgente</SelectItem>
                      <SelectItem value="2">2 — Alta</SelectItem>
                      <SelectItem value="3">3 — Normal</SelectItem>
                      <SelectItem value="4">4 — Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {canSeeFinancials && (
                <div className="space-y-2"><Label>Valor total (R$)</Label><Input type="number" step="0.01" value={form.valor_total} onChange={(e) => setForm({ ...form, valor_total: e.target.value })} /></div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Criar OS</Button>
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
                <TableHead>Prazo</TableHead>
                {canSeeFinancials && <TableHead>Valor</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && os.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma OS</TableCell></TableRow>}
              {os.map((o: any) => (
                <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell><Link to="/os/$id" params={{ id: o.id }} className="text-accent hover:underline">#{o.numero}</Link></TableCell>
                  <TableCell className="font-medium"><Link to="/os/$id" params={{ id: o.id }}>{o.titulo}</Link></TableCell>
                  <TableCell>{o.clientes?.nome}</TableCell>
                  <TableCell><Badge variant="outline">{o.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell>{o.prazo_entrega ?? "—"}</TableCell>
                  {canSeeFinancials && <TableCell>R$ {Number(o.valor_total).toFixed(2)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
