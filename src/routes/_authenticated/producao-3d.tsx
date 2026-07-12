/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Activity, Cuboid, Clock, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/producao-3d")({
  head: () => ({ meta: [{ title: "Produção 3D — BEX PRINT OS" }] }),
  component: Producao3DPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

const STATUS_JOB = [
  "planejado",
  "aguardando_material",
  "em_impressao",
  "pausado",
  "concluido",
  "falha",
  "cancelado",
];

function statusTone(s: string): "cyan" | "magenta" | "lime" | "muted" {
  if (s === "concluido" || s === "sucesso") return "lime";
  if (s === "falha" || s === "cancelado") return "magenta";
  if (s === "planejado" || s === "pausado") return "muted";
  return "cyan";
}

function Producao3DPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [openApontamento, setOpenApontamento] = useState(false);
  const [novoResultado, setNovoResultado] = useState("sucesso");
  const [novoObs, setNovoObs] = useState("");
  const [novoTempo, setNovoTempo] = useState<string>("");
  const [novoEnergia, setNovoEnergia] = useState<string>("");

  const { data: jobs = [] } = useQuery({
    queryKey: ["producao-3d-jobs-full"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("producao_3d_jobs")
        .select(
          "*, ordens_servico(id, numero, titulo, status), maquinas(nome), producao_3d_apontamentos(count)",
        )
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: apontamentos = [] } = useQuery({
    queryKey: ["producao-3d-apontamentos", selectedJob],
    enabled: !!selectedJob,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("producao_3d_apontamentos")
        .select("*")
        .eq("job_id", selectedJob)
        .order("inicio", { ascending: false });
      return data ?? [];
    },
  });

  const job = jobs.find((j: any) => j.id === selectedJob);

  async function updateJobStatus(id: string, status: string) {
    const { error } = await (supabase as any)
      .from("producao_3d_jobs")
      .update({ status })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status do job atualizado");
    qc.invalidateQueries({ queryKey: ["producao-3d-jobs-full"] });
  }

  async function criarApontamento() {
    if (!selectedJob) return;
    const now = new Date().toISOString();
    const payload: any = {
      job_id: selectedJob,
      operador_id: user?.id,
      inicio: now,
      fim: now,
      resultado: novoResultado,
      observacao: novoObs || null,
      tempo_real_segundos: novoTempo ? Math.round(Number(novoTempo) * 60) : null,
      energia_real_kwh: novoEnergia ? Number(novoEnergia) : null,
    };
    const { error } = await (supabase as any)
      .from("producao_3d_apontamentos")
      .insert(payload);
    if (error) return toast.error(error.message);
    // Auto-avança status do job de acordo com resultado
    if (novoResultado === "sucesso" && job) {
      await updateJobStatus(selectedJob, "concluido");
    } else if (novoResultado === "falha" && job) {
      await updateJobStatus(selectedJob, "falha");
    }
    toast.success("Apontamento registrado");
    setOpenApontamento(false);
    setNovoObs("");
    setNovoTempo("");
    setNovoEnergia("");
    qc.invalidateQueries({ queryKey: ["producao-3d-apontamentos", selectedJob] });
  }

  const totais = {
    total: jobs.length,
    ativos: jobs.filter((j: any) => ["em_impressao", "planejado"].includes(j.status)).length,
    concluidos: jobs.filter((j: any) => j.status === "concluido").length,
    falhas: jobs.filter((j: any) => j.status === "falha").length,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Produção · Impressão 3D"
        title="Produção 3D — Jobs & Apontamentos"
        description="Gerencie jobs de impressão, registre apontamentos e sincronize status da OS"
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Jobs totais" value={totais.total} icon={Cuboid} tone="cyan" />
        <KpiCard label="Ativos" value={totais.ativos} icon={Activity} tone="cyan" />
        <KpiCard label="Concluídos" value={totais.concluidos} icon={Clock} tone="lime" />
        <KpiCard
          label="Falhas"
          value={totais.falhas}
          icon={AlertTriangle}
          tone={totais.falhas > 0 ? "magenta" : "muted"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jobs de produção</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum job de impressão 3D. Crie um orçamento 3D e converta em OS.
              </p>
            ) : (
              jobs.map((j: any) => (
                <div
                  key={j.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedJob(j.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedJob(j.id)}
                  className={`rounded border p-3 cursor-pointer transition-colors ${
                    selectedJob === j.id ? "border-primary bg-muted/50" : "hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        OS #{j.ordens_servico?.numero ?? "—"} · {j.ordens_servico?.titulo}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {j.maquinas?.nome ?? "sem máquina"} · repetição {j.repeticao}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusChip label={j.status} tone={statusTone(j.status)} />
                      <Select
                        value={j.status}
                        onValueChange={(v) => updateJobStatus(j.id, v)}
                      >
                        <SelectTrigger
                          className="h-7 w-[140px] text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_JOB.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {selectedJob ? "Apontamentos do job" : "Selecione um job"}
            </CardTitle>
            {selectedJob && (
              <Dialog open={openApontamento} onOpenChange={setOpenApontamento}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-3 w-3 mr-1" /> Novo apontamento
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Registrar apontamento 3D</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Resultado</Label>
                      <Select value={novoResultado} onValueChange={setNovoResultado}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="em_andamento">em andamento</SelectItem>
                          <SelectItem value="sucesso">sucesso</SelectItem>
                          <SelectItem value="falha">falha</SelectItem>
                          <SelectItem value="cancelado">cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Tempo (minutos)</Label>
                        <Input
                          type="number"
                          value={novoTempo}
                          onChange={(e) => setNovoTempo(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label>Energia (kWh)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={novoEnergia}
                          onChange={(e) => setNovoEnergia(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Observações</Label>
                      <Textarea
                        value={novoObs}
                        onChange={(e) => setNovoObs(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpenApontamento(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={criarApontamento}>Registrar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {!selectedJob ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Clique em um job à esquerda para ver seus apontamentos.
              </p>
            ) : apontamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Sem apontamentos ainda.
              </p>
            ) : (
              <div className="space-y-2">
                {apontamentos.map((a: any) => (
                  <div key={a.id} className="rounded border p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <StatusChip label={a.resultado} tone={statusTone(a.resultado)} />
                      <span className="text-xs text-muted-foreground font-mono">
                        {new Date(a.inicio).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {a.tempo_real_segundos
                        ? `${(a.tempo_real_segundos / 60).toFixed(1)} min`
                        : "—"}
                      {a.energia_real_kwh
                        ? ` · ${Number(a.energia_real_kwh).toFixed(2)} kWh`
                        : ""}
                    </div>
                    {a.observacao && (
                      <div className="text-xs text-foreground">{a.observacao}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
