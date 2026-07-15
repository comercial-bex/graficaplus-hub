import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Calculator, Cpu, Package, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  materialCost,
  machineCost,
  energyCost,
  laborCost,
  operationalCost,
} from "@/domain/impressao3d/cost-engine";
import { D } from "@/domain/impressao3d/decimal";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { NeonButton } from "@/components/bex/NeonButton";
import { FieldTooltip } from "@/components/bex/FieldTooltip";
import { Dropzone, type DropzoneStatus } from "@/components/bex/Dropzone";
import { runSlicerOcr, parseTempoLivre, formatMinutos } from "@/domain/impressao3d/ocr";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orcamento-3d-novo")({
  head: () => ({ meta: [{ title: "Novo orçamento 3D — BEX PRINT OS" }] }),
  component: NovoOrcamento3D,
});

const num = (v: string, fallback = 0) => {
  // tolera vírgula decimal (pt-BR): "6,52" -> 6.52, sem quebrar "1.375".
  let s = String(v ?? "").trim();
  if (s.includes(",")) {
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
};

const money = (v: any) =>
  `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type FormState = {
  cliente_id: string;
  titulo: string;
  quantidade: string;
  maquina_id: string;
  material_id: string;
  gramas: string;
  tempo: string; // livre: "2h 15m", "2:15", "135"
  custo_hora: string;
  potencia_w: string;
  peso_suporte: string;
  peso_purga: string;
  pecas_placa: string;
  filamento_tipo_detectado: string;
  altura_camada: string;
  infill_pct: string;
  tarifa_kwh: string;
  mo_custo_hora: string;
  mo_horas: string;
  pct_acabamento: string;
  pct_falha: string;
  custo_admin: string;
  markup: string;
};

const PRESETS: {
  id: string;
  label: string;
  tone: "cyan" | "magenta" | "lime" | "amber";
  patch: Partial<FormState>;
}[] = [
  {
    id: "varejo",
    label: "Varejo padrão",
    tone: "cyan",
    patch: { markup: "2", pct_falha: "5", pct_acabamento: "5", mo_custo_hora: "40" },
  },
  {
    id: "atacado",
    label: "Atacado",
    tone: "lime",
    patch: { markup: "1.4", pct_falha: "3", pct_acabamento: "2", mo_custo_hora: "30" },
  },
  {
    id: "pintada",
    label: "Peça pintada",
    tone: "magenta",
    patch: { markup: "2.3", pct_acabamento: "12", mo_custo_hora: "50", pct_falha: "5" },
  },
  {
    id: "prototipo",
    label: "Protótipo rápido",
    tone: "amber",
    patch: { markup: "1.8", pct_falha: "10", pct_acabamento: "0", mo_custo_hora: "35" },
  },
];

function NovoOrcamento3D() {
  const navigate = useNavigate();

  const [f, setF] = useState<FormState>({
    cliente_id: "",
    titulo: "",
    quantidade: "1",
    maquina_id: "",
    material_id: "",
    gramas: "",
    tempo: "",
    custo_hora: "",
    potencia_w: "",
    peso_suporte: "",
    peso_purga: "",
    pecas_placa: "",
    filamento_tipo_detectado: "",
    altura_camada: "",
    infill_pct: "",
    tarifa_kwh: "0.95",
    mo_custo_hora: "40",
    mo_horas: "0",
    pct_acabamento: "5",
    pct_falha: "5",
    custo_admin: "0",
    markup: "2",
  });
  const set = (k: keyof FormState, v: string) => setF((s) => ({ ...s, [k]: v }));
  const patch = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));

  // aplica último preset salvo
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = localStorage.getItem("bex.orc3d.preset");
    if (!id) return;
    const p = PRESETS.find((x) => x.id === id);
    if (p) patch(p.patch);
  }, []);

  const [fotoModelo, setFotoModelo] = useState<File | null>(null);
  const [slicerFile, setSlicerFile] = useState<File | null>(null);
  const [ocr, setOcr] = useState<DropzoneStatus>({ kind: "idle" });

  async function processSlicer(file: File | null) {
    setSlicerFile(file);
    setOcr({ kind: "idle" });
    if (!file) return;
    setOcr({ kind: "loading", label: "Lendo…" });
    try {
      const r = await runSlicerOcr(file);
      const achou: string[] = [];
      if (r.gramas) {
        set("gramas", String(r.gramas));
        achou.push(`${r.gramas} g`);
      }
      if (r.minutos !== undefined) {
        set("tempo", formatMinutos(r.minutos));
        achou.push(formatMinutos(r.minutos));
      }
      if (r.pesoSuporteG !== undefined) set("peso_suporte", String(r.pesoSuporteG));
      if (r.pesoPurgaG !== undefined) set("peso_purga", String(r.pesoPurgaG));
      if (r.pecasPorPlaca !== undefined) set("pecas_placa", String(r.pecasPorPlaca));
      if (r.filamentoTipo) set("filamento_tipo_detectado", r.filamentoTipo);
      if (r.alturaCamadaMm !== undefined) set("altura_camada", String(r.alturaCamadaMm));
      if (r.infillPct !== undefined) set("infill_pct", String(r.infillPct));
      if (achou.length) {
        setOcr({ kind: "ok", label: achou.join(" · ") });
      } else {
        setOcr({ kind: "error", label: "Preencha manualmente" });
      }
    } catch {
      setOcr({ kind: "error", label: "OCR falhou — preencha manualmente" });
    }
  }

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
          .select("material_id, custo_por_grama_calculado, tipo, cor, materiais(nome)")
      ).data ?? [],
  });

  // Base de precificação 3D: vira o default dos campos enquanto o usuário não os
  // alterou (compara com o valor hardcoded inicial de cada campo).
  const { data: configPrec } = useQuery({
    queryKey: ["config-precificacao-3d"],
    queryFn: async () =>
      (
        await (supabase as any)
          .from("config_precificacao_3d")
          .select(
            "tarifa_kwh_padrao, mo_custo_hora_padrao, markup_padrao, pct_acabamento_padrao, pct_falha_padrao, custo_admin_padrao",
          )
          .maybeSingle()
      ).data,
  });
  useEffect(() => {
    const c = configPrec;
    if (!c) return;
    setF((s) => {
      const n2 = { ...s };
      if (c.tarifa_kwh_padrao != null && s.tarifa_kwh === "0.95") n2.tarifa_kwh = String(c.tarifa_kwh_padrao);
      if (c.mo_custo_hora_padrao != null && s.mo_custo_hora === "40") n2.mo_custo_hora = String(c.mo_custo_hora_padrao);
      if (c.markup_padrao != null && s.markup === "2") n2.markup = String(c.markup_padrao);
      if (c.pct_acabamento_padrao != null && s.pct_acabamento === "5") n2.pct_acabamento = String(c.pct_acabamento_padrao);
      if (c.pct_falha_padrao != null && s.pct_falha === "5") n2.pct_falha = String(c.pct_falha_padrao);
      if (c.custo_admin_padrao != null && s.custo_admin === "0") n2.custo_admin = String(c.custo_admin_padrao);
      return n2;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configPrec]);

  const impressora = impressoras.find((m: any) => m.maquina_id === f.maquina_id);
  const filamento = filamentos.find((m: any) => m.material_id === f.material_id);

  // Ao trocar de impressora, puxa custo-hora e potência para campos editáveis.
  // Evita sub-precificar em silêncio quando a impressora não tem custo-hora.
  useEffect(() => {
    if (!impressora) return;
    setF((s) => ({
      ...s,
      custo_hora: String(Number(impressora.custo_hora_calculado ?? 0)),
      potencia_w: String(Number(impressora.potencia_media_w ?? 0)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.maquina_id]);

  const tempoMinutos = parseTempoLivre(f.tempo) ?? 0;
  const tempoHoras = tempoMinutos / 60;

  const calc = useMemo(() => {
    const gramasModelo = num(f.gramas);
    const gramasSuporte = num(f.peso_suporte);
    const gramasPurga = num(f.peso_purga);
    const gramas = gramasModelo + gramasSuporte + gramasPurga;
    const horasTotais = tempoHoras;
    const cpg = Number(filamento?.custo_por_grama_calculado ?? 0);
    const custoHora = num(f.custo_hora);
    const potenciaW = num(f.potencia_w);
    const qtd = num(f.quantidade, 1) || 1;

    const material = materialCost(D(gramas), cpg);
    const maquina = machineCost(horasTotais * 3600, custoHora);
    const energia = energyCost({
      potenciaMediaW: potenciaW,
      horasImpressao: horasTotais,
      tarifaKwhSnapshot: num(f.tarifa_kwh),
    });
    const maoDeObra = laborCost([
      { minutos: num(f.mo_horas) * 60, custoHoraSnapshot: num(f.mo_custo_hora) },
    ]);
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
    const equilibrio = operacional.mul(1 / 0.9); // margem 10%
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
      equilibrio,
      qtd,
      markup,
    };
  }, [f, impressora, filamento]);

  const faltando: string[] = [];
  if (!f.titulo) faltando.push("título");
  if (!f.maquina_id) faltando.push("impressora");
  if (!f.material_id) faltando.push("filamento");
  if (num(f.gramas) <= 0) faltando.push("peso");

  const salvar = useMutation({
    mutationFn: async () => {
      if (faltando.length) throw new Error(`Faltando: ${faltando.join(", ")}`);

      // uploads opcionais
      let slicerPath: string | null = null;
      let fotoPath: string | null = null;
      const ts = Date.now();
      if (slicerFile) {
        const path = `orcamentos-3d/${ts}_slicer_${slicerFile.name}`;
        const { error } = await supabase.storage.from("arquivos-clientes").upload(path, slicerFile);
        if (error) throw error;
        slicerPath = path;
      }
      if (fotoModelo) {
        const path = `orcamentos-3d/${ts}_modelo_${fotoModelo.name}`;
        const { error } = await supabase.storage
          .from("arquivos-clientes")
          .upload(path, fotoModelo);
        if (error) throw error;
        fotoPath = path;
      }

      const horasTotais = tempoHoras;
      const inputs = {
        cliente_id: f.cliente_id || null,
        quantidade: calc.qtd,
        gramas: num(f.gramas),
        peso_suporte_g: num(f.peso_suporte),
        peso_purga_g: num(f.peso_purga),
        pecas_por_placa: num(f.pecas_placa, 1) || 1,
        filamento_tipo_detectado: f.filamento_tipo_detectado || null,
        altura_camada_mm: num(f.altura_camada),
        infill_pct: num(f.infill_pct),
        horas_totais: horasTotais,
        custo_hora_maquina: num(f.custo_hora),
        potencia_w: num(f.potencia_w),
        tarifa_kwh: num(f.tarifa_kwh),
        mao_obra: { custo_hora: num(f.mo_custo_hora), horas: num(f.mo_horas) },
        pct_acabamento: num(f.pct_acabamento),
        pct_falha: num(f.pct_falha),
        custo_admin: num(f.custo_admin),
        markup: num(f.markup, 2),
        slicer_screenshot: slicerPath,
        foto_modelo: fotoPath,
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
      const id = data as string;

      // grava a foto do modelo em orcamentos_3d.foto_modelo_path
      if (fotoPath && id) {
        await (supabase as any)
          .from("orcamentos_3d")
          .update({ foto_modelo_path: fotoPath })
          .eq("id", id);
      }
      return id;
    },
    onSuccess: () => {
      toast.success("Orçamento 3D salvo");
      navigate({ to: "/impressao-3d" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const margemPct = calc.margem.toNumber() * 100;
  const margemTone: "lime" | "amber" | "magenta" =
    margemPct >= 40 ? "lime" : margemPct >= 15 ? "amber" : "magenta";

  const total = calc.operacional.toNumber() || 1;
  const breakdown = [
    { label: "Material", value: calc.material.toNumber(), tone: "cyan" as const },
    { label: "Máquina", value: calc.maquina.toNumber(), tone: "magenta" as const },
    { label: "Energia", value: calc.energia.toNumber(), tone: "amber" as const },
    { label: "Mão de obra", value: calc.maoDeObra.toNumber(), tone: "lime" as const },
    { label: "Acabamento", value: calc.acabamento.toNumber(), tone: "cyan" as const },
    { label: "Falha", value: calc.risco.toNumber(), tone: "magenta" as const },
    { label: "Adm./embal.", value: calc.indireto.toNumber(), tone: "muted" as const },
  ];

  return (
    <div className="space-y-6 pb-24">
      <SectionHeader
        breadcrumb="Impressão 3D · Novo orçamento"
        title="Novo orçamento 3D"
        description="Preencha o print do fatiador e o motor calcula custo, preço e margem em tempo real."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to="/impressao-3d">
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* ---- Formulário ---- */}
        <div className="space-y-6">
          {/* 1. Identificação */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo n="1" icone={<Package className="h-4 w-4" />} titulo="Identificação" sub="Quem, o quê, quantos" />
              <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Título"
                    required
                    hint="Nome curto que aparece no PDF e na listagem. Ex.: 'Porta-joias verde matcha'."
                  />
                  <Input
                    value={f.titulo}
                    onChange={(e) => set("titulo", e.target.value)}
                    placeholder="Porta-joias Verde Matcha"
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Cliente"
                    hint="Opcional. Vincula o orçamento ao 360º do cliente e habilita a conversão em OS."
                  />
                  <Select value={f.cliente_id} onValueChange={(v) => set("cliente_id", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhum cliente cadastrado
                        </div>
                      )}
                      {clientes.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Quantidade"
                    hint="Número de peças idênticas. O motor NÃO multiplica automaticamente — informe o total do print."
                  />
                  <Input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={f.quantidade}
                    onChange={(e) => set("quantidade", e.target.value)}
                  />
                </div>
              </div>

              <Dropzone
                label="Foto do modelo (opcional)"
                hint="Imagem final da peça — vira capa do orçamento, PDF e listagem"
                file={fotoModelo}
                onFile={setFotoModelo}
                accent="magenta"
                captureFromClipboard={false}
              />
            </CardContent>
          </Card>

          {/* 2. Fatiador */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo n="2" icone={<Cpu className="h-4 w-4" />} titulo="Dados do fatiador" sub="O herói — o motor lê tudo daqui" />

              <Dropzone
                label="Print do fatiador"
                hint="Bambu Studio, Orca, Cura ou PrusaSlicer — lemos peso e tempo automaticamente"
                file={slicerFile}
                onFile={processSlicer}
                status={ocr}
                accent="cyan"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Impressora"
                    required
                    hint="Custo/hora vem de maquinas_3d_config (depreciação + manutenção + rateio de estrutura)."
                  />
                  <Select value={f.maquina_id} onValueChange={(v) => set("maquina_id", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a impressora" />
                    </SelectTrigger>
                    <SelectContent>
                      {impressoras.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhuma impressora ativa — cadastre em /impressoras-3d
                        </div>
                      )}
                      {impressoras.map((m: any) => (
                        <SelectItem key={m.maquina_id} value={m.maquina_id}>
                          {m.maquinas?.nome} · R$ {Number(m.custo_hora_calculado ?? 0).toFixed(2)}/h · {Number(m.potencia_media_w ?? 0).toFixed(0)} W
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Filamento"
                    required
                    hint="Preço vem de materiais_3d_filamento. Mostramos o valor do quilo — a fórmula converte pra grama internamente."
                  />
                  <Select value={f.material_id} onValueChange={(v) => set("material_id", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o filamento" />
                    </SelectTrigger>
                    <SelectContent>
                      {filamentos.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhum filamento — cadastre em /filamentos-3d
                        </div>
                      )}
                      {filamentos.map((m: any) => {
                        const kg = Number(m.custo_por_grama_calculado ?? 0) * 1000;
                        return (
                          <SelectItem key={m.material_id} value={m.material_id}>
                            {m.materiais?.nome}
                            {m.tipo ? ` · ${m.tipo}` : ""}
                            {m.cor ? ` · ${m.cor}` : ""} · R$ {kg.toFixed(2)}/kg
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Peso do modelo (g)"
                    required
                    hint="Só o peso do modelo. Suporte e purga ficam nos campos 'Detectado no print' abaixo. Aceita decimais (ex.: 6,52)."
                  />
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={f.gramas}
                    onChange={(e) => set("gramas", e.target.value.replace(",", "."))}
                    placeholder="6.52"
                  />
                </div>
                <div className="space-y-1.5">
                  <FieldTooltip
                    label="Tempo total"
                    hint="Aceita: 2h 15m · 2:15 · 135min · 1,5h · 90m. Cada hora custa a linha 'Máquina' + 'Energia'."
                  />
                  <Input
                    type="text"
                    inputMode="text"
                    value={f.tempo}
                    onChange={(e) => set("tempo", e.target.value)}
                    placeholder="ex.: 2h 15m ou 2:15"
                  />
                  {tempoMinutos > 0 && (
                    <div className="text-[11px] text-muted-foreground font-mono">
                      ≈ {formatMinutos(tempoMinutos)} · {tempoMinutos} min
                    </div>
                  )}
                </div>
              </div>

              {/* Detectado no print — bloco enxuto com campos extras */}
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Detectado no print
                  </div>
                  <span className="text-[10px] text-muted-foreground">Preenchido pelo OCR; ajuste se preciso</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peso suporte (g)"
                      hint="Filamento gasto em estruturas de suporte. Soma no total de material antes do custo."
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={f.peso_suporte}
                      onChange={(e) => set("peso_suporte", e.target.value.replace(",", "."))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peso purga/torre (g)"
                      hint="Purga e torre de troca (prime tower). Em multicolor passa fácil de 20% do total."
                    />
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={f.peso_purga}
                      onChange={(e) => set("peso_purga", e.target.value.replace(",", "."))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip
                      label="Peças na placa"
                      hint="Quantas peças o print inclui. Confira contra 'Quantidade' para evitar subestimar 5×."
                    />
                    <Input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={f.pecas_placa}
                      onChange={(e) => set("pecas_placa", e.target.value)}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Tipo detectado" hint="Se diferente do filamento selecionado, revise — pode mudar R$/kg." />
                    <Input
                      value={f.filamento_tipo_detectado}
                      onChange={(e) => set("filamento_tipo_detectado", e.target.value.toUpperCase())}
                      placeholder="PLA / PETG / ABS…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Altura camada (mm)" hint="Só metadado de reprodutibilidade. Não afeta o custo." />
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={f.altura_camada}
                      onChange={(e) => set("altura_camada", e.target.value.replace(",", "."))}
                      placeholder="0.2"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldTooltip label="Infill (%)" hint="Só metadado. Peça re-cotada com infill maior vai gastar mais material." />
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={f.infill_pct}
                      onChange={(e) => set("infill_pct", e.target.value.replace(",", "."))}
                      placeholder="15"
                    />
                  </div>
                </div>
                {f.filamento_tipo_detectado && filamento?.tipo &&
                  f.filamento_tipo_detectado.toUpperCase() !== String(filamento.tipo).toUpperCase() && (
                    <div className="text-xs rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-amber-300">
                      Atenção: fatiador diz <b>{f.filamento_tipo_detectado}</b>, você selecionou <b>{filamento.tipo}</b>.
                    </div>
                  )}
                {num(f.pecas_placa) > 1 && num(f.quantidade) !== num(f.pecas_placa) && (
                  <div className="text-xs rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-amber-300">
                    O print é de <b>{num(f.pecas_placa)}</b> peças e a quantidade cotada é <b>{num(f.quantidade)}</b>. Confira se o peso e o tempo cobrem o total.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>



          {/* 3. Parâmetros de custo */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <BlocoTitulo
                n="3"
                icone={<Wand2 className="h-4 w-4" />}
                titulo="Parâmetros de custo"
                sub="Presets aceleram — os tooltips têm médias de mercado"
              />

              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      patch(p.patch);
                      if (typeof window !== "undefined") localStorage.setItem("bex.orc3d.preset", p.id);
                    }}
                    className="group"
                  >
                    <StatusChip label={p.label} tone={p.tone} />
                  </button>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Campo
                  label="Custo-hora máquina (R$/h)"
                  hint="Puxado da impressora ao selecioná-la; edite se o cadastro estiver incompleto."
                  value={f.custo_hora}
                  onChange={(v) => set("custo_hora", v)}
                  step="0.01"
                />
                <Campo
                  label="Potência (W)"
                  hint="Potência média da impressora, puxada do cadastro. Base do custo de energia."
                  value={f.potencia_w}
                  onChange={(v) => set("potencia_w", v)}
                  step="1"
                />
                <Campo
                  label="Tarifa energia (R$/kWh)"
                  hint="R$/kWh da conta de luz. Média BR residencial 0,85–1,10; comercial 0,60–0,90."
                  value={f.tarifa_kwh}
                  onChange={(v) => set("tarifa_kwh", v)}
                  step="0.01"
                />
                <Campo
                  label="Mão de obra (R$/h)"
                  hint="Custo do operador incluindo encargos. Sugerido 25–60 R$/h para operação 3D."
                  value={f.mo_custo_hora}
                  onChange={(v) => set("mo_custo_hora", v)}
                  step="0.01"
                />
                <Campo
                  label="Mão de obra (horas)"
                  hint="Só o pós-processamento manual (remoção de suporte, lixa, montagem)."
                  value={f.mo_horas}
                  onChange={(v) => set("mo_horas", v)}
                  step="0.1"
                />
                <Campo
                  label="% Acabamento"
                  hint="Reserva para tinta, cola, verniz. Peça crua 0–3%; pintada 8–15%."
                  value={f.pct_acabamento}
                  onChange={(v) => set("pct_acabamento", v)}
                  step="0.1"
                />
                <Campo
                  label="% Falha"
                  hint="Provisão de reimpressão. FDM confiável 3–7%; resina/peça complexa 10–15%."
                  value={f.pct_falha}
                  onChange={(v) => set("pct_falha", v)}
                  step="0.1"
                />
                <Campo
                  label="Adm./embalagem (R$)"
                  hint="Rateio fixo por peça: caixa, plástico, etiqueta. Média 1,50–5,00."
                  value={f.custo_admin}
                  onChange={(v) => set("custo_admin", v)}
                  step="0.01"
                />
                <Campo
                  label="Markup (×)"
                  hint="Multiplica o custo operacional. Varejo 2,0–2,5×; atacado 1,3–1,5×; peça premium 2,5–3,5×."
                  value={f.markup}
                  onChange={(v) => set("markup", v)}
                  step="0.1"
                />
              </div>
              {f.maquina_id && num(f.custo_hora) <= 0 && (
                <p className="mt-2 text-xs text-destructive">
                  A impressora selecionada está sem custo-hora — informe manualmente acima ou
                  corrija o cadastro, senão o orçamento sub-precifica.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---- Resumo herói (sticky) ---- */}
        <div className="space-y-4">
          <div className="lg:sticky lg:top-4 space-y-4">
            <Card className="overflow-hidden border-[color:var(--bex-cyan)]/30">
              <div
                className="px-5 py-4 border-b border-border"
                style={{ background: "var(--gradient-cmyk)" }}
              >
                <div className="flex items-center justify-between text-background/90">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest font-bold">
                    <Calculator className="h-3.5 w-3.5" /> Resultado
                  </div>
                  <StatusChip
                    label={`${margemPct.toFixed(1)}% margem`}
                    tone={margemTone}
                  />
                </div>
              </div>
              <CardContent className="pt-5 space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
                    Preço ({calc.markup}×)
                  </div>
                  <div className="font-mono text-4xl font-black tracking-tight">
                    {money(calc.preco)}
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <span>Custo {money(calc.operacional)}</span>
                    <span>·</span>
                    <span>Lucro {money(calc.lucro)}</span>
                  </div>
                </div>

                {calc.qtd > 1 && (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Unitário ({calc.qtd}×)</span>
                    <span className="font-mono font-semibold">{money(calc.preco.div(calc.qtd))}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
                    Breakdown do custo
                  </div>
                  {breakdown.map((b) => {
                    const pct = total > 0 ? (b.value / total) * 100 : 0;
                    return (
                      <div key={b.label} className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{b.label}</span>
                          <span className="font-mono">{money(b.value)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              b.tone === "cyan" && "bg-[color:var(--bex-cyan)]",
                              b.tone === "magenta" && "bg-[color:var(--bex-magenta)]",
                              b.tone === "amber" && "bg-amber-400",
                              b.tone === "lime" && "bg-[color:var(--bex-lime)]",
                              b.tone === "muted" && "bg-muted-foreground",
                            )}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-border px-2 py-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground font-mono">Atacado 1,5×</div>
                    <div className="font-mono font-semibold">{money(calc.atacado)}</div>
                  </div>
                  <div className="rounded-lg border border-border px-2 py-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground font-mono">Equilíbrio 10%</div>
                    <div className="font-mono font-semibold">{money(calc.equilibrio)}</div>
                  </div>
                </div>

                {faltando.length > 0 && (
                  <div className="text-xs rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-300 flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Faltando: {faltando.join(", ")}</span>
                  </div>
                )}

                <NeonButton
                  className="w-full"
                  onClick={() => salvar.mutate()}
                  disabled={salvar.isPending || faltando.length > 0}
                >
                  {salvar.isPending ? "Salvando..." : "Salvar orçamento"}
                </NeonButton>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlocoTitulo({
  n,
  icone,
  titulo,
  sub,
}: {
  n: string;
  icone: React.ReactNode;
  titulo: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3 pb-2 border-b border-border">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm font-black text-background"
        style={{ background: "var(--gradient-cmyk)" }}
      >
        {n}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          {icone}
          {titulo}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function Campo({
  label,
  hint,
  value,
  onChange,
  step,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <FieldTooltip label={label} hint={hint} />
      <Input
        type="number"
        step={step}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
