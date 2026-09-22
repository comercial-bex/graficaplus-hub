import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { rotuloDe } from "@/domain/os/etapas";
import { formatarData } from "@/domain/os/prazo";

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
  const navigate = useNavigate();
  const abrirOS = (id: string) => navigate({ to: "/os/$id", params: { id } });
  // Tudo que esta tela mostra de dinheiro é preço de venda (valor_total):
  // gate por canSeePrices e leitura pela view do nível. Custo/margem não
  // aparecem aqui, então canSeeFinancials não é usado.
  const { canSeePrices, nivelDeVisao } = useAuth();
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
    queryKey: ["os-list", nivelDeVisao],
    queryFn: async () => {
      // `*` devolve só o que a view do nível tem; nunca nomear coluna aqui
      // (uma coluna que a view não tem derruba a consulta inteira em silêncio).
      const { data, error } = await fromFinancialView("ordens_servico", nivelDeVisao)
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

  const osFiltradas = useMemo(() => {
    const termo = buscaOS.trim().toLowerCase();
    if (!termo) return os as any[];
    return (os as any[]).filter((o) =>
      [o.numero, o.titulo, o.cliente_nome]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(termo)),
    );
  }, [os, buscaOS]);

  const kpisOS = useMemo(() => {
    const lista = os as any[];
    const finalizadas = ["entregue", "concluida", "finalizada", "cancelada"];
    const abertas = lista.filter((o) => !finalizadas.includes(o.status));
    return {
      abertas: abertas.length,
      producao: lista.filter((o) => String(o.status).includes("producao")).length,
      entregues: lista.filter((o) => ["entregue", "concluida", "finalizada"].includes(o.status))
        .length,
      valorAberto: abertas.reduce((a, o) => a + Number(o.valor_total ?? 0), 0),
    };
  }, [os]);

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
        valor_total: canSeePrices ? parseFloat(form.valor_total || "0") : 0,
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
              {/* Alvo de 44px no celular (equivale ao size="lg"); no desktop fica o padrão. */}
              <Button className="h-11 px-6 md:h-9 md:px-4">
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
                {canSeePrices && (
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

      {/* 2 colunas já no celular: 4 cartões empilhados empurravam a lista para ~500px abaixo. */}
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <KpiCard label="OS em aberto" value={kpisOS.abertas} tone="cyan" />
        <KpiCard label="Em produção" value={kpisOS.producao} tone="magenta" />
        <KpiCard label="Entregues" value={kpisOS.entregues} tone="amber" />
        {/* O valor em R$ (text-3xl) não cabe em meia coluna de 375px e o KpiCard
            corta com overflow-hidden: este cartão ocupa a linha inteira no celular. */}
        <KpiCard
          label={canSeePrices ? "Valor em produção" : "Total de OS"}
          value={canSeePrices ? moeda(kpisOS.valorAberto) : os.length}
          tone="cyan"
          className={canSeePrices ? "col-span-2 md:col-span-1" : undefined}
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
        {/* Celular: cartões com o cartão inteiro clicável (alvo ≥ 56px). */}
        <ul className="divide-y divide-border md:hidden">
          {isLoading && (
            <li className="p-4 text-center text-xs text-muted-foreground">Carregando...</li>
          )}
          {!isLoading && osFiltradas.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">Nenhuma OS</li>
          )}
          {osFiltradas.map((o: any) => (
            <li key={o.id}>
              <Link
                to="/os/$id"
                params={{ id: o.id }}
                className="flex min-h-14 items-center gap-3 px-3 py-3 active:bg-foreground/5"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-bold text-foreground">
                    <span className="mr-2 font-mono text-xs font-normal text-[color:var(--bex-cyan)]">
                      #{o.numero}
                    </span>
                    {o.titulo}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{o.cliente_nome}</p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusChip label={rotuloDe(o.status)} tone={toneOS(o.status)} />
                    <span>Prazo {formatarData(o.prazo_entrega)}</span>
                  </div>
                </div>
                {canSeePrices && (
                  <span className="shrink-0 text-sm font-bold text-foreground">
                    {moeda(Number(o.valor_total))}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        <Table className="hidden md:table">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prazo</TableHead>
              {canSeePrices && <TableHead>Valor</TableHead>}
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
              // A linha inteira abre a OS (a dica da tela promete isso); os Links
              // ficam para teclado/leitor de tela e param a propagação para não
              // navegar duas vezes.
              <TableRow key={o.id} className="cursor-pointer" onClick={() => abrirOS(o.id)}>
                <TableCell>
                  <Link
                    to="/os/$id"
                    params={{ id: o.id }}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-xs text-[color:var(--bex-cyan)]"
                  >
                    #{o.numero}
                  </Link>
                </TableCell>
                <TableCell className="font-bold text-foreground">
                  <Link to="/os/$id" params={{ id: o.id }} onClick={(e) => e.stopPropagation()}>
                    {o.titulo}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{o.cliente_nome}</TableCell>
                <TableCell>
                  {/* Trocar "_" por espaço mostrava "aguardando aprovacao
                      arte" — o valor do enum com um retoque, não o nome que a
                      equipe usa. O rótulo vem da mesma fonte do quadro. */}
                  <StatusChip label={rotuloDe(o.status)} tone={toneOS(o.status)} />
                </TableCell>
                <TableCell>{formatarData(o.prazo_entrega)}</TableCell>
                {canSeePrices && (
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
