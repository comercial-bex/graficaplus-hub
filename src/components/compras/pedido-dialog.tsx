import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  conferirPedido,
  custoSugerido,
  linhasDoPedido,
  subtotalDaLinha,
  totalDoFormulario,
  type LinhaDoPedido,
  type MaterialParaCompra,
  type PedidoDeCompra,
} from "@/components/compras/pedido";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n2 = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

let sequencia = 0;
const novaChave = () => `linha-${Date.now()}-${++sequencia}`;
const linhaNova = (): LinhaDoPedido => ({ chave: novaChave(), material_id: "", quantidade: "", custo_unitario: "" });

/**
 * Pedido de compra com vários materiais — criar, revisar o rascunho que veio da
 * OS, ou corrigir um pedido registrado em que nada chegou ainda.
 *
 * Grava tudo de uma vez por `salvar_pedido_compra`: antes eram dois INSERTs
 * soltos, e se o segundo caísse ficava um pedido sem item nenhum "aguardando
 * entrega" para sempre. A tela confere antes (mesmas frases do banco) só para
 * apontar a linha errada sem ida ao servidor; quem decide é o banco.
 */
export function PedidoDialog({
  open,
  onOpenChange,
  pedido,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = pedido novo */
  pedido: PedidoDeCompra | null;
  onSalvo: () => void;
}) {
  const { canSeeFinancials } = useAuth();
  const [fornecedor, setFornecedor] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [linhas, setLinhas] = useState<LinhaDoPedido[]>([linhaNova()]);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "registrar" | null>(null);

  const ehRascunho = pedido?.status === "rascunho";
  const ehRegistrado = pedido?.status === "enviado";

  // Preenche uma vez por abertura. Depois disso o formulário é da pessoa:
  // recarregar a cada render apagaria o que ela digitou.
  const carregadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      carregadoPara.current = null;
      return;
    }
    const chave = pedido?.id ?? "novo";
    if (carregadoPara.current === chave) return;
    carregadoPara.current = chave;
    setProblemas([]);
    if (pedido) {
      setFornecedor(pedido.fornecedor ?? "");
      setPrevisao(pedido.previsao_entrega ?? "");
      setObservacoes(pedido.observacoes ?? "");
      setLinhas([...linhasDoPedido(pedido.pedido_compra_itens, novaChave), linhaNova()]);
    } else {
      setFornecedor("");
      setPrevisao("");
      setObservacoes("");
      setLinhas([linhaNova()]);
    }
  }, [open, pedido]);

  // Custo e fornecedor do material só existem na visão financeira; quem cuida
  // do estoque sem financeiro.read escolhe pelo nome e digita o custo da
  // cotação — que é o número que vale para o pedido de qualquer jeito.
  const materiais = useQuery({
    queryKey: ["materiais-para-compra", canSeeFinancials ? "financeiro" : "operacional"],
    enabled: open,
    queryFn: async (): Promise<MaterialParaCompra[]> => {
      const colunas = canSeeFinancials
        ? "id, nome, unidade, estoque, estoque_minimo, custo_medio, custo_unitario, fornecedor"
        : "id, nome, unidade, estoque, estoque_minimo";
      const { data, error } = await fromFinancialView("materiais", canSeeFinancials)
        .select(colunas)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaterialParaCompra[];
    },
  });

  const porId = useMemo(
    () => new Map((materiais.data ?? []).map((m) => [m.id, m])),
    [materiais.data],
  );
  const nomeDe = (id: string) => porId.get(id)?.nome ?? "material sem nome";
  const total = totalDoFormulario(linhas);

  function alterarLinha(chave: string, patch: Partial<LinhaDoPedido>) {
    setLinhas((atual) => {
      const novas = atual.map((l) => (l.chave === chave ? { ...l, ...patch } : l));
      // Sempre sobra uma linha em branco no fim: adicionar item é só começar
      // a digitar, sem caçar botão.
      const ultima = novas[novas.length - 1];
      return ultima && (ultima.material_id || ultima.quantidade || ultima.custo_unitario)
        ? [...novas, linhaNova()]
        : novas;
    });
  }

  function escolherMaterial(chave: string, materialId: string) {
    const m = porId.get(materialId);
    const linha = linhas.find((l) => l.chave === chave);
    alterarLinha(chave, {
      material_id: materialId,
      // Palpite só quando o campo está vazio: não passa por cima do que a
      // pessoa digitou da cotação.
      ...(linha && !linha.custo_unitario.trim() ? { custo_unitario: custoSugerido(m) } : {}),
    });
    // Fornecedor em branco ganha o último do material como palpite — o mesmo
    // que o "Comprar o que falta" da OS faz. A pessoa vê no campo e troca.
    if (!fornecedor.trim() && m?.fornecedor) setFornecedor(m.fornecedor);
  }

  function removerLinha(chave: string) {
    setLinhas((atual) => {
      const restantes = atual.filter((l) => l.chave !== chave);
      return restantes.length > 0 ? restantes : [linhaNova()];
    });
  }

  async function salvar(registrar: boolean) {
    const conferido = conferirPedido({ fornecedor, linhas, registrar, nomeDe });
    setProblemas(conferido.problemas);
    if (conferido.problemas.length > 0) return;

    setSalvando(registrar ? "registrar" : "rascunho");
    const itens = conferido.itens;
    const { data, error } = await (supabase.rpc as any)("salvar_pedido_compra", {
      p_pedido_id: pedido?.id ?? null,
      p_fornecedor: fornecedor.trim(),
      p_itens: itens,
      p_previsao_entrega: previsao || null,
      p_observacoes: observacoes.trim() || null,
      p_enviar: registrar,
    });
    setSalvando(null);

    if (error) {
      const msg = mensagemErro(error, "Não foi possível salvar o pedido.");
      setProblemas([msg]);
      toast.error(msg);
      return;
    }
    const r = (data ?? {}) as { numero?: number; status?: string; total?: number };
    toast.success(
      r.status === "rascunho"
        ? `Pedido #${r.numero} guardado como rascunho.`
        : `Pedido #${r.numero} registrado: ${brl(Number(r.total ?? total))} aguardando entrega.`,
    );
    onOpenChange(false);
    onSalvo();
  }

  const titulo = !pedido
    ? "Novo pedido de compra"
    : ehRascunho
      ? `Revisar o rascunho #${pedido.numero}`
      : `Corrigir o pedido #${pedido.numero}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> {titulo}
          </DialogTitle>
          <DialogDescription>
            {ehRascunho
              ? "Este rascunho nasceu da falta de material numa OS. Confira o fornecedor e os custos da cotação e registre o pedido quando ele for feito."
              : "Um pedido pode ter vários materiais. Ao receber, cada um entra no estoque com lote e o custo médio é recalculado."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-1.5">
              <Label htmlFor="pedido-fornecedor">Fornecedor</Label>
              <Input
                id="pedido-fornecedor"
                value={fornecedor}
                onChange={(e) => setFornecedor(e.target.value)}
                placeholder="Quem vai entregar"
                className="h-11 md:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pedido-previsao">Previsão de entrega</Label>
              <Input
                id="pedido-previsao"
                type="date"
                value={previsao}
                onChange={(e) => setPrevisao(e.target.value)}
                className="h-11 md:h-9"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Materiais</Label>
              <span className="text-xs text-muted-foreground">
                Sempre há uma linha em branco no fim para o próximo item.
              </span>
            </div>

            {materiais.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando os materiais…</p>
            ) : materiais.isError ? (
              <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
                <p>Não deu para carregar os materiais: {mensagemErro(materiais.error)}</p>
                <Button size="sm" variant="outline" onClick={() => materiais.refetch()}>
                  Tentar de novo
                </Button>
              </div>
            ) : (materiais.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum material cadastrado. Cadastre em Materiais antes de pedir.
              </p>
            ) : (
              <ul className="space-y-2">
                {linhas.map((l, i) => {
                  const m = porId.get(l.material_id);
                  const sub = subtotalDaLinha(l);
                  const ultima = i === linhas.length - 1 && !l.material_id;
                  return (
                    <li
                      key={l.chave}
                      className="grid grid-cols-2 gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[minmax(0,1fr)_110px_120px_100px_36px] sm:items-end"
                    >
                      <div className="col-span-2 space-y-1 sm:col-span-1">
                        <Label className="text-xs text-muted-foreground sm:sr-only">Material</Label>
                        <Select value={l.material_id} onValueChange={(v) => escolherMaterial(l.chave, v)}>
                          <SelectTrigger className="h-11 md:h-9" aria-label={`Material da linha ${i + 1}`}>
                            <SelectValue placeholder={ultima ? "Adicionar material…" : "Escolha o material"} />
                          </SelectTrigger>
                          <SelectContent>
                            {(materiais.data ?? []).map((mat) => (
                              <SelectItem key={mat.id} value={mat.id}>
                                {mat.nome} ({mat.unidade ?? "un"}) · estoque {n2(mat.estoque)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`qtd-${l.chave}`} className="text-xs text-muted-foreground">
                          Quantidade{m ? ` (${m.unidade ?? "un"})` : ""}
                        </Label>
                        <Input
                          id={`qtd-${l.chave}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={l.quantidade}
                          onChange={(e) => alterarLinha(l.chave, { quantidade: e.target.value })}
                          className="h-11 md:h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`custo-${l.chave}`} className="text-xs text-muted-foreground">
                          Custo unitário
                        </Label>
                        <Input
                          id={`custo-${l.chave}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={l.custo_unitario}
                          onChange={(e) => alterarLinha(l.chave, { custo_unitario: e.target.value })}
                          className="h-11 md:h-9"
                        />
                      </div>
                      <div className="text-right font-mono text-sm tabular-nums sm:pb-2">
                        {sub > 0 ? brl(sub) : "—"}
                      </div>
                      <div className="flex justify-end sm:pb-0.5">
                        {!ultima && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-11 w-11 md:h-9 md:w-9"
                            onClick={() => removerLinha(l.chave)}
                            aria-label={`Tirar ${m?.nome ?? "esta linha"} do pedido`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
              <span className="text-sm text-muted-foreground">
                {linhas.filter((l) => l.material_id).length} material(is) no pedido
              </span>
              <span className="font-mono text-base font-bold tabular-nums">Total {brl(total)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pedido-obs">Observações</Label>
            <Textarea
              id="pedido-obs"
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Condição de pagamento, frete, contato do vendedor…"
            />
          </div>

          {problemas.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {ehRegistrado ? (
            <Button className="h-11 md:h-9" disabled={!!salvando || materiais.isLoading} onClick={() => salvar(true)}>
              {salvando ? "Salvando…" : "Salvar alterações"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-11 md:h-9"
                disabled={!!salvando || materiais.isLoading}
                onClick={() => salvar(false)}
              >
                {salvando === "rascunho" ? "Guardando…" : "Guardar como rascunho"}
              </Button>
              <Button className="h-11 md:h-9" disabled={!!salvando || materiais.isLoading} onClick={() => salvar(true)}>
                {salvando === "registrar" ? "Registrando…" : "Registrar pedido"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
