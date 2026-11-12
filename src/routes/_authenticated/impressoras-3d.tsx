import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
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
import { Printer, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
import { Carregando } from "@/components/bex/Carregando";
import { useAuth } from "@/lib/auth-context";
import { lerImpressoras3d } from "@/lib/supabase-financial-views";
export const Route = createFileRoute("/_authenticated/impressoras-3d")({
  head: () => ({ meta: [{ title: "Impressoras 3D — BEX PRINT OS" }] }),
  component: ImpressorasPage,
});

const TECNOLOGIAS = ["FDM", "SLA", "SLS", "DLP", "MSLA"];

type FormState = {
  maquina_id: string | null;
  nome: string;
  fabricante: string;
  modelo: string;
  tecnologia: string;
  custo_aquisicao: string;
  valor_residual: string;
  vida_util_horas: string;
  manutencao_por_hora: string;
  potencia_media_w: string;
  potencia_aquecimento_w: string;
  potencia_standby_w: string;
};

const EMPTY: FormState = {
  maquina_id: null,
  nome: "",
  fabricante: "",
  modelo: "",
  tecnologia: "FDM",
  custo_aquisicao: "",
  valor_residual: "0",
  vida_util_horas: "5000",
  manutencao_por_hora: "0",
  potencia_media_w: "500",
  potencia_aquecimento_w: "",
  potencia_standby_w: "",
};

function ImpressorasPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  // Onda C (11/11/2026): o custo da impressora sai pela visão maquinas_3d_config_financeiro, só para quem vê custo
  // de máquina. Quem cadastra impressora hoje (admin, gestor) vê. Se um dia alguém cadastrar sem ver custo, lê só as
  // colunas abertas da tabela e não edita (o formulário gravaria custo zero por cima do de verdade).
  const { hasPermission } = useAuth();
  const veCusto = hasPermission("impressao3d.cost.read") || hasPermission("financeiro.read");

  const {
    data: impressoras = [],
    isPending,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["impressoras-3d", veCusto],
    queryFn: async () => {
      const { data, error } = await lerImpressoras3d(veCusto).order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Tarifa de energia base (config_precificacao_3d) para mostrar o custo de energia/hora de cada máquina. Falha ou
  // linha que não chega vira "sem tarifa", nunca R$ 0 por hora.
  const tarifa = useQuery({
    queryKey: ["tarifa-energia-base"],
    enabled: veCusto,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("config_precificacao_3d")
        .select("tarifa_kwh_padrao")
        .maybeSingle();
      if (error) throw error;
      const n = Number(data?.tarifa_kwh_padrao);
      return data && Number.isFinite(n) && n > 0 ? n : null;
    },
  });
  const tarifaBase: number | null = tarifa.data ?? null;
  const brl = (v: unknown, casas: number) =>
    `R$ ${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
  const energiaPorHora = (w: unknown) =>
    tarifaBase == null
      ? tarifa.isError
        ? "tarifa não carregou"
        : "sem tarifa"
      : `R$ ${((Number(w ?? 0) / 1000) * tarifaBase).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.rpc as any)("upsert_impressora_3d", {
        p_maquina_id: form.maquina_id,
        p_nome: form.nome,
        p_fabricante: form.fabricante || null,
        p_modelo: form.modelo || null,
        p_tecnologia: form.tecnologia || "FDM",
        p_custo_aquisicao: Number(form.custo_aquisicao) || 0,
        p_valor_residual: Number(form.valor_residual) || 0,
        p_vida_util_horas: Number(form.vida_util_horas) || 5000,
        p_manutencao_por_hora: Number(form.manutencao_por_hora) || 0,
        p_potencia_media_w: Number(form.potencia_media_w) || 0,
        p_potencia_aquecimento_w: Number(form.potencia_aquecimento_w) || 0,
        p_potencia_standby_w: Number(form.potencia_standby_w) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.maquina_id ? "Impressora atualizada" : "Impressora cadastrada");
      qc.invalidateQueries({ queryKey: ["impressoras-3d"] });
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const remove = useMutation({
    mutationFn: async (maquina_id: string) => {
      const { error } = await (supabase.rpc as any)("delete_impressora_3d", { p_maquina_id: maquina_id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Impressora removida");
      qc.invalidateQueries({ queryKey: ["impressoras-3d"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  function openNew() {
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(m: any) {
    setForm({
      maquina_id: m.maquina_id,
      nome: m.nome ?? m.maquinas?.nome ?? "",
      fabricante: m.fabricante ?? "",
      modelo: m.modelo ?? "",
      tecnologia: m.tecnologia ?? "FDM",
      custo_aquisicao: String(m.custo_aquisicao ?? 0),
      valor_residual: String(m.valor_residual ?? 0),
      vida_util_horas: String(m.vida_util_horas ?? 5000),
      manutencao_por_hora: String(m.manutencao_por_hora ?? 0),
      potencia_media_w: String(m.potencia_media_w ?? 0),
      potencia_aquecimento_w: m.potencia_aquecimento_w ? String(m.potencia_aquecimento_w) : "",
      potencia_standby_w: m.potencia_standby_w ? String(m.potencia_standby_w) : "",
    });
    setOpen(true);
  }

  const custoHoraPreview = (() => {
    const vida = Number(form.vida_util_horas) || 5000;
    return (
      (Number(form.custo_aquisicao) - Number(form.valor_residual)) / (vida > 0 ? vida : 5000) +
      (Number(form.manutencao_por_hora) || 0)
    );
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Impressoras 3D</h1>
            <DicaIcone texto={dicaTela("/impressoras-3d")} rotulo="Impressoras 3D" lado="bottom" className="h-5 w-5" />
          </div>
          <p className="text-muted-foreground">
            Parque de impressoras (Bambu Lab, Creality e outras) — base do custo-hora dos orçamentos 3D
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              Nova impressora
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.maquina_id ? "Editar impressora" : "Cadastrar impressora"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="impressora3d-11-nome">Nome *</Label>
                <Input id="impressora3d-11-nome"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Bambu Lab A1 — Bancada 1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-10-fabricante">Fabricante</Label>
                <Input id="impressora3d-10-fabricante"
                  value={form.fabricante}
                  onChange={(e) => setForm({ ...form, fabricante: e.target.value })}
                  placeholder="BambuLab"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-9-modelo">Modelo</Label>
                <Input id="impressora3d-9-modelo"
                  value={form.modelo}
                  onChange={(e) => setForm({ ...form, modelo: e.target.value })}
                  placeholder="A1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-8-tecnologia">Tecnologia</Label>
                <Select value={form.tecnologia} onValueChange={(v) => setForm({ ...form, tecnologia: v })}>
                  <SelectTrigger id="impressora3d-8-tecnologia">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TECNOLOGIAS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-7-potencia-media-w">Potência média (W)</Label>
                <Input id="impressora3d-7-potencia-media-w"
                  type="number"
                  step="1"
                  value={form.potencia_media_w}
                  onChange={(e) => setForm({ ...form, potencia_media_w: e.target.value })}
                />
                {tarifaBase != null && Number(form.potencia_media_w) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {energiaPorHora(form.potencia_media_w)}/h de energia (tarifa base R${" "}
                    {tarifaBase.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}/kWh)
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-6-potencia-aquecimento-w">Potência aquecimento (W)</Label>
                <Input id="impressora3d-6-potencia-aquecimento-w"
                  type="number"
                  step="1"
                  value={form.potencia_aquecimento_w}
                  onChange={(e) => setForm({ ...form, potencia_aquecimento_w: e.target.value })}
                  placeholder="opcional (mesa/hotend)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-5-potencia-standby-w">Potência standby (W)</Label>
                <Input id="impressora3d-5-potencia-standby-w"
                  type="number"
                  step="1"
                  value={form.potencia_standby_w}
                  onChange={(e) => setForm({ ...form, potencia_standby_w: e.target.value })}
                  placeholder="opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-4-valor-da-maquina-r">Valor da máquina (R$)</Label>
                <Input id="impressora3d-4-valor-da-maquina-r"
                  type="number"
                  step="0.01"
                  value={form.custo_aquisicao}
                  onChange={(e) => setForm({ ...form, custo_aquisicao: e.target.value })}
                  placeholder="5500.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-3-valor-residual-r">Valor residual (R$)</Label>
                <Input id="impressora3d-3-valor-residual-r"
                  type="number"
                  step="0.01"
                  value={form.valor_residual}
                  onChange={(e) => setForm({ ...form, valor_residual: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-2-vida-util-horas">Vida útil (horas)</Label>
                <Input id="impressora3d-2-vida-util-horas"
                  type="number"
                  step="1"
                  value={form.vida_util_horas}
                  onChange={(e) => setForm({ ...form, vida_util_horas: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="impressora3d-1-manutencao-por-hora-r">Manutenção por hora (R$)</Label>
                <Input id="impressora3d-1-manutencao-por-hora-r"
                  type="number"
                  step="0.01"
                  value={form.manutencao_por_hora}
                  onChange={(e) => setForm({ ...form, manutencao_por_hora: e.target.value })}
                />
              </div>
              <div className="col-span-2 text-xs text-muted-foreground">
                Custo-hora ={" "}
                <span className="font-mono">(valor − residual) ÷ vida útil + manutenção/h</span>{" "}
                {Number(form.custo_aquisicao) > 0 && (
                  <span className="font-mono font-semibold">≈ R$ {custoHoraPreview.toFixed(2)}/h</span>
                )}
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

      {isPending ? (
        <Carregando />
      ) : isError ? (
        <Card role="alert" className="border-destructive">
          <CardContent className="space-y-3 py-6">
            <p className="text-base font-medium">Não consegui carregar as impressoras.</p>
            <p className="text-sm text-muted-foreground">
              É uma falha de leitura, não uma lista vazia. Se continuar, avise a gerência.
            </p>
            <Button variant="outline" className="min-h-11" disabled={isFetching} onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : impressoras.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma impressora cadastrada
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {impressoras.map((m: any) => (
            <Card key={m.maquina_id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Printer className="h-5 w-5 text-link" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{m.nome ?? m.maquinas?.nome ?? "Sem nome"}</CardTitle>
                      <div className="text-xs text-muted-foreground">
                        {[m.fabricante, m.modelo].filter(Boolean).join(" ") || "—"}
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary">{m.tecnologia ?? "FDM"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {veCusto && (
                    <>
                      <div>
                        <div className="text-muted-foreground text-xs">Máquina</div>
                        <div className="font-mono font-semibold">{brl(m.custo_aquisicao, 0)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Custo/hora</div>
                        <div className="font-mono font-semibold">{brl(m.custo_hora_calculado, 2)}</div>
                      </div>
                    </>
                  )}
                  <div>
                    <div className="text-muted-foreground text-xs">Potência</div>
                    <div className="font-mono font-semibold">{Number(m.potencia_media_w ?? 0).toFixed(0)} W</div>
                  </div>
                  {veCusto && (
                    <div>
                      <div className="text-muted-foreground text-xs">Energia/hora</div>
                      <div className="font-mono font-semibold">{energiaPorHora(m.potencia_media_w)}</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  {veCusto ? (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(m)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                    </Button>
                  ) : (
                    <p className="flex-1 text-sm text-muted-foreground">Editar pede a permissão de ver custo.</p>
                  )}
                  <ConfirmarAcao
                    titulo="Remover esta impressora?"
                    rotuloConfirmar="Remover"
                    destrutivo
                    aoConfirmar={() => remove.mutate(m.maquina_id)}
                  >
                    <Button variant="outline" size="sm" aria-label="Remover impressora">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </ConfirmarAcao>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
