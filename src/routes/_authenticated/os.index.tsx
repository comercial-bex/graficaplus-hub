import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { DataPanel } from "@/components/bex/DataPanel";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/os/")({
  head: () => ({ meta: [{ title: "Ordens de Serviço — BEX PRINT OS" }] }),
  component: OSPage,
});

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const toneOS = (status: string): "cyan" | "magenta" | "amber" | "muted" => {
  if (["entregue", "concluida", "finalizada"].includes(status)) return "amber";
  if (["cancelada", "atrasada"].includes(status)) return "magenta";
  if (status === "rascunho" || status === "aguardando") return "muted";
  return "cyan";
};

function OSPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [buscaOS, setBuscaOS] = useState("");
  const [form, setForm] = useState({

    cliente_id: "",
    titulo: "",
    briefing: "",
    prazo_entrega: "",
    prioridade: "3",
    valor_total: "",
  });

  const { data: os = [], isLoading } = useQuery({
    queryKey: ["os-list", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("ordens_servico", canSeeFinancials)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["clientes-select"],
    queryFn: async () => {
      const { data } = await supabase.from("clientes").select("id, nome").order("nome");
      return data ?? [];
    },
  });

  async function handleCreate() {
    if (!form.cliente_id || !form.titulo) return toast.error("Cliente e título são obrigatórios");
    const { data, error } = await supabase
      .from("ordens_servico")
      .insert({
        cliente_id: form.cliente_id,
        titulo: form.titulo,
        briefing: form.briefing || null,
        prazo_entrega: form.prazo_entrega || null,
        prioridade: parseInt(form.prioridade),
        valor_total: canSeeFinancials ? parseFloat(form.valor_total || "0") : 0,
      })
      .select("id, numero")
      .single();
    if (error) return toast.error(mensagemErro(error));
    toast.success(`OS #${data.numero} criada`);
    setOpen(false);
    setForm({
      cliente_id: "",
      titulo: "",
      briefing: "",
      prazo_entrega: "",
      prioridade: "3",
      valor_total: "",
    });
    qc.invalidateQueries({ queryKey: ["os-list"] });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/os")}
        breadcrumb="Print OS · Produção"
        title="Ordens de Serviço"
        description="Acompanhe todas as OS da produção."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Nova OS
              </Button>
            </DialogTrigger>

          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nova Ordem de Serviço</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <Select
                  value={form.cliente_id}
                  onValueChange={(v) => setForm({ ...form, cliente_id: v })}
                >
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
                <Label>Título *</Label>
                <Input
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Briefing</Label>
                <Textarea
                  rows={3}
                  value={form.briefing}
                  onChange={(e) => setForm({ ...form, briefing: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Prazo entrega</Label>
                  <Input
                    type="date"
                    value={form.prazo_entrega}
                    onChange={(e) => setForm({ ...form, prazo_entrega: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Select
                    value={form.prioridade}
                    onValueChange={(v) => setForm({ ...form, prioridade: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — Urgente</SelectItem>
                      <SelectItem value="2">2 — Alta</SelectItem>
                      <SelectItem value="3">3 — Normal</SelectItem>
                      <SelectItem value="4">4 — Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {canSeeFinancials && (
                <div className="space-y-2">
                  <Label>Valor total (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.valor_total}
                    onChange={(e) => setForm({ ...form, valor_total: e.target.value })}
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate}>Criar OS</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        }
      />

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="OS em aberto" value={kpisOS.abertas} tone="cyan" />
        <KpiCard label="Em produção" value={kpisOS.producao} tone="magenta" />
        <KpiCard label="Entregues" value={kpisOS.entregues} tone="amber" />
        <KpiCard
          label={canSeeFinancials ? "Valor em produção" : "Total de OS"}
          value={canSeeFinancials ? moeda(kpisOS.valorAberto) : os.length}
          tone="cyan"
        />
      </div>

      <DataPanel
        busca={buscaOS}
        onBusca={setBuscaOS}
        placeholder="Buscar OS..."
        rodape={
          <span>
            Mostrando {osFiltradas.length} de {os.length} ordens
          </span>
        }
      >
          <Table>

            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prazo</TableHead>
                {canSeeFinancials && <TableHead>Valor</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && osFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhuma OS
                  </TableCell>
                </TableRow>
              )}
              {osFiltradas.map((o: any) => (
                <TableRow key={o.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      to="/os/$id"
                      params={{ id: o.id }}
                      className="font-mono text-xs text-[color:var(--bex-cyan)]"
                    >
                      #{o.numero}
                    </Link>
                  </TableCell>
                  <TableCell className="font-bold text-foreground">
                    <Link to="/os/$id" params={{ id: o.id }}>
                      {o.titulo}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{o.cliente_nome}</TableCell>
                  <TableCell>
                    <StatusChip label={o.status.replace(/_/g, " ")} tone={toneOS(o.status)} />
                  </TableCell>
                  <TableCell>{o.prazo_entrega ?? "—"}</TableCell>
                  {canSeeFinancials && (
                    <TableCell className="font-bold text-foreground">
                      {moeda(Number(o.valor_total))}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </DataPanel>

    </div>
  );
}
