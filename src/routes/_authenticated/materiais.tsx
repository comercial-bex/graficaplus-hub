import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/materiais")({
  head: () => ({ meta: [{ title: "Materiais — BEX PRINT OS" }] }),
  component: MateriaisPage,
});

function MateriaisPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", unidade: "un", estoque: "0", custo_unitario: "" });

  const { data: materiais = [], isLoading } = useQuery({
    queryKey: ["materiais"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materiais").select("*").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("materiais").insert({
        nome: form.nome,
        unidade: form.unidade || "un",
        estoque: Number(form.estoque) || 0,
        custo_unitario: form.custo_unitario ? Number(form.custo_unitario) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Material cadastrado");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      setOpen(false);
      setForm({ nome: "", unidade: "un", estoque: "0", custo_unitario: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalValor = materiais.reduce((sum, m) => sum + Number(m.estoque) * Number(m.custo_unitario || 0), 0);
  const baixoEstoque = materiais.filter((m) => Number(m.estoque) < 10).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Materiais</h1>
          <p className="text-muted-foreground">Insumos e matéria-prima em estoque</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Novo material</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cadastrar material</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Lona 440g" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Unidade</Label>
                  <Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} placeholder="m², un, kg" />
                </div>
                <div className="space-y-2">
                  <Label>Estoque inicial</Label>
                  <Input type="number" step="0.01" value={form.estoque} onChange={(e) => setForm({ ...form, estoque: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Custo unitário (R$)</Label>
                <Input type="number" step="0.01" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!form.nome || create.isPending}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><Package className="h-8 w-8 text-primary" /><div><div className="text-2xl font-bold">{materiais.length}</div><div className="text-xs text-muted-foreground">Itens cadastrados</div></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><AlertTriangle className="h-8 w-8 text-destructive" /><div><div className="text-2xl font-bold">{baixoEstoque}</div><div className="text-xs text-muted-foreground">Em baixo estoque (&lt;10)</div></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div><div className="text-2xl font-bold">R$ {totalValor.toFixed(2)}</div><div className="text-xs text-muted-foreground">Valor total em estoque</div></div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">Carregando...</div>
          ) : materiais.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">Nenhum material cadastrado</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materiais.map((m) => {
                  const baixo = Number(m.estoque) < 10;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.nome}</TableCell>
                      <TableCell>{m.unidade}</TableCell>
                      <TableCell className="text-right font-mono">{Number(m.estoque).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{m.custo_unitario ? `R$ ${Number(m.custo_unitario).toFixed(2)}` : "—"}</TableCell>
                      <TableCell className="text-right font-mono">R$ {(Number(m.estoque) * Number(m.custo_unitario || 0)).toFixed(2)}</TableCell>
                      <TableCell><Badge variant={baixo ? "destructive" : "default"}>{baixo ? "Baixo" : "OK"}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
