import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Factory, Plus, Pencil, Zap, Gauge, Timer } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";

export const Route = createFileRoute("/_authenticated/maquinas")({
  head: () => ({
    meta: [
      { title: "Máquinas e hora-máquina — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Cadastro de equipamentos com custo por hora, potência, setup e velocidade para o cálculo real de produção.",
      },
      { property: "og:title", content: "Máquinas e hora-máquina — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Custo por hora, potência e capacidade de cada equipamento da gráfica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MaquinasPage,
});

type Form = {
  id?: string;
  nome: string;
  tipo: string;
  setor: string;
  custo_hora: string;
  potencia_kw: string;
  setup_min: string;
  velocidade_m2_h: string;
  disponibilidade_pct: string;
};

const emptyForm: Form = {
  nome: "",
  tipo: "",
  setor: "",
  custo_hora: "0",
  potencia_kw: "0",
  setup_min: "0",
  velocidade_m2_h: "0",
  disponibilidade_pct: "100",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function MaquinasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("*")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        nome: form.nome,
        tipo: form.tipo || null,
        setor: form.setor || null,
        custo_hora: Number(form.custo_hora) || 0,
        potencia_kw: Number(form.potencia_kw) || 0,
        setup_min: Number(form.setup_min) || 0,
        velocidade_m2_h: Number(form.velocidade_m2_h) || 0,
        disponibilidade_pct: Number(form.disponibilidade_pct) || 0,
      };
      if (form.id) {
        const { error } = await supabase.from("maquinas").update(payload).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("maquinas").insert({ ...payload, ativa: true });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Máquina atualizada" : "Máquina cadastrada");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, ativa }: { id: string; ativa: boolean }) => {
      const { error } = await supabase.from("maquinas").update({ ativa }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maquinas"] }),
  });

  const ativas = maquinas.filter((m) => m.ativa);
  const semCusto = maquinas.filter((m) => !m.custo_hora || Number(m.custo_hora) <= 0);
  const custoMedio =
    ativas.length > 0
      ? ativas.reduce((a, m) => a + Number(m.custo_hora ?? 0), 0) / ativas.length
      : 0;

  const openNew = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (m: (typeof maquinas)[number]) => {
    setForm({
      id: m.id,
      nome: m.nome,
      tipo: m.tipo ?? "",
      setor: m.setor ?? "",
      custo_hora: String(m.custo_hora ?? 0),
      potencia_kw: String(m.potencia_kw ?? 0),
      setup_min: String(m.setup_min ?? 0),
      velocidade_m2_h: String(m.velocidade_m2_h ?? 0),
      disponibilidade_pct: String(m.disponibilidade_pct ?? 100),
    });
    setOpen(true);
  };

  const field = (key: keyof Form, label: string, placeholder?: string, type = "text") => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={form[key] as string}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div>
      <SectionHeader
        breadcrumb="Produção"
        title="Máquinas e hora-máquina"
        description="Cada equipamento precisa de custo/hora para que o orçamento e o resultado da OS fechem com a realidade."
        actions={
          <NeonButton onClick={openNew}>
            <Plus className="h-4 w-4" />
            Nova máquina
          </NeonButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <KpiCard label="Máquinas ativas" value={ativas.length} icon={Factory} tone="cyan" />
        <KpiCard
          label="Custo/hora médio"
          value={brl(custoMedio)}
          icon={Gauge}
          tone="lime"
          hint="Base para o bloco Processos do orçamento"
        />
        <KpiCard
          label="Sem custo definido"
          value={semCusto.length}
          icon={Timer}
          tone={semCusto.length > 0 ? "magenta" : "muted"}
          hint={semCusto.length > 0 ? "O cálculo fica subestimado" : "Tudo parametrizado"}
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : maquinas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma máquina cadastrada
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {maquinas.map((m) => (
            <Card key={m.id} className="border-border">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Factory className="h-5 w-5 text-[color:var(--bex-cyan)]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold truncate">{m.nome}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.tipo || "—"}
                        {m.setor ? ` · ${m.setor}` : ""}
                      </div>
                    </div>
                  </div>
                  <StatusChip
                    label={m.ativa ? "Ativa" : "Inativa"}
                    tone={m.ativa ? "lime" : "muted"}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Custo/hora
                    </div>
                    <div className="font-bold">{brl(Number(m.custo_hora ?? 0))}</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Potência
                    </div>
                    <div className="font-bold">{Number(m.potencia_kw ?? 0)} kW</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Setup
                    </div>
                    <div className="font-bold">{Number(m.setup_min ?? 0)} min</div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Velocidade
                    </div>
                    <div className="font-bold">{Number(m.velocidade_m2_h ?? 0)} m²/h</div>
                  </div>
                </div>

                {Number(m.custo_hora ?? 0) <= 0 && (
                  <div className="flex items-center gap-2 text-xs text-[color:var(--bex-magenta)]">
                    <Zap className="h-3.5 w-3.5" />
                    Defina o custo/hora para esta máquina entrar no cálculo
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(m)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle.mutate({ id: m.id, ativa: !m.ativa })}
                  >
                    {m.ativa ? "Desativar" : "Ativar"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar máquina" : "Cadastrar máquina"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("nome", "Nome *", "Plotter Roland XR-640")}</div>
            {field("tipo", "Tipo", "Impressão eco-solvente")}
            {field("setor", "Setor", "Impressão")}
            {field("custo_hora", "Custo/hora (R$)", "40", "number")}
            {field("potencia_kw", "Potência (kW)", "1.5", "number")}
            {field("setup_min", "Setup (min)", "15", "number")}
            {field("velocidade_m2_h", "Velocidade (m²/h)", "12", "number")}
            <div className="sm:col-span-2">
              {field("disponibilidade_pct", "Disponibilidade (%)", "85", "number")}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={!form.nome || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
