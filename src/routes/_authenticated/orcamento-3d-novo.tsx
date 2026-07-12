import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Upload, Calculator } from "lucide-react";
import { toast } from "sonner";
import {
  materialCost,
  machineCost,
  energyCost,
  laborCost,
  operationalCost,
} from "@/domain/impressao3d/cost-engine";
import { D } from "@/domain/impressao3d/decimal";

export const Route = createFileRoute("/_authenticated/orcamento-3d-novo")({
  head: () => ({ meta: [{ title: "Novo orçamento 3D — BEX PRINT OS" }] }),
  component: NovoOrcamento3D,
});

const num = (v: string, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

function NovoOrcamento3D() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [f, setF] = useState({
    cliente_id: "",
    titulo: "",
    quantidade: "1",
    maquina_id: "",
    material_id: "",
    gramas: "",
    horas: "",
    minutos: "",
    tarifa_kwh: "0.95",
    mo_custo_hora: "0",
    mo_horas: "0",
    pct_acabamento: "5",
    pct_falha: "5",
    custo_admin: "0",
    markup: "2",
  });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-sel"],
    queryFn: async () =>
      (await supabase.from("clientes").select("id, nome").order("nome")).data ?? [],
  });
  const { data: impressoras = [] } = useQuery({
    queryKey: ["impressoras-sel"],
    queryFn: async () =>
      (
        await (supabase as any)
          .from("maquinas_3d_config")
          .select("maquina_id, custo_hora_calculado, potencia_media_w, maquinas(nome)")
          .eq("ativa", true)
      ).data ?? [],
  });
  const { data: filamentos = [] } = useQuery({
    queryKey: ["filamentos-sel"],
    queryFn: async () =>
      (
        await (supabase as any)
          .from("materiais_3d_filamento")
          .select("material_id, custo_por_grama_calculado, tipo, materiais(nome)")
      ).data ?? [],
  });

  const impressora = impressoras.find((m: any) => m.maquina_id === f.maquina_id);
  const filamento = filamentos.find((m: any) => m.material_id === f.material_id);

  const calc = useMemo(() => {
    const gramas = num(f.gramas);
    const horasTotais = num(f.horas) + num(f.minutos) / 60;
    const cpg = Number(filamento?.custo_por_grama_calculado ?? 0);
    const custoHora = Number(impressora?.custo_hora_calculado ?? 0);
    const potenciaW = Number(impressora?.potencia_media_w ?? 0);
    const qtd = num(f.quantidade, 1) || 1;

    const material = materialCost(D(gramas), cpg);
    const maquina = machineCost(horasTotais * 3600, custoHora);
    const energia = energyCost({
      potenciaMediaW: potenciaW,
      horasImpressao: horasTotais,
      tarifaKwhSnapshot: num(f.tarifa_kwh),
    });
    const maoDeObra = laborCost([{ minutos: num(f.mo_horas) * 60, custoHoraSnapshot: num(f.mo_custo_hora) }]);
    const acabamento = material.mul(num(f.pct_acabamento) / 100);
    const risco = material.mul(num(f.pct_falha) / 100);
    const indireto = D(num(f.custo_admin));

    const operacional = operationalCost({
      material: material.toString(),
      maquina: maquina.toString(),
      energia: energia.toString(),
      maoDeObra: maoDeObra.toString(),
      acabamento: acabamento.toString(),
      reservaFalha: risco.toString(),
      indiretosRateados: indireto.toString(),
    });
    const markup = num(f.markup, 2) || 2;
    const preco = operacional.mul(markup);
    const lucro = preco.sub(operacional);
    const margem = preco.gt(0) ? lucro.div(preco) : D(0);
    return {
      cpg,
      custoHora,
      material,
      maquina,
      energia,
      maoDeObra,
      acabamento,
      risco,
      indireto,
      operacional,
      preco,
      lucro,
      margem,
      atacado: operacional.mul(1.5),
      qtd,
    };
  }, [f, impressora, filamento]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.titulo) throw new Error("Informe o título do orçamento");
      if (!f.maquina_id) throw new Error("Selecione a impressora");
      if (!f.material_id) throw new Error("Selecione o filamento");
      if (num(f.gramas) <= 0) throw new Error("Informe as gramas consumidas");

      // upload opcional do print do fatiador
      let screenshotPath: string | null = null;
      if (file) {
        const path = `orcamentos-3d/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from("arquivos-clientes").upload(path, file);
        if (upErr) throw upErr;
        screenshotPath = path;
      }

      const horasTotais = num(f.horas) + num(f.minutos) / 60;
      const inputs = {
        cliente_id: f.cliente_id || null,
        quantidade: calc.qtd,
        gramas: num(f.gramas),
        horas_totais: horasTotais,
        tarifa_kwh: num(f.tarifa_kwh),
        mao_obra: { custo_hora: num(f.mo_custo_hora), horas: num(f.mo_horas) },
        pct_acabamento: num(f.pct_acabamento),
        pct_falha: num(f.pct_falha),
        custo_admin: num(f.custo_admin),
        markup: num(f.markup, 2),
        slicer_screenshot: screenshotPath,
        impressora: impressora?.maquinas?.nome ?? null,
        filamento: filamento?.materiais?.nome ?? null,
      };
      const resultados = {
        material: calc.material.toNumber(),
        maquina: calc.maquina.toNumber(),
        energia: calc.energia.toNumber(),
        mao_de_obra: calc.maoDeObra.toNumber(),
        acabamento: calc.acabamento.toNumber(),
        risco: calc.risco.toNumber(),
        indireto: calc.indireto.toNumber(),
        operacional: calc.operacional.toNumber(),
        preco: calc.preco.toNumber(),
        margem: calc.margem.toNumber(),
      };

      const { data, error } = await (supabase.rpc as any)("salvar_orcamento_3d", {
        p_cliente_id: f.cliente_id || null,
        p_titulo: f.titulo,
        p_quantidade: calc.qtd,
        p_maquina_id: f.maquina_id,
        p_material_id: f.material_id,
        p_gramas: num(f.gramas),
        p_tempo_segundos: Math.round(horasTotais * 3600),
        p_arquivo_id: null,
        p_custo_por_grama: calc.cpg,
        p_inputs: inputs,
        p_resultados: resultados,
        p_custo_material: calc.material.toNumber(),
        p_custo_maquina: calc.maquina.toNumber(),
        p_custo_energia: calc.energia.toNumber(),
        p_custo_mao_obra: calc.maoDeObra.toNumber(),
        p_custo_acabamento: calc.acabamento.toNumber(),
        p_custo_risco: calc.risco.toNumber(),
        p_custo_indireto: calc.indireto.toNumber(),
        p_custo_operacional: calc.operacional.toNumber(),
        p_preco: calc.preco.toNumber(),
        p_markup: num(f.markup, 2),
        p_margem: calc.margem.toNumber(),
        p_lucro: calc.lucro.toNumber(),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Orçamento 3D salvo");
      navigate({ to: "/impressao-3d" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const money = (v: any) => `R$ ${Number(v).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/impressao-3d">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Novo orçamento 3D</h1>
          <p className="text-muted-foreground">
            Preencha os dados do print do fatiador e o motor calcula custo, preço e margem
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---- Entradas ---- */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dados do orçamento</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Título *</Label>
                <Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Porta-joias Verde Matcha" />
              </div>
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={f.cliente_id} onValueChange={(v) => set("cliente_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
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
                <Label>Quantidade</Label>
                <Input type="number" min="1" value={f.quantidade} onChange={(e) => set("quantidade", e.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" /> Dados do fatiador (print)
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Impressora *</Label>
                <Select value={f.maquina_id} onValueChange={(v) => set("maquina_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {impressoras.map((m: any) => (
                      <SelectItem key={m.maquina_id} value={m.maquina_id}>
                        {m.maquinas?.nome} · R$ {Number(m.custo_hora_calculado ?? 0).toFixed(2)}/h
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Filamento *</Label>
                <Select value={f.material_id} onValueChange={(v) => set("material_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {filamentos.map((m: any) => (
                      <SelectItem key={m.material_id} value={m.material_id}>
                        {m.materiais?.nome} · R$ {Number(m.custo_por_grama_calculado ?? 0).toFixed(3)}/g
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Peso do modelo (g) *</Label>
                <Input type="number" step="0.01" value={f.gramas} onChange={(e) => set("gramas", e.target.value)} placeholder="42.09" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Tempo (h)</Label>
                  <Input type="number" min="0" value={f.horas} onChange={(e) => set("horas", e.target.value)} placeholder="3" />
                </div>
                <div className="space-y-2">
                  <Label>Tempo (min)</Label>
                  <Input type="number" min="0" max="59" value={f.minutos} onChange={(e) => set("minutos", e.target.value)} placeholder="0" />
                </div>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Print do fatiador (imagem — opcional)</Label>
                <Input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parâmetros de custo</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Tarifa energia (R$/kWh)</Label>
                <Input type="number" step="0.01" value={f.tarifa_kwh} onChange={(e) => set("tarifa_kwh", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Mão de obra (R$/h)</Label>
                <Input type="number" step="0.01" value={f.mo_custo_hora} onChange={(e) => set("mo_custo_hora", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Mão de obra (horas)</Label>
                <Input type="number" step="0.1" value={f.mo_horas} onChange={(e) => set("mo_horas", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>% Acabamento</Label>
                <Input type="number" step="0.1" value={f.pct_acabamento} onChange={(e) => set("pct_acabamento", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>% Falha</Label>
                <Input type="number" step="0.1" value={f.pct_falha} onChange={(e) => set("pct_falha", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Custos adm./embalagem (R$)</Label>
                <Input type="number" step="0.01" value={f.custo_admin} onChange={(e) => set("custo_admin", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Markup (×)</Label>
                <Input type="number" step="0.1" value={f.markup} onChange={(e) => set("markup", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ---- Resultado ---- */}
        <div className="space-y-4">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Resultado
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Linha label="Material" value={money(calc.material)} />
              <Linha label="Máquina" value={money(calc.maquina)} />
              <Linha label="Energia" value={money(calc.energia)} />
              <Linha label="Mão de obra" value={money(calc.maoDeObra)} />
              <Linha label="Acabamento" value={money(calc.acabamento)} />
              <Linha label="Falha" value={money(calc.risco)} />
              <Linha label="Adm./embalagem" value={money(calc.indireto)} />
              <div className="border-t pt-2">
                <Linha label="Custo operacional" value={money(calc.operacional)} strong />
              </div>
              <div className="rounded-lg bg-primary/10 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Preço ({num(f.markup, 2)}×)</span>
                  <span className="font-mono text-lg font-bold">{money(calc.preco)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Margem líquida</span>
                  <span className="font-mono">{(calc.margem.toNumber() * 100).toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Lucro</span>
                  <span className="font-mono">{money(calc.lucro)}</span>
                </div>
                {calc.qtd > 1 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Unitário ({calc.qtd}×)</span>
                    <span className="font-mono">{money(calc.preco.div(calc.qtd))}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Referência atacado (1,5×)</span>
                <span className="font-mono">{money(calc.atacado)}</span>
              </div>
              <Button className="w-full" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? "Salvando..." : "Salvar orçamento"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Linha({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={`font-mono ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
