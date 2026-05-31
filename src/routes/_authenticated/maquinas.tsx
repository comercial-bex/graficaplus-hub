import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Factory, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maquinas")({
  head: () => ({ meta: [{ title: "Máquinas — BEX PRINT OS" }] }),
  component: MaquinasPage,
});

function MaquinasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("");

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("maquinas").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("maquinas").insert({ nome, tipo: tipo || null, ativa: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Máquina cadastrada");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
      setOpen(false); setNome(""); setTipo("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, ativa }: { id: string; ativa: boolean }) => {
      const { error } = await supabase.from("maquinas").update({ ativa }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maquinas"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Máquinas</h1>
          <p className="text-muted-foreground">Equipamentos disponíveis para produção</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Nova máquina</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Cadastrar máquina</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Plotter Roland XR-640" />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Impressão eco-solvente" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={!nome || create.isPending}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : maquinas.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhuma máquina cadastrada</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {maquinas.map((m) => (
            <Card key={m.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Factory className="h-5 w-5 text-accent" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{m.nome}</CardTitle>
                      <div className="text-xs text-muted-foreground">{m.tipo || "—"}</div>
                    </div>
                  </div>
                  <Badge variant={m.ativa ? "default" : "secondary"}>{m.ativa ? "Ativa" : "Inativa"}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" className="w-full" onClick={() => toggle.mutate({ id: m.id, ativa: !m.ativa })}>
                  {m.ativa ? "Desativar" : "Ativar"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
