import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ArrowDownCircle, ArrowUpCircle, Plus, Wallet, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { KpiCard } from "@/components/bex/KpiCard";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/_authenticated/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de caixa — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Entradas e saídas previstas e realizadas, contas a pagar e projeção de saldo da gráfica.",
      },
      { property: "og:title", content: "Fluxo de caixa — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Contas a pagar, recebimentos e projeção de saldo em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FluxoCaixaPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date().toISOString().slice(0, 10);

const categorias = [
  "materia_prima",
  "energia",
  "aluguel",
  "salarios",
  "impostos",
  "manutencao",
  "software",
  "marketing",
  "terceiros",
  "geral",
];

type ContaForm = {
  id?: string;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: string;
  vencimento: string;
  recorrente: boolean;
  periodicidade: string;
};

const emptyConta: ContaForm = {
  descricao: "",
  fornecedor: "",
  categoria: "geral",
  valor: "0",
  vencimento: hoje(),
  recorrente: false,
  periodicidade: "mensal",
};

type MovForm = {
  tipo: string;
  descricao: string;
  categoria: string;
  valor: string;
  data: string;
};

const emptyMov: MovForm = {
  tipo: "entrada",
  descricao: "",
  categoria: "geral",
  valor: "0",
  data: hoje(),
};

function FluxoCaixaPage() {
  const qc = useQueryClient();
  const [contaOpen, setContaOpen] = useState(false);
  const [movOpen, setMovOpen] = useState(false);
  const [conta, setConta] = useState<ContaForm>(emptyConta);
  const [mov, setMov] = useState<MovForm>(emptyMov);

  const { data: fluxo = [] } = useQuery({
    queryKey: ["vw-fluxo-caixa"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vw_fluxo_caixa")
        .select("*")
        .order("data", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ["contas-pagar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_pagar")
        .select("*")
        .order("vencimento", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: movimentos = [] } = useQuery({
    queryKey: ["caixa-movimentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caixa_movimentos")
        .select("*")
        .order("data", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const salvarConta = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contas_pagar").insert({
        descricao: conta.descricao,
        fornecedor: conta.fornecedor || null,
        categoria: conta.categoria,
        valor: Number(conta.valor) || 0,
        vencimento: conta.vencimento,
        recorrente: conta.recorrente,
        periodicidade: conta.recorrente ? conta.periodicidade : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta lançada");
      qc.invalidateQueries({ queryKey: ["contas-pagar"] });
      qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
      setContaOpen(false);
      setConta(emptyConta);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const pagar = useMutation({
    mutationFn: async (c: { id: string; valor: number; descricao: string; categoria: string }) => {
      const { error } = await supabase
        .from("contas_pagar")
        .update({ status: "paga", data_pagamento: hoje() })
        .eq("id", c.id);
      if (error) throw error;
      const { error: e2 } = await supabase.from("caixa_movimentos").insert({
        tipo: "saida",
        origem: "conta_pagar",
        descricao: c.descricao,
        categoria: c.categoria,
        valor: c.valor,
        data: hoje(),
        realizado: true,
        conta_pagar_id: c.id,
      });
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Pagamento registrado");
      qc.invalidateQueries({ queryKey: ["contas-pagar"] });
      qc.invalidateQueries({ queryKey: ["caixa-movimentos"] });
      qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const salvarMov = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("caixa_movimentos").insert({
        tipo: mov.tipo,
        origem: "manual",
        descricao: mov.descricao,
        categoria: mov.categoria,
        valor: Number(mov.valor) || 0,
        data: mov.data,
        realizado: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimento lançado");
      qc.invalidateQueries({ queryKey: ["caixa-movimentos"] });
      qc.invalidateQueries({ queryKey: ["vw-fluxo-caixa"] });
      setMovOpen(false);
      setMov(emptyMov);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const kpis = useMemo(() => {
    let entradaPrev = 0,
      entradaReal = 0,
      saidaPrev = 0,
      saidaReal = 0;
    for (const f of fluxo) {
      const valor = Number(f.valor ?? 0);
      if (f.tipo === "entrada") {
        entradaPrev += valor;
        if (f.realizado) entradaReal += valor;
      } else {
        saidaPrev += valor;
        if (f.realizado) saidaReal += valor;
      }
    }
    return {
      entradaPrev,
      entradaReal,
      saidaPrev,
      saidaReal,
      saldoReal: entradaReal - saidaReal,
      saldoPrev: entradaPrev - saidaPrev,
    };
  }, [fluxo]);

  const serie = useMemo(() => {
    const mapa = new Map<string, { data: string; entradas: number; saidas: number; saldo: number }>();
    for (const f of fluxo) {
      const dia = String(f.data);
      const atual = mapa.get(dia) ?? { data: dia, entradas: 0, saidas: 0, saldo: 0 };
      const valor = Number(f.valor ?? 0);
      if (f.tipo === "entrada") atual.entradas += valor;
      else atual.saidas += valor;
      mapa.set(dia, atual);
    }
    const ordenado = [...mapa.values()].sort((a, b) => a.data.localeCompare(b.data));
    let acumulado = 0;
    return ordenado.map((d) => {
      acumulado += d.entradas - d.saidas;
      return {
        ...d,
        saldo: acumulado,
        label: new Date(`${d.data}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      };
    });
  }, [fluxo]);

  const atrasadas = contas.filter(
    (c) => c.status !== "paga" && c.status !== "cancelada" && c.vencimento < hoje(),
  );

  return (
    <div>
      <SectionHeader
        breadcrumb="Financeiro"
        title="Fluxo de caixa"
        description="Entradas dos recebimentos, saídas das contas a pagar e lançamentos manuais — previsto e realizado."
        actions={
          <>
            <Button variant="outline" onClick={() => setMovOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Movimento
            </Button>
            <NeonButton onClick={() => setContaOpen(true)}>
              <Plus className="h-4 w-4" />
              Conta a pagar
            </NeonButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <KpiCard
          label="Entradas realizadas"
          value={brl(kpis.entradaReal)}
          icon={ArrowUpCircle}
          tone="lime"
          hint={`Previsto ${brl(kpis.entradaPrev)}`}
        />
        <KpiCard
          label="Saídas realizadas"
          value={brl(kpis.saidaReal)}
          icon={ArrowDownCircle}
          tone="magenta"
          hint={`Previsto ${brl(kpis.saidaPrev)}`}
        />
        <KpiCard
          label="Saldo realizado"
          value={brl(kpis.saldoReal)}
          icon={Wallet}
          tone={kpis.saldoReal >= 0 ? "cyan" : "magenta"}
        />
        <KpiCard
          label="Saldo projetado"
          value={brl(kpis.saldoPrev)}
          icon={TrendingUp}
          tone={kpis.saldoPrev >= 0 ? "cyan" : "magenta"}
          hint={atrasadas.length > 0 ? `${atrasadas.length} conta(s) atrasada(s)` : undefined}
        />
      </div>

      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
            Projeção de saldo
          </div>
          {serie.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Sem lançamentos ainda. Cadastre contas a pagar e registre recebimentos para ver a
              curva de caixa.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serie}>
                  <defs>
                    <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--bex-cyan)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--bex-cyan)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                  <RTooltip
                    formatter={(v) => brl(Number(v))}
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="saldo"
                    stroke="var(--bex-cyan)"
                    fill="url(#gSaldo)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="pagar">
        <TabsList>
          <TabsTrigger value="pagar">Contas a pagar</TabsTrigger>
          <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
        </TabsList>

        <TabsContent value="pagar" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-muted-foreground">Carregando...</div>
              ) : contas.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nenhuma conta a pagar lançada
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {contas.map((c) => {
                    const atrasada =
                      c.status !== "paga" && c.status !== "cancelada" && c.vencimento < hoje();
                    return (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-4"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.descricao}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.fornecedor || "sem fornecedor"} · {c.categoria} · vence{" "}
                            {new Date(`${c.vencimento}T12:00:00`).toLocaleDateString("pt-BR")}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusChip
                            label={atrasada ? "Atrasada" : c.status}
                            tone={
                              c.status === "paga" ? "lime" : atrasada ? "magenta" : "amber"
                            }
                          />
                          <span className="font-bold tabular-nums">{brl(Number(c.valor))}</span>
                          {c.status !== "paga" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                pagar.mutate({
                                  id: c.id,
                                  valor: Number(c.valor),
                                  descricao: c.descricao,
                                  categoria: c.categoria,
                                })
                              }
                            >
                              Pagar
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movimentos" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {movimentos.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nenhum movimento registrado
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {movimentos.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{m.descricao}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(`${m.data}T12:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                          {m.categoria || "geral"} · {m.origem}
                        </div>
                      </div>
                      <span
                        className={
                          m.tipo === "entrada"
                            ? "font-bold tabular-nums text-[color:var(--bex-lime)]"
                            : "font-bold tabular-nums text-[color:var(--bex-magenta)]"
                        }
                      >
                        {m.tipo === "entrada" ? "+" : "−"} {brl(Number(m.valor))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={contaOpen} onOpenChange={setContaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova conta a pagar</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição *</Label>
              <Input
                value={conta.descricao}
                onChange={(e) => setConta((c) => ({ ...c, descricao: e.target.value }))}
                placeholder="Bobina de lona 440g"
              />
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Input
                value={conta.fornecedor}
                onChange={(e) => setConta((c) => ({ ...c, fornecedor: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={conta.categoria}
                onValueChange={(v) => setConta((c) => ({ ...c, categoria: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                value={conta.valor}
                onChange={(e) => setConta((c) => ({ ...c, valor: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={conta.vencimento}
                onChange={(e) => setConta((c) => ({ ...c, vencimento: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => salvarConta.mutate()}
              disabled={!conta.descricao || salvarConta.isPending}
            >
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movimento de caixa</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={mov.tipo} onValueChange={(v) => setMov((m) => ({ ...m, tipo: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data</Label>
              <Input
                type="date"
                value={mov.data}
                onChange={(e) => setMov((m) => ({ ...m, data: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Descrição *</Label>
              <Input
                value={mov.descricao}
                onChange={(e) => setMov((m) => ({ ...m, descricao: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Input
                value={mov.categoria}
                onChange={(e) => setMov((m) => ({ ...m, categoria: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                value={mov.valor}
                onChange={(e) => setMov((m) => ({ ...m, valor: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => salvarMov.mutate()}
              disabled={!mov.descricao || salvarMov.isPending}
            >
              Lançar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
