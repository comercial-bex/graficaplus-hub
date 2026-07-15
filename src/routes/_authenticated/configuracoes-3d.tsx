import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Zap, Calculator } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes-3d")({
  head: () => ({ meta: [{ title: "Configurações 3D — BEX PRINT OS" }] }),
  component: Configuracoes3D,
});

type Form = {
  tarifa_kwh_padrao: string;
  energia_distribuidora: string;
  energia_referencia: string;
  energia_consumo_kwh: string;
  energia_total_fatura: string;
  energia_tarifa_com_tributos: string;
  energia_tarifa_sem_tributos: string;
  energia_adicional_bandeira: string;
  energia_icms_pct: string;
  energia_pis_pct: string;
  energia_cofins_pct: string;
  observacao: string;
};

const s = (v: any) => (v == null ? "" : String(v));
const n = (v: string) => {
  const x = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

function Configuracoes3D() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["config-precificacao-3d-full"],
    queryFn: async () =>
      (await (supabase as any).from("config_precificacao_3d").select("*").maybeSingle()).data,
  });

  useEffect(() => {
    if (!cfg) return;
    setForm({
      tarifa_kwh_padrao: s(cfg.tarifa_kwh_padrao),
      energia_distribuidora: s(cfg.energia_distribuidora),
      energia_referencia: s(cfg.energia_referencia),
      energia_consumo_kwh: s(cfg.energia_consumo_kwh),
      energia_total_fatura: s(cfg.energia_total_fatura),
      energia_tarifa_com_tributos: s(cfg.energia_tarifa_com_tributos),
      energia_tarifa_sem_tributos: s(cfg.energia_tarifa_sem_tributos),
      energia_adicional_bandeira: s(cfg.energia_adicional_bandeira),
      energia_icms_pct: s(cfg.energia_icms_pct),
      energia_pis_pct: s(cfg.energia_pis_pct),
      energia_cofins_pct: s(cfg.energia_cofins_pct),
      observacao: s(cfg.observacao),
    });
  }, [cfg]);

  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { error } = await (supabase as any)
        .from("config_precificacao_3d")
        .update({
          tarifa_kwh_padrao: n(form.tarifa_kwh_padrao),
          energia_distribuidora: form.energia_distribuidora || null,
          energia_referencia: form.energia_referencia || null,
          energia_consumo_kwh: form.energia_consumo_kwh ? n(form.energia_consumo_kwh) : null,
          energia_total_fatura: form.energia_total_fatura ? n(form.energia_total_fatura) : null,
          energia_tarifa_com_tributos: form.energia_tarifa_com_tributos ? n(form.energia_tarifa_com_tributos) : null,
          energia_tarifa_sem_tributos: form.energia_tarifa_sem_tributos ? n(form.energia_tarifa_sem_tributos) : null,
          energia_adicional_bandeira: form.energia_adicional_bandeira ? n(form.energia_adicional_bandeira) : null,
          energia_icms_pct: form.energia_icms_pct ? n(form.energia_icms_pct) : null,
          energia_pis_pct: form.energia_pis_pct ? n(form.energia_pis_pct) : null,
          energia_cofins_pct: form.energia_cofins_pct ? n(form.energia_cofins_pct) : null,
          observacao: form.observacao || null,
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Base de energia atualizada");
      qc.invalidateQueries({ queryKey: ["config-precificacao-3d-full"] });
      qc.invalidateQueries({ queryKey: ["config-precificacao-3d"] });
      qc.invalidateQueries({ queryKey: ["tarifa-energia-base"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Recalcula a tarifa marginal a partir da fatura:
  // (energia com tributos × consumo + adicional bandeira) / consumo
  function recalcularDaFatura() {
    if (!form) return;
    const consumo = n(form.energia_consumo_kwh);
    const tarifaEnergia = n(form.energia_tarifa_com_tributos);
    const bandeira = n(form.energia_adicional_bandeira);
    if (consumo <= 0 || tarifaEnergia <= 0) {
      toast.error("Preencha consumo (kWh) e tarifa de energia com tributos.");
      return;
    }
    const marginal = tarifaEnergia + bandeira / consumo;
    set("tarifa_kwh_padrao", marginal.toFixed(4));
    toast.success(`Tarifa recalculada: R$ ${marginal.toFixed(4)}/kWh`);
  }

  const allIn = form && n(form.energia_total_fatura) > 0 && n(form.energia_consumo_kwh) > 0
    ? n(form.energia_total_fatura) / n(form.energia_consumo_kwh)
    : null;

  if (isLoading || !form) return <div className="text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/impressao-3d">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações 3D · Energia</h1>
          <p className="text-muted-foreground">
            Base herdada por novos orçamentos e pelas máquinas — sem mexer no banco.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> Tarifa de energia (base)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Tarifa padrão (R$/kWh) *</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.0001"
                value={form.tarifa_kwh_padrao}
                onChange={(e) => set("tarifa_kwh_padrao", e.target.value)}
                className="max-w-40"
              />
              <Button variant="outline" size="sm" onClick={recalcularDaFatura}>
                <Calculator className="h-3.5 w-3.5 mr-1" /> Recalcular da fatura
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              É o custo de energia por kWh usado nos orçamentos (potência × tempo × tarifa).
              {allIn != null && (
                <>
                  {" "}Referência all-in da fatura: <span className="font-mono">R$ {allIn.toFixed(4)}/kWh</span>.
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Talão de referência (opcional)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Campo label="Distribuidora" value={form.energia_distribuidora} onChange={(v) => set("energia_distribuidora", v)} />
          <Campo label="Referência (mês)" value={form.energia_referencia} onChange={(v) => set("energia_referencia", v)} />
          <Campo label="Consumo (kWh)" value={form.energia_consumo_kwh} onChange={(v) => set("energia_consumo_kwh", v)} num />
          <Campo label="Total da fatura (R$)" value={form.energia_total_fatura} onChange={(v) => set("energia_total_fatura", v)} num />
          <Campo label="Tarifa energia c/ tributos" value={form.energia_tarifa_com_tributos} onChange={(v) => set("energia_tarifa_com_tributos", v)} num step="0.000001" />
          <Campo label="Tarifa energia s/ tributos" value={form.energia_tarifa_sem_tributos} onChange={(v) => set("energia_tarifa_sem_tributos", v)} num step="0.000001" />
          <Campo label="Adicional bandeira (R$)" value={form.energia_adicional_bandeira} onChange={(v) => set("energia_adicional_bandeira", v)} num />
          <Campo label="ICMS (%)" value={form.energia_icms_pct} onChange={(v) => set("energia_icms_pct", v)} num />
          <Campo label="PIS (%)" value={form.energia_pis_pct} onChange={(v) => set("energia_pis_pct", v)} num />
          <Campo label="COFINS (%)" value={form.energia_cofins_pct} onChange={(v) => set("energia_cofins_pct", v)} num />
          <div className="col-span-2 space-y-2">
            <Label>Observação</Label>
            <Input value={form.observacao} onChange={(e) => set("observacao", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !form.tarifa_kwh_padrao}>
          {salvar.isPending ? "Salvando..." : "Salvar base"}
        </Button>
      </div>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  num,
  step = "0.01",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  num?: boolean;
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={num ? "number" : "text"}
        step={num ? step : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
