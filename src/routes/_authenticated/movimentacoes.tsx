import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, ClipboardCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";

export const Route = createFileRoute("/_authenticated/movimentacoes")({
  head: () => ({ meta: [{ title: "Movimentações de estoque — BEX PRINT OS" }] }),
  component: MovimentacoesPage,
});

type Movimentacao = {
  id: string;
  created_at: string;
  tipo: string;
  quantidade: number;
  unidade: string | null;
  origem: string | null;
  motivo: string | null;
  material_nome: string;
  lote_codigo: string | null;
  os_numero: number | null;
  usuario_nome: string | null;
};

type MaterialResumo = { id: string; nome: string; unidade: string; estoque: number };

// Entrada soma, saída subtrai — o sinal é o que o operador lê primeiro.
const ENTRADAS = new Set(["entrada", "devolucao", "ajuste_positivo"]);

const rotuloOrigem: Record<string, string> = {
  entrada_manual: "Entrada",
  inventario: "Inventário",
  baixa_os: "Baixa de OS",
  estorno: "Estorno",
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function MovimentacoesPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeDarEntrada = hasPermission("estoque.entry");
  const podeInventariar = hasPermission("estoque.inventory");

  const [busca, setBusca] = useState("");
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [inventarioAberto, setInventarioAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [entrada, setEntrada] = useState({
    material_id: "",
    quantidade: "",
    custo_unitario: "",
    fornecedor: "",
    nota: "",
    validade: "",
    localizacao: "",
  });
  const [inventario, setInventario] = useState({
    material_id: "",
    quantidade_contada: "",
    motivo: "",
  });

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ["movimentacoes-estoque"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vw_movimentacoes_estoque")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Movimentacao[];
    },
  });

  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais-para-movimentacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materiais")
        .select("id, nome, unidade, estoque")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaterialResumo[];
    },
  });

  const materialSelecionado = materiais.find((m) => m.id === inventario.material_id);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return movimentacoes;
    return movimentacoes.filter(
      (m) =>
        m.material_nome.toLowerCase().includes(q) ||
        (m.motivo ?? "").toLowerCase().includes(q) ||
        (m.usuario_nome ?? "").toLowerCase().includes(q) ||
        String(m.os_numero ?? "").includes(q),
    );
  }, [movimentacoes, busca]);

  async function salvarEntrada() {
    if (!entrada.material_id) return toast.error("Escolha o material");
    const qtd = Number(entrada.quantidade.replace(",", "."));
    const custo = Number(entrada.custo_unitario.replace(",", "."));
    if (!(qtd > 0)) return toast.error("Informe uma quantidade maior que zero");
    if (!(custo >= 0)) return toast.error("Informe o custo unitário");

    setSalvando(true);
    try {
      const { error } = await (supabase.rpc as any)("registrar_entrada_material", {
        p_material_id: entrada.material_id,
        p_quantidade: qtd,
        p_custo_unitario: custo,
        p_fornecedor: entrada.fornecedor.trim() || null,
        p_nota: entrada.nota.trim() || null,
        p_validade: entrada.validade || null,
        p_localizacao: entrada.localizacao.trim() || null,
      });
      if (error) throw error;
      toast.success("Entrada registrada");
      setEntradaAberta(false);
      setEntrada({
        material_id: "",
        quantidade: "",
        custo_unitario: "",
        fornecedor: "",
        nota: "",
        validade: "",
        localizacao: "",
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["movimentacoes-estoque"] }),
        qc.invalidateQueries({ queryKey: ["materiais-para-movimentacao"] }),
      ]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar a entrada");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarInventario() {
    if (!inventario.material_id) return toast.error("Escolha o material");
    const contada = Number(inventario.quantidade_contada.replace(",", "."));
    if (!(contada >= 0)) return toast.error("Informe a quantidade contada");
    if (!inventario.motivo.trim()) return toast.error("Descreva o motivo do ajuste");

    setSalvando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("ajustar_estoque_material", {
        p_material_id: inventario.material_id,
        p_quantidade_contada: contada,
        p_motivo: inventario.motivo.trim(),
      });
      if (error) throw error;
      const dif = Number((data as { diferenca?: number })?.diferenca ?? 0);
      toast.success(
        dif === 0
          ? "Contagem confere com o sistema"
          : `Ajuste de ${dif > 0 ? "+" : ""}${dif} registrado`,
      );
      setInventarioAberto(false);
      setInventario({ material_id: "", quantidade_contada: "", motivo: "" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["movimentacoes-estoque"] }),
        qc.invalidateQueries({ queryKey: ["materiais-para-movimentacao"] }),
      ]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao registrar o ajuste");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/movimentacoes")}
        breadcrumb="Print OS · Estoque"
        title="Movimentações de estoque"
        description="Toda entrada, baixa e ajuste de material, com origem e responsável"
        actions={
          <div className="flex items-center gap-2">
            {podeInventariar && (
              <Button variant="outline" onClick={() => setInventarioAberto(true)}>
                <ClipboardCheck className="h-4 w-4 mr-1" /> Inventário
              </Button>
            )}
            {podeDarEntrada && (
              <Button onClick={() => setEntradaAberta(true)}>
                <Plus className="h-4 w-4 mr-1" /> Entrada de material
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar material, OS, motivo ou responsável…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {movimentacoes.length === 0
                      ? "Nenhuma movimentação ainda. Comece dando entrada no material que já está na prateleira."
                      : "Nada encontrado para esta busca."}
                  </TableCell>
                </TableRow>
              )}
              {filtradas.map((m) => {
                const soma = ENTRADAS.has(m.tipo);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {dataHora(m.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {m.material_nome}
                      {m.lote_codigo && (
                        <span className="block text-xs text-muted-foreground">
                          lote {m.lote_codigo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={soma ? "default" : "secondary"}>
                        {rotuloOrigem[m.origem ?? ""] ?? m.tipo}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        soma ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {soma ? "+" : "−"}
                      {Number(m.quantidade).toLocaleString("pt-BR")} {m.unidade ?? ""}
                    </TableCell>
                    <TableCell>
                      {m.os_numero ? `#${m.os_numero}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {m.usuario_nome ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.motivo ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Entrada */}
      <Dialog open={entradaAberta} onOpenChange={setEntradaAberta}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Entrada de material</DialogTitle>
            <DialogDescription>
              Cria um lote e atualiza o custo médio. É o custo médio que vira custo real
              na OS — então vale conferir a nota antes de gravar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entrada-material">Material *</Label>
              <Select
                value={entrada.material_id}
                onValueChange={(v) => setEntrada({ ...entrada, material_id: v })}
              >
                <SelectTrigger id="entrada-material">
                  <SelectValue placeholder="Escolha o material" />
                </SelectTrigger>
                <SelectContent>
                  {materiais.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · saldo {Number(m.estoque).toLocaleString("pt-BR")} {m.unidade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="entrada-qtd">Quantidade *</Label>
                <Input
                  id="entrada-qtd"
                  type="number"
                  min="0"
                  step="0.001"
                  value={entrada.quantidade}
                  onChange={(e) => setEntrada({ ...entrada, quantidade: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entrada-custo">Custo unitário (R$) *</Label>
                <Input
                  id="entrada-custo"
                  type="number"
                  min="0"
                  step="0.01"
                  value={entrada.custo_unitario}
                  onChange={(e) => setEntrada({ ...entrada, custo_unitario: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="entrada-fornecedor">Fornecedor</Label>
                <Input
                  id="entrada-fornecedor"
                  value={entrada.fornecedor}
                  onChange={(e) => setEntrada({ ...entrada, fornecedor: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entrada-nota">Nota fiscal</Label>
                <Input
                  id="entrada-nota"
                  placeholder="NF 1234"
                  value={entrada.nota}
                  onChange={(e) => setEntrada({ ...entrada, nota: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="entrada-validade">Validade</Label>
                <Input
                  id="entrada-validade"
                  type="date"
                  value={entrada.validade}
                  onChange={(e) => setEntrada({ ...entrada, validade: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entrada-local">Localização</Label>
                <Input
                  id="entrada-local"
                  placeholder="Prateleira A3"
                  value={entrada.localizacao}
                  onChange={(e) => setEntrada({ ...entrada, localizacao: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEntradaAberta(false)}>
              Cancelar
            </Button>
            <Button onClick={salvarEntrada} disabled={salvando}>
              {salvando ? "Registrando…" : "Registrar entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inventário */}
      <Dialog open={inventarioAberto} onOpenChange={setInventarioAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Inventário</DialogTitle>
            <DialogDescription>
              Informe o que foi contado na prateleira. A diferença fica registrada como
              movimentação, com motivo — sobra e falta viram histórico em vez de um número
              corrigido no escuro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inv-material">Material *</Label>
              <Select
                value={inventario.material_id}
                onValueChange={(v) => setInventario({ ...inventario, material_id: v })}
              >
                <SelectTrigger id="inv-material">
                  <SelectValue placeholder="Escolha o material" />
                </SelectTrigger>
                <SelectContent>
                  {materiais.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome} · sistema {Number(m.estoque).toLocaleString("pt-BR")} {m.unidade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inv-contada">Quantidade contada *</Label>
              <Input
                id="inv-contada"
                type="number"
                min="0"
                step="0.001"
                value={inventario.quantidade_contada}
                onChange={(e) =>
                  setInventario({ ...inventario, quantidade_contada: e.target.value })
                }
              />
              {materialSelecionado && inventario.quantidade_contada !== "" && (
                <p className="text-xs text-muted-foreground">
                  Sistema tem {Number(materialSelecionado.estoque).toLocaleString("pt-BR")}{" "}
                  {materialSelecionado.unidade} — diferença de{" "}
                  <strong>
                    {(
                      Number(inventario.quantidade_contada.replace(",", ".")) -
                      Number(materialSelecionado.estoque)
                    ).toLocaleString("pt-BR")}
                  </strong>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="inv-motivo">Motivo *</Label>
              <Input
                id="inv-motivo"
                placeholder="Contagem mensal, material danificado, sobra de bobina…"
                value={inventario.motivo}
                onChange={(e) => setInventario({ ...inventario, motivo: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInventarioAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={salvarInventario} disabled={salvando}>
              {salvando ? "Registrando…" : "Registrar ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
