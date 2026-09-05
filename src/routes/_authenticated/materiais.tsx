import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  Coins,
  Plus,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { DataPanel } from "@/components/bex/DataPanel";
import { NeonButton } from "@/components/bex/NeonButton";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo, dicaTela } from "@/lib/dicas";

export const Route = createFileRoute("/_authenticated/materiais")({
  head: () => ({
    meta: [
      { title: "Materiais e peças — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Estoque de materiais e peças com custo unitário, entradas, saídas, consumo por OS e desperdício valorizado.",
      },
      { property: "og:title", content: "Materiais e peças — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Quanto tem, quanto custa, quanto saiu para produção e quanto virou perda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MateriaisPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

type Material = {
  id: string;
  nome: string;
  unidade: string;
  estoque: number;
  custo_unitario: number | null;
  custo_medio: number | null;
  estoque_minimo: number | null;
  fornecedor: string | null;
  localizacao: string | null;
};

type MovForm = {
  material_id: string;
  tipo: "entrada" | "saida";
  quantidade: string;
  custo_unitario: string;
  motivo: string;
  observacao: string;
};

const movVazio: MovForm = {
  material_id: "",
  tipo: "entrada",
  quantidade: "0",
  custo_unitario: "",
  motivo: "compra",
  observacao: "",
};

function MateriaisPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState({
    nome: "",
    unidade: "un",
    estoque: "0",
    custo_unitario: "",
    estoque_minimo: "0",
    fornecedor: "",
  });
  const [movOpen, setMovOpen] = useState(false);
  const [mov, setMov] = useState<MovForm>(movVazio);

  const { data: materiais = [], isLoading } = useQuery({
    queryKey: ["materiais", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("materiais", canSeeFinancials)
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Material[];
    },
  });

  const { data: movimentos = [] } = useQuery({
    queryKey: ["movimentos-materiais"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimentacoes_estoque")
        .select("id, material_id, tipo, quantidade, custo_unitario_snapshot, origem, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: perdas = [] } = useQuery({
    queryKey: ["perdas-por-material"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("os_perdas")
        .select("material_id, quantidade_perdida, custo_unitario, custo_total")
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const resumoPorMaterial = useMemo(() => {
    const mapa = new Map<string, { saidas: number; consumoOS: number; perdaQtd: number; perdaCusto: number }>();
    const pega = (id: string) =>
      mapa.get(id) ?? { saidas: 0, consumoOS: 0, perdaQtd: 0, perdaCusto: 0 };
    for (const m of movimentos as any[]) {
      if (!m.material_id || m.tipo !== "saida") continue;
      const r = pega(m.material_id);
      r.saidas += Number(m.quantidade ?? 0);
      if (m.origem === "baixa_os") r.consumoOS += Number(m.quantidade ?? 0);
      mapa.set(m.material_id, r);
    }
    for (const p of perdas as any[]) {
      if (!p.material_id) continue;
      const r = pega(p.material_id);
      r.perdaQtd += Number(p.quantidade_perdida ?? 0);
      r.perdaCusto += Number(
        p.custo_total ?? Number(p.custo_unitario ?? 0) * Number(p.quantidade_perdida ?? 0),
      );
      mapa.set(p.material_id, r);
    }
    return mapa;
  }, [movimentos, perdas]);

  const criar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("materiais").insert({
        nome: form.nome,
        unidade: form.unidade || "un",
        estoque: Number(form.estoque) || 0,
        estoque_minimo: Number(form.estoque_minimo) || 0,
        fornecedor: form.fornecedor || null,
        custo_unitario: canSeeFinancials && form.custo_unitario ? Number(form.custo_unitario) : null,
        custo_medio: canSeeFinancials && form.custo_unitario ? Number(form.custo_unitario) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Material cadastrado");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      setOpen(false);
      setForm({ nome: "", unidade: "un", estoque: "0", custo_unitario: "", estoque_minimo: "0", fornecedor: "" });
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const lancarMov = useMutation({
    mutationFn: async () => {
      const material = materiais.find((m) => m.id === mov.material_id);
      if (!material) throw new Error("Escolha o material.");
      const qtd = Number(mov.quantidade) || 0;
      if (qtd <= 0) throw new Error("Informe uma quantidade maior que zero.");

      const estoqueAtual = Number(material.estoque ?? 0);
      if (mov.tipo === "saida" && qtd > estoqueAtual)
        throw new Error(
          `Estoque insuficiente: há ${num(estoqueAtual)} ${material.unidade} de ${material.nome}.`,
        );

      const custoInformado = mov.custo_unitario ? Number(mov.custo_unitario) : null;
      const custoAtual = Number(material.custo_medio ?? material.custo_unitario ?? 0);
      const custoUsado = custoInformado ?? custoAtual;

      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("movimentacoes_estoque").insert({
        material_id: material.id,
        tipo: mov.tipo,
        quantidade: qtd,
        unidade: material.unidade,
        custo_unitario_snapshot: custoUsado,
        origem: mov.tipo === "entrada" ? "compra" : "manual",
        motivo: mov.motivo || null,
        observacao: mov.observacao || null,
        usuario_id: auth.user?.id ?? null,
      });
      if (error) throw error;

      // custo médio ponderado nas entradas
      let novoCustoMedio = custoAtual;
      if (mov.tipo === "entrada" && custoInformado != null) {
        const total = estoqueAtual + qtd;
        novoCustoMedio = total > 0 ? (estoqueAtual * custoAtual + qtd * custoInformado) / total : custoInformado;
      }

      const patch: {
        estoque: number;
        updated_at: string;
        custo_medio?: number;
        custo_unitario?: number;
      } = {
        estoque: mov.tipo === "entrada" ? estoqueAtual + qtd : estoqueAtual - qtd,
        updated_at: new Date().toISOString(),
      };
      if (canSeeFinancials && mov.tipo === "entrada" && custoInformado != null) {
        patch.custo_medio = Math.round(novoCustoMedio * 10000) / 10000;
        patch.custo_unitario = custoInformado;
      }
      const { error: e2 } = await supabase.from("materiais").update(patch).eq("id", material.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Movimentação registrada");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      qc.invalidateQueries({ queryKey: ["movimentos-materiais"] });
      setMovOpen(false);
      setMov(movVazio);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return materiais;
    return materiais.filter(
      (m) => m.nome.toLowerCase().includes(q) || (m.fornecedor ?? "").toLowerCase().includes(q),
    );
  }, [materiais, busca]);

  const kpis = useMemo(() => {
    const valor = materiais.reduce(
      (a, m) => a + Number(m.estoque ?? 0) * Number(m.custo_medio ?? m.custo_unitario ?? 0),
      0,
    );
    const baixo = materiais.filter(
      (m) => Number(m.estoque ?? 0) <= Number(m.estoque_minimo ?? 0),
    ).length;
    let perdaCusto = 0;
    resumoPorMaterial.forEach((r) => (perdaCusto += r.perdaCusto));
    return { valor, baixo, perdaCusto, itens: materiais.length };
  }, [materiais, resumoPorMaterial]);

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/materiais")}
        breadcrumb="Catálogo & Estoque"
        title="Materiais e peças"
        description="Cada entrada atualiza o custo médio; cada saída sai do estoque. O que é consumido em OS entra no custo da ordem e o que vira perda aparece aqui valorizado."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setMov({ ...movVazio, material_id: filtrados[0]?.id ?? "" });
                setMovOpen(true);
              }}
              disabled={materiais.length === 0}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Entrada / saída
            </Button>
            <NeonButton onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Novo material
            </NeonButton>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Itens cadastrados" value={kpis.itens} icon={Boxes} tone="cyan" />
        <KpiCard
          label="Abaixo do mínimo"
          value={kpis.baixo}
          icon={AlertTriangle}
          tone={kpis.baixo > 0 ? "magenta" : "muted"}
          hint="Repor para não parar a produção"
        />
        {canSeeFinancials && (
          <KpiCard label="Valor em estoque" value={brl(kpis.valor)} icon={Coins} tone="lime" />
        )}
        {canSeeFinancials && (
          <KpiCard
            label="Desperdício acumulado"
            value={brl(kpis.perdaCusto)}
            icon={TrendingDown}
            tone={kpis.perdaCusto > 0 ? "magenta" : "muted"}
            hint="Já lançado no custo das OS"
          />
        )}
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar material ou fornecedor..."
        rodape={<span>{filtrados.length} material(is) listado(s)</span>}
      >
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nenhum material cadastrado
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                {canSeeFinancials && <TableHead className="text-right">Custo unit.</TableHead>}
                {canSeeFinancials && <TableHead className="text-right">Valor parado</TableHead>}
                <TableHead className="text-right">Consumo em OS</TableHead>
                <TableHead className="text-right">Desperdício</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((m) => {
                const r = resumoPorMaterial.get(m.id);
                const estoque = Number(m.estoque ?? 0);
                const minimo = Number(m.estoque_minimo ?? 0);
                const custo = Number(m.custo_medio ?? m.custo_unitario ?? 0);
                const baixo = estoque <= minimo;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="font-medium">{m.nome}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {m.unidade}
                        {m.fornecedor ? ` · ${m.fornecedor}` : ""}
                        {m.localizacao ? ` · ${m.localizacao}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{num(estoque)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {num(minimo)}
                    </TableCell>
                    {canSeeFinancials && (
                      <TableCell className="text-right font-mono">{custo ? brl(custo) : "—"}</TableCell>
                    )}
                    {canSeeFinancials && (
                      <TableCell className="text-right font-mono">{brl(estoque * custo)}</TableCell>
                    )}
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {num(r?.consumoOS ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r?.perdaQtd ? (
                        <span className="text-[color:var(--bex-magenta)]">
                          {num(r.perdaQtd)}
                          {canSeeFinancials && r.perdaCusto > 0 ? ` · ${brl(r.perdaCusto)}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip label={baixo ? "Repor" : "OK"} tone={baixo ? "magenta" : "lime"} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataPanel>

      {/* Novo material */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cadastrar material</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="flex items-center gap-1.5">
                Nome *
                <DicaIcone texto={dicaCampo("/materiais", "Nome *")} rotulo="Nome *" />
              </Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Lona 440g"
              />
            </div>
            <div className="space-y-2">
              <Label>Unidade</Label>
              <Input
                value={form.unidade}
                onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                placeholder="m², un, kg"
              />
            </div>
            <div className="space-y-2">
              <Label>Estoque inicial</Label>
              <Input
                type="number"
                step="0.01"
                value={form.estoque}
                onChange={(e) => setForm({ ...form, estoque: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Estoque mínimo
                <DicaIcone texto="Abaixo desse número o material aparece como 'Repor'." rotulo="Estoque mínimo" />
              </Label>
              <Input
                type="number"
                step="0.01"
                value={form.estoque_minimo}
                onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Input
                value={form.fornecedor}
                onChange={(e) => setForm({ ...form, fornecedor: e.target.value })}
              />
            </div>
            {canSeeFinancials && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="flex items-center gap-1.5">
                  Custo unitário (R$)
                  <DicaIcone
                    texto="Custo de compra por unidade. É esse valor que entra no custo da OS e na conta do desperdício."
                    rotulo="Custo unitário"
                  />
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.custo_unitario}
                  onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => criar.mutate()} disabled={!form.nome || criar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entrada / saída */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entrada ou saída de material</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Material *</Label>
              <Select
                value={mov.material_id}
                onValueChange={(v) => setMov({ ...mov, material_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o material" />
                </SelectTrigger>
                <SelectContent>
                  {materiais.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · {num(Number(m.estoque ?? 0))} {m.unidade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={mov.tipo}
                onValueChange={(v) => setMov({ ...mov, tipo: v as MovForm["tipo"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada (compra / devolução)</SelectItem>
                  <SelectItem value="saida">Saída (uso / descarte)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantidade *</Label>
              <Input
                type="number"
                step="0.01"
                value={mov.quantidade}
                onChange={(e) => setMov({ ...mov, quantidade: e.target.value })}
              />
            </div>
            {canSeeFinancials && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  Custo unitário (R$)
                  <DicaIcone
                    texto="Na entrada, esse valor recalcula o custo médio do material."
                    rotulo="Custo unitário"
                  />
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={mov.custo_unitario}
                  onChange={(e) => setMov({ ...mov, custo_unitario: e.target.value })}
                  placeholder="deixe vazio para manter o custo atual"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input
                value={mov.motivo}
                onChange={(e) => setMov({ ...mov, motivo: e.target.value })}
                placeholder="compra, ajuste, devolução..."
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observação</Label>
              <Textarea
                rows={2}
                value={mov.observacao}
                onChange={(e) => setMov({ ...mov, observacao: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => lancarMov.mutate()}
              disabled={!mov.material_id || lancarMov.isPending}
            >
              {mov.tipo === "entrada" ? (
                <ArrowUpCircle className="mr-2 h-4 w-4" />
              ) : (
                <ArrowDownCircle className="mr-2 h-4 w-4" />
              )}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
