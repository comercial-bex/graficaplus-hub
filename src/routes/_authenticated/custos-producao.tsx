import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Users, Plus, Pencil, Calculator } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/_authenticated/custos-producao")({
  head: () => ({
    meta: [
      { title: "Custos de mão de obra — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Custo por hora e encargos de cada função da produção, usado no bloco Mão de obra do orçamento.",
      },
      { property: "og:title", content: "Custos de mão de obra — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Parametrize o custo/hora de designers, operadores e auxiliares.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustosProducaoPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Form = {
  id?: string;
  funcao: string;
  setor: string;
  custo_hora: string;
  encargos_pct: string;
  ativo: boolean;
  observacoes: string;
};

const emptyForm: Form = {
  funcao: "",
  setor: "",
  custo_hora: "0",
  encargos_pct: "0",
  ativo: true,
  observacoes: "",
};

function CustosProducaoPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: funcoes = [], isLoading } = useQuery({
    queryKey: ["custos-mao-de-obra"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custos_mao_de_obra")
        .select("*")
        .order("funcao");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        funcao: form.funcao,
        setor: form.setor || null,
        custo_hora: Number(form.custo_hora) || 0,
        encargos_pct: Number(form.encargos_pct) || 0,
        ativo: form.ativo,
        observacoes: form.observacoes || null,
      };
      if (form.id) {
        const { error } = await supabase
          .from("custos_mao_de_obra")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("custos_mao_de_obra").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Função salva");
      qc.invalidateQueries({ queryKey: ["custos-mao-de-obra"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const ativos = funcoes.filter((f) => f.ativo);
  const custoTotalHora = ativos.reduce(
    (acc, f) => acc + Number(f.custo_hora) * (1 + Number(f.encargos_pct)),
    0,
  );
  const medio = ativos.length > 0 ? custoTotalHora / ativos.length : 0;

  return (
    <div>
      <SectionHeader
        breadcrumb="Catálogo & Estoque"
        title="Custos de mão de obra"
        description="Custo/hora com encargos de cada função. É o terceiro bloco do detalhamento de cálculo, junto com Materiais e Processos."
        actions={
          <NeonButton
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nova função
          </NeonButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <KpiCard label="Funções ativas" value={ativos.length} icon={Users} tone="cyan" />
        <KpiCard label="Custo/hora médio" value={brl(medio)} icon={Calculator} tone="lime" />
        <KpiCard
          label="Custo/hora somado"
          value={brl(custoTotalHora)}
          tone="magenta"
          hint="Se toda a equipe estiver alocada ao mesmo tempo"
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Carregando...</div>
      ) : funcoes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma função cadastrada. Comece por Designer, Operador de impressora e Auxiliar de
            acabamento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {funcoes.map((f) => {
            const total = Number(f.custo_hora) * (1 + Number(f.encargos_pct));
            return (
              <Card key={f.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold truncate">{f.funcao}</div>
                      <div className="text-xs text-muted-foreground">{f.setor || "—"}</div>
                    </div>
                    <StatusChip label={f.ativo ? "Ativa" : "Inativa"} tone={f.ativo ? "lime" : "muted"} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Base
                      </div>
                      <div className="font-bold">{brl(Number(f.custo_hora))}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Encargos
                      </div>
                      <div className="font-bold">{(Number(f.encargos_pct) * 100).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Real
                      </div>
                      <div className="font-bold text-[color:var(--bex-lime)]">{brl(total)}</div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setForm({
                        id: f.id,
                        funcao: f.funcao,
                        setor: f.setor ?? "",
                        custo_hora: String(f.custo_hora),
                        encargos_pct: String(f.encargos_pct),
                        ativo: f.ativo,
                        observacoes: f.observacoes ?? "",
                      });
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Editar
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar função" : "Nova função"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label>Função *</Label>
              <Input
                value={form.funcao}
                onChange={(e) => setForm((f) => ({ ...f, funcao: e.target.value }))}
                placeholder="Operador de impressora"
              />
            </div>
            <div className="space-y-2">
              <Label>Setor</Label>
              <Input
                value={form.setor}
                onChange={(e) => setForm((f) => ({ ...f, setor: e.target.value }))}
                placeholder="Impressão"
              />
            </div>
            <div className="space-y-2">
              <Label>Custo/hora (R$)</Label>
              <Input
                type="number"
                value={form.custo_hora}
                onChange={(e) => setForm((f) => ({ ...f, custo_hora: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Encargos (0,8 = 80%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.encargos_pct}
                onChange={(e) => setForm((f) => ({ ...f, encargos_pct: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-3 pt-7">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))}
              />
              <Label>Ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => save.mutate()} disabled={!form.funcao || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
