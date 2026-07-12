import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Boxes, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/filamentos-3d")({
  head: () => ({ meta: [{ title: "Filamentos 3D — BEX PRINT OS" }] }),
  component: FilamentosPage,
});

const TIPOS = ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PC", "Outro"];

type FormState = {
  material_id: string | null;
  nome: string;
  tipo: string;
  marca: string;
  cor: string;
  custo_por_kg: string;
  peso_kg: string;
  diametro: string;
  fator_aproveitamento: string;
};

const EMPTY: FormState = {
  material_id: null,
  nome: "",
  tipo: "PLA",
  marca: "",
  cor: "",
  custo_por_kg: "",
  peso_kg: "1",
  diametro: "1.75",
  fator_aproveitamento: "1",
};

function FilamentosPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const { data: filamentos = [], isLoading } = useQuery({
    queryKey: ["filamentos-3d"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("materiais_3d_filamento")
        .select(
          "material_id, tipo, marca, cor, diametro, peso_nominal, custo_compra, fator_aproveitamento, custo_por_grama_calculado, materiais(nome)",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("upsert_filamento_3d", {
        p_material_id: form.material_id,
        p_nome: form.nome,
        p_tipo: form.tipo,
        p_marca: form.marca || null,
        p_cor: form.cor || null,
        p_custo_por_kg: Number(form.custo_por_kg) || 0,
        p_peso_kg: Number(form.peso_kg) || 1,
        p_diametro: Number(form.diametro) || 1.75,
        p_fator_aproveitamento: Number(form.fator_aproveitamento) || 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.material_id ? "Filamento atualizado" : "Filamento cadastrado");
      qc.invalidateQueries({ queryKey: ["filamentos-3d"] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (material_id: string) => {
      const { error } = await (supabase.rpc as any)("delete_filamento_3d", { p_material_id: material_id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Filamento removido");
      qc.invalidateQueries({ queryKey: ["filamentos-3d"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(f: any) {
    const pesoKg = Number(f.peso_nominal ?? 1000) / 1000;
    setForm({
      material_id: f.material_id,
      nome: f.materiais?.nome ?? "",
      tipo: f.tipo ?? "PLA",
      marca: f.marca ?? "",
      cor: f.cor ?? "",
      custo_por_kg: pesoKg > 0 ? String(Number(f.custo_compra ?? 0) / pesoKg) : "",
      peso_kg: String(pesoKg),
      diametro: String(f.diametro ?? 1.75),
      fator_aproveitamento: String(f.fator_aproveitamento ?? 1),
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Filamentos 3D</h1>
          <p className="text-muted-foreground">
            Cadastro de filamentos com valor por kg — base do custo de material dos orçamentos 3D
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              Novo filamento
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.material_id ? "Editar filamento" : "Cadastrar filamento"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Nome *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="PLA 3DX Natural"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Marca</Label>
                <Input
                  value={form.marca}
                  onChange={(e) => setForm({ ...form, marca: e.target.value })}
                  placeholder="3DX / eSUN / Voolt"
                />
              </div>
              <div className="space-y-2">
                <Label>Cor</Label>
                <Input value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} placeholder="Natural" />
              </div>
              <div className="space-y-2">
                <Label>Diâmetro (mm)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.diametro}
                  onChange={(e) => setForm({ ...form, diametro: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Valor por kg (R$) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.custo_por_kg}
                  onChange={(e) => setForm({ ...form, custo_por_kg: e.target.value })}
                  placeholder="150.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Peso do carretel (kg)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.peso_kg}
                  onChange={(e) => setForm({ ...form, peso_kg: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Fator de aproveitamento (0–1)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.fator_aproveitamento}
                  onChange={(e) => setForm({ ...form, fator_aproveitamento: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Custo por grama = valor por kg ÷ 1000 ÷ fator.{" "}
                  {Number(form.custo_por_kg) > 0 && (
                    <span className="font-mono">
                      ≈ R$ {(Number(form.custo_por_kg) / 1000 / (Number(form.fator_aproveitamento) || 1)).toFixed(4)}/g
                    </span>
                  )}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => save.mutate()} disabled={!form.nome || !form.custo_por_kg || save.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : filamentos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum filamento cadastrado
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filamentos.map((f: any) => {
            const pesoKg = Number(f.peso_nominal ?? 1000) / 1000;
            const rsKg = pesoKg > 0 ? Number(f.custo_compra ?? 0) / pesoKg : 0;
            return (
              <Card key={f.material_id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Boxes className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{f.materiais?.nome ?? "—"}</CardTitle>
                        <div className="text-xs text-muted-foreground">
                          {[f.tipo, f.marca, f.cor].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                    <Badge variant="secondary">{f.tipo}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Valor por kg</div>
                      <div className="font-mono font-semibold">R$ {rsKg.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Custo por grama</div>
                      <div className="font-mono font-semibold">
                        R$ {Number(f.custo_por_grama_calculado ?? 0).toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(f)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm("Remover este filamento?")) remove.mutate(f.material_id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
