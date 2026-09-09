import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { PackagePlus, ShoppingCart, Truck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Compras — BEX PRINT OS" }] }),
  component: ComprasPage,
});

type ItemPedido = {
  id: string;
  material_id: string;
  quantidade: number;
  quantidade_recebida: number;
  custo_unitario: number;
  materiais_operacional?: { nome: string; unidade: string | null } | null;
};

type Pedido = {
  id: string;
  numero: number;
  fornecedor: string;
  status: string;
  previsao_entrega: string | null;
  observacoes: string | null;
  created_at: string;
  pedido_compra_itens: ItemPedido[];
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n2 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const tomDoStatus: Record<string, "secondary" | "outline" | "destructive"> = {
  rascunho: "outline",
  enviado: "destructive",
  recebido_parcial: "destructive",
  recebido: "secondary",
  cancelado: "outline",
};

const rotuloStatus: Record<string, string> = {
  rascunho: "rascunho",
  enviado: "aguardando entrega",
  recebido_parcial: "recebido em parte",
  recebido: "recebido",
  cancelado: "cancelado",
};

/**
 * Compras: o material que falta vira pedido, e o pedido recebido vira estoque.
 *
 * O recebimento passa por `receber_item_compra`, que chama a entrada de material
 * já existente — é ela que cria o lote e recalcula o custo médio. Dar entrada por
 * fora daqui produziria dois custos médios diferentes para o mesmo material.
 */
function ComprasPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeCriar = hasPermission("compras.create");
  const podeReceber = hasPermission("compras.receive");

  const [novoAberto, setNovoAberto] = useState(false);
  const [recebendo, setRecebendo] = useState<ItemPedido | null>(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ["pedidos-compra"],
    queryFn: async (): Promise<Pedido[]> => {
      const { data, error } = await (supabase as any)
        .from("pedidos_compra")
        .select(
          "id, numero, fornecedor, status, previsao_entrega, observacoes, created_at, pedido_compra_itens(id, material_id, quantidade, quantidade_recebida, custo_unitario, materiais_operacional:material_id(nome, unidade))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pedido[];
    },
  });

  const abertos = pedidos.filter((p) => p.status === "enviado" || p.status === "recebido_parcial");

  return (
    <div>
      <SectionHeader
        breadcrumb="Suprimentos"
        title="Compras"
        description="O material que falta vira pedido; o pedido recebido entra no estoque com lote e custo."
        actions={
          podeCriar ? (
            <Button onClick={() => setNovoAberto(true)}>
              <PackagePlus className="h-4 w-4 mr-1" /> Novo pedido
            </Button>
          ) : undefined
        }
      />

      {abertos.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <Truck className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            {abertos.length === 1 ? "Um pedido aguarda" : `${abertos.length} pedidos aguardam`}{" "}
            entrega. Enquanto não chega, o material continua faltando para a produção.
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : pedidos.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhum pedido de compra. Quando faltar material numa OS, o botão “Comprar o que
              falta” cria o pedido já preenchido.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pedidos.map((p) => {
                  const total = p.pedido_compra_itens.reduce(
                    (s, i) => s + Number(i.quantidade) * Number(i.custo_unitario),
                    0,
                  );
                  return (
                    <TableRow key={p.id} className="align-top">
                      <TableCell className="font-medium">#{p.numero}</TableCell>
                      <TableCell>{p.fornecedor}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {p.pedido_compra_itens.map((i) => {
                            const pendente = Number(i.quantidade) - Number(i.quantidade_recebida);
                            return (
                              <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <span>{i.materiais_operacional?.nome ?? "Material"}</span>
                                <span className="font-mono text-muted-foreground">
                                  {n2(Number(i.quantidade_recebida))}/{n2(Number(i.quantidade))}{" "}
                                  {i.materiais_operacional?.unidade ?? ""}
                                </span>
                                {pendente > 0 && podeReceber && p.status !== "cancelado" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs"
                                    onClick={() => setRecebendo(i)}
                                  >
                                    Receber
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{brl(total)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.previsao_entrega
                          ? new Date(`${p.previsao_entrega}T00:00:00`).toLocaleDateString("pt-BR")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tomDoStatus[p.status] ?? "outline"} className="font-normal">
                          {rotuloStatus[p.status] ?? p.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NovoPedidoDialog
        open={novoAberto}
        onOpenChange={setNovoAberto}
        onCriado={() => qc.invalidateQueries({ queryKey: ["pedidos-compra"] })}
      />

      <ReceberDialog
        item={recebendo}
        onOpenChange={(v) => !v && setRecebendo(null)}
        onRecebido={() => {
          qc.invalidateQueries({ queryKey: ["pedidos-compra"] });
          qc.invalidateQueries({ queryKey: ["materiais"] });
        }}
      />
    </div>
  );
}

function NovoPedidoDialog({
  open,
  onOpenChange,
  onCriado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: () => void;
}) {
  const [fornecedor, setFornecedor] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [material, setMaterial] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: materiais = [] } = useQuery({
    queryKey: ["materiais-para-compra"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("materiais_operacional")
        .select("id, nome, unidade")
        .order("nome");
      return data ?? [];
    },
  });

  async function salvar() {
    if (!fornecedor.trim()) return toast.error("Informe o fornecedor");
    if (!material) return toast.error("Escolha o material");
    if (Number(quantidade) <= 0) return toast.error("Informe a quantidade");
    if (Number(custo) < 0) return toast.error("Informe o custo unitário");

    setSalvando(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data: pedido, error } = await (supabase as any)
      .from("pedidos_compra")
      .insert({
        fornecedor: fornecedor.trim(),
        status: "enviado",
        previsao_entrega: previsao || null,
        created_by: auth.user?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !pedido) {
      setSalvando(false);
      return toast.error(error?.message ?? "Seu perfil não pode criar pedido de compra.");
    }

    const { error: erroItem } = await (supabase as any).from("pedido_compra_itens").insert({
      pedido_id: pedido.id,
      material_id: material,
      quantidade: Number(quantidade),
      custo_unitario: Number(custo),
    });
    setSalvando(false);
    if (erroItem) return toast.error(erroItem.message);

    toast.success("Pedido criado");
    setFornecedor("");
    setPrevisao("");
    setMaterial("");
    setQuantidade("");
    setCusto("");
    onOpenChange(false);
    onCriado();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Novo pedido de compra
          </DialogTitle>
          <DialogDescription>
            Ao receber, o material entra no estoque com lote e o custo médio é recalculado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="fornecedor">Fornecedor</Label>
            <Input id="fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
          </div>
          <div>
            <Label>Material</Label>
            <Select value={material} onValueChange={setMaterial}>
              <SelectTrigger><SelectValue placeholder="Escolha o material" /></SelectTrigger>
              <SelectContent>
                {materiais.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome} ({m.unidade ?? "un"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor="qtd">Quantidade</Label>
              <Input id="qtd" type="number" min="0" step="0.01" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="custo">Custo un.</Label>
              <Input id="custo" type="number" min="0" step="0.01" value={custo} onChange={(e) => setCusto(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="prev">Previsão</Label>
              <Input id="prev" type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Criando…" : "Criar pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceberDialog({
  item,
  onOpenChange,
  onRecebido,
}: {
  item: ItemPedido | null;
  onOpenChange: (v: boolean) => void;
  onRecebido: () => void;
}) {
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");
  const [nota, setNota] = useState("");

  const pendente = item ? Number(item.quantidade) - Number(item.quantidade_recebida) : 0;

  const receber = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const { data, error } = await (supabase.rpc as any)("receber_item_compra", {
        p_item_id: item.id,
        p_quantidade: Number(quantidade || pendente),
        p_custo_unitario: custo ? Number(custo) : null,
        p_nota: nota || null,
      });
      if (error) throw error;
      return data as { custo_medio: number; pedido_status: string };
    },
    onSuccess: (r) => {
      toast.success(
        `Recebido. Custo médio do material agora é ${brl(Number(r?.custo_medio ?? 0))}.`,
      );
      setQuantidade("");
      setCusto("");
      setNota("");
      onOpenChange(false);
      onRecebido();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao receber"),
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receber material</DialogTitle>
          <DialogDescription>
            {item?.materiais_operacional?.nome} — faltam {n2(pendente)}{" "}
            {item?.materiais_operacional?.unidade ?? ""} deste pedido. Recebimento parcial é
            aceito; o resto continua pendente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="rec-qtd">Quantidade recebida</Label>
            <Input
              id="rec-qtd"
              type="number"
              min="0"
              step="0.01"
              placeholder={n2(pendente)}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rec-custo">Custo unitário da nota</Label>
            <Input
              id="rec-custo"
              type="number"
              min="0"
              step="0.01"
              placeholder={item ? n2(Number(item.custo_unitario)) : ""}
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
            />
            {/* O preço que veio na nota manda sobre o do pedido: é ele que entra
                no custo médio, e é por ele que a gráfica pagou. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Em branco usa o custo do pedido. Se a nota veio diferente, informe o valor real.
            </p>
          </div>
          <div>
            <Label htmlFor="rec-nota">Nota fiscal</Label>
            <Input id="rec-nota" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => receber.mutate()} disabled={receber.isPending}>
            {receber.isPending ? "Recebendo…" : "Receber e dar entrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
