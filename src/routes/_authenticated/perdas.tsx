import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Plus, TrendingDown, Recycle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/perdas")({
  head: () => ({
    meta: [
      { title: "Perdas e desperdício — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Registro de refugo por OS, motivo e máquina, com custo perdido e percentual de desperdício da produção.",
      },
      { property: "og:title", content: "Perdas e desperdício — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Quanto material foi perdido, por qual motivo e quanto isso custou.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerdasPage,
});

type PerdaRow = { custo_total: number | null; custo_unitario: number; quantidade_perdida: number };
const custoDaPerda = (p: PerdaRow) =>
  Number(p.custo_total ?? Number(p.custo_unitario ?? 0) * Number(p.quantidade_perdida ?? 0));

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const motivos = [
  { value: "erro_arte", label: "Erro de arte" },
  { value: "falha_impressao", label: "Falha de impressão" },
  { value: "material_defeituoso", label: "Material defeituoso" },
  { value: "refile", label: "Refile / sobra" },
  { value: "teste_cor", label: "Teste de cor" },
  { value: "outro", label: "Outro" },
] as const;

type Motivo = (typeof motivos)[number]["value"];

type Form = {
  os_id: string;
  material_id: string;
  maquina_id: string;
  motivo: Motivo;
  quantidade: string;
  custo_unitario: string;
  unidade: string;
  observacoes: string;
};

const emptyForm: Form = {
  os_id: "",
  material_id: "",
  maquina_id: "",
  motivo: "erro_arte",
  quantidade: "0",
  custo_unitario: "0",
  unidade: "un",
  observacoes: "",
};

function PerdasPage() {
  const { canSeeFinancials } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: perdas = [], isLoading } = useQuery({
    queryKey: ["os-perdas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_perdas")
        .select("*, ordens_servico(numero), materiais(nome, unidade), maquinas(nome)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: ordens = [] } = useQuery({
    queryKey: ["os-simples"],
    queryFn: async () => {
      // A tabela base tem SELECT revogado para authenticated; ler pela view operacional.
      const { data, error } = await fromFinancialView("ordens_servico", false)
        .select("id, numero, titulo")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as { id: string; numero: number; titulo: string }[];
    },
  });

  /**
   * O custo vem do cadastro, não da memória de quem registra.
   *
   * Antes esta consulta pedia só `id, nome, unidade`, e o formulário exigia o
   * custo unitário digitado — com padrão ZERO. Resultado: a tela de Perdas
   * somava R$ 0,00 e parecia dizer "não há desperdício", quando dizia "ninguém
   * digitou o preço".
   *
   * `materiais_financeiro` é a via oficial do custo (a tabela base não expõe a
   * coluna nem para quem pode vê-la). Quem não pode ver valores continua
   * registrando a perda — só não vê o custo, e o gatilho no banco preenche.
   */
  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais-com-custo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from(canSeeFinancials ? "materiais_financeiro" : "materiais")
        .select(canSeeFinancials ? "id, nome, unidade, custo_unitario" : "id, nome, unidade")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas-simples"],
    queryFn: async () => {
      const { data, error } = await supabase.from("maquinas").select("id, nome").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("os_perdas").insert({
        os_id: form.os_id || null,
        material_id: form.material_id || null,
        maquina_id: form.maquina_id || null,
        motivo: form.motivo,
        quantidade_perdida: Number(form.quantidade) || 0,
        // 0 é sinal para o gatilho buscar o custo real do material — deixar em
        // branco é melhor que chutar, porque zero explícito seria aceito.
        custo_unitario: Number(form.custo_unitario) || 0,
        unidade: form.unidade || "un",
        observacoes: form.observacoes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perda registrada");
      qc.invalidateQueries({ queryKey: ["os-perdas"] });
      setOpen(false);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpis = useMemo(() => {
    const custoTotal = perdas.reduce((a, p) => a + custoDaPerda(p), 0);
    const mesAtual = new Date().toISOString().slice(0, 7);
    const custoMes = perdas
      .filter((p) => String(p.created_at ?? "").slice(0, 7) === mesAtual)
      .reduce((a, p) => a + custoDaPerda(p), 0);
    return { custoTotal, custoMes, registros: perdas.length };
  }, [perdas]);

  const porMotivo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const p of perdas) {
      const key = motivos.find((m) => m.value === p.motivo)?.label ?? String(p.motivo);
      mapa.set(key, (mapa.get(key) ?? 0) + custoDaPerda(p));
    }
    return [...mapa.entries()]
      .map(([motivo, custo]) => ({ motivo, custo }))
      .sort((a, b) => b.custo - a.custo);
  }, [perdas]);

  return (
    <div>
      <SectionHeader
        breadcrumb="Produção"
        title="Perdas e desperdício"
        description="Todo refugo custa material, hora-máquina e prazo. Registrar o motivo é o que permite reduzir."
        actions={
          <NeonButton
            onClick={() => {
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Registrar perda
          </NeonButton>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <KpiCard label="Custo perdido (total)" value={brl(kpis.custoTotal)} icon={TrendingDown} tone="magenta" />
        <KpiCard label="Custo perdido no mês" value={brl(kpis.custoMes)} icon={AlertTriangle} tone="magenta" />
        <KpiCard label="Registros" value={kpis.registros} icon={Recycle} tone="cyan" />
      </div>

      {porMotivo.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Custo por motivo
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porMotivo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="motivo" stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                  <RTooltip
                    formatter={(v) => brl(Number(v))}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="custo" fill="var(--bex-magenta)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">Carregando...</div>
          ) : perdas.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              Nenhuma perda registrada ainda
            </div>
          ) : (
            <div className="divide-y divide-border">
              {perdas.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {p.materiais?.nome ?? "Material não informado"}
                      {p.quantidade_perdida
                        ? ` · ${Number(p.quantidade_perdida)} ${p.unidade ?? p.materiais?.unidade ?? ""}`
                        : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.ordens_servico?.numero ? `OS ${p.ordens_servico.numero} · ` : ""}
                      {p.maquinas?.nome ?? "sem máquina"} ·{" "}
                      {new Date(String(p.created_at)).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusChip
                      label={motivos.find((m) => m.value === p.motivo)?.label ?? String(p.motivo)}
                      tone="amber"
                    />
                    <span className="font-bold tabular-nums text-[color:var(--bex-magenta)]">
                      {brl(custoDaPerda(p))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar perda</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>OS</Label>
              <Select value={form.os_id} onValueChange={(v) => setForm((f) => ({ ...f, os_id: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {ordens.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.numero} — {o.titulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <Select value={form.motivo} onValueChange={(v) => setForm((f) => ({ ...f, motivo: v as Motivo }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {motivos.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Material</Label>
              <Select
                value={form.material_id}
                onValueChange={(v) => {
                  const m = (materiais as any[]).find((x) => x.id === v);
                  setForm((f) => ({
                    ...f,
                    material_id: v,
                    // Puxa unidade e custo do cadastro: digitar de novo é como
                    // o número diverge.
                    unidade: m?.unidade ?? f.unidade,
                    custo_unitario:
                      m?.custo_unitario != null ? String(m.custo_unitario) : f.custo_unitario,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(materiais as any[]).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Máquina</Label>
              <Select
                value={form.maquina_id}
                onValueChange={(v) => setForm((f) => ({ ...f, maquina_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {maquinas.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantidade perdida</Label>
              <Input
                type="number"
                step="0.01"
                value={form.quantidade}
                onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Custo unitário (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.custo_unitario}
                onChange={(e) => setForm((f) => ({ ...f, custo_unitario: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Observações</Label>
              <Textarea
                value={form.observacoes}
                onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
                placeholder="O que aconteceu e como evitar da próxima vez"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
