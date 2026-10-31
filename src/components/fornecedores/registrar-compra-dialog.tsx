import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  brl,
  ROTULO_DA_FINALIDADE,
  ROTULO_DO_TIPO,
  type CompraNoFornecedor,
  type Finalidade,
  type TipoDoDocumento,
} from "@/domain/fornecedores/compras";
import {
  agoraEmMacapa,
  documentoComTipo,
  lerValor,
  linhaVazia,
  montarPedido,
  precoDaLinha,
  problemasDaCompra,
  rendeSugerido,
  totaisDaCompra,
  type FormularioDaCompra,
  type LinhaDaCompra,
} from "@/domain/fornecedores/registro";

type MaterialDaLista = {
  id: string;
  nome: string;
  unidade: string;
  largura_bobina_m: number | null;
  comprimento_bobina_m: number | null;
};

type Comprador = "bex_print" | "agencia" | "outro";

const AGENCIA_BEX = "AGENCIA BEX LTDA";
const NENHUM = "__nenhum__";

const formularioNovo = (): FormularioDaCompra => ({
  tipo: "venda",
  numero: "",
  data: agoraEmMacapa(),
  comprador_nome: "",
  comprador_cnpj: "",
  codigo_cliente: "",
  forma_pagamento: "Pix",
  condicao_pagamento: "À vista",
  pago: true,
  devolve_compra_id: null,
  observacoes: "",
  linhas: [linhaVazia()],
});

/**
 * Registrar o documento que o fornecedor emitiu, com os itens. Grava por
 * `registrar_compra_fornecedor`, que recalcula os totais e recusa o que
 * estiver errado; aqui a conta aparece antes de salvar. É registro: não mexe
 * em estoque, caixa nem custo do material.
 */
export function RegistrarCompraDialog({
  open,
  fornecedor,
  documentos,
  onOpenChange,
  onRegistrado,
}: {
  open: boolean;
  fornecedor: { id: string; nome: string };
  /** Documentos já registrados neste fornecedor: a devolução escolhe a venda entre eles. */
  documentos: CompraNoFornecedor[];
  onOpenChange: (aberto: boolean) => void;
  onRegistrado: () => void;
}) {
  const [form, setForm] = useState<FormularioDaCompra>(formularioNovo);
  const [comprador, setComprador] = useState<Comprador>("bex_print");
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const empresa = useQuery({
    queryKey: ["empresa-config", "comprador"],
    enabled: open,
    queryFn: async (): Promise<{ razao_social: string | null; cnpj: string | null }> => {
      const { data, error } = await (supabase as any)
        .from("empresa_config")
        .select("razao_social, cnpj")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return { razao_social: data?.razao_social ?? null, cnpj: data?.cnpj ?? null };
    },
  });

  // Nome e unidade do material vêm da visão sem custo: quem cuida de compras
  // sem o financeiro também liga o item ao estoque.
  const materiais = useQuery({
    queryKey: ["materiais", "para-registrar-compra"],
    enabled: open,
    queryFn: async (): Promise<MaterialDaLista[]> => {
      const { data, error } = await fromFinancialView("materiais", "operacional")
        .select("id, nome, unidade, largura_bobina_m, comprimento_bobina_m")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((m) => ({
        ...m,
        largura_bobina_m: m.largura_bobina_m == null ? null : Number(m.largura_bobina_m),
        comprimento_bobina_m: m.comprimento_bobina_m == null ? null : Number(m.comprimento_bobina_m),
      }));
    },
  });
  const porId = useMemo(() => new Map((materiais.data ?? []).map((m) => [m.id, m])), [materiais.data]);

  useEffect(() => {
    if (!open) return;
    setForm(formularioNovo());
    setComprador("bex_print");
    setTentouSalvar(false);
  }, [open]);

  // O comprador escolhido preenche nome e CNPJ; "Outro" deixa a pessoa digitar.
  useEffect(() => {
    if (comprador === "bex_print") {
      setForm((f) => ({
        ...f,
        comprador_nome: empresa.data?.razao_social ?? "Bex Print Gráfica e Comunicação Visual LTDA",
        comprador_cnpj: empresa.data?.cnpj ?? "68.726.406/0001-90",
      }));
    } else if (comprador === "agencia") {
      setForm((f) => ({ ...f, comprador_nome: AGENCIA_BEX, comprador_cnpj: "" }));
    } else {
      setForm((f) => ({ ...f, comprador_nome: "", comprador_cnpj: "" }));
    }
    // `open` também: ao reabrir, o formulário volta vazio e o comprador precisa ser preenchido de novo.
  }, [comprador, empresa.data, open]);

  const vendas = documentos.filter((d) => d.tipo === "venda");
  const totais = totaisDaCompra(form);
  const problemas = problemasDaCompra(form);

  const muda = <K extends keyof FormularioDaCompra>(campo: K, valor: FormularioDaCompra[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }));
  const mudaLinha = (i: number, campos: Partial<LinhaDaCompra>) =>
    setForm((f) => ({ ...f, linhas: f.linhas.map((l, j) => (j === i ? { ...l, ...campos } : l)) }));

  function escolherMaterial(i: number, id: string) {
    if (id === NENHUM) {
      mudaLinha(i, { material_id: null, rende: "" });
      return;
    }
    const m = porId.get(id);
    const sugerido = m ? rendeSugerido(m) : null;
    mudaLinha(i, {
      material_id: id,
      rende: sugerido == null ? "" : String(sugerido).replace(".", ","),
    });
  }

  async function salvar() {
    setTentouSalvar(true);
    if (problemas.length > 0) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any).rpc("registrar_compra_fornecedor", {
        p: montarPedido(form, fornecedor.id),
      });
      if (error) throw error;
      toast.success(`${documentoComTipo(form.tipo, form.numero)} registrada em ${fornecedor.nome}.`);
      onRegistrado();
      onOpenChange(false);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível registrar a compra."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Registrar compra em {fornecedor.nome}</DialogTitle>
          <DialogDescription>
            Copie o documento como o fornecedor emitiu: tipo, número, data, quem comprou e cada item com o preço pago.
            Não mexe em estoque, caixa nem custo do material.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Tipo do documento</legend>
              <div className="flex flex-wrap gap-2">
                {(["venda", "reserva", "devolucao"] as TipoDoDocumento[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={form.tipo === t ? "default" : "outline"}
                    aria-pressed={form.tipo === t}
                    className="h-11 md:h-8"
                    onClick={() => setForm((f) => ({ ...f, tipo: t, devolve_compra_id: t === "devolucao" ? f.devolve_compra_id : null }))}
                  >
                    {ROTULO_DO_TIPO[t]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {form.tipo === "reserva"
                  ? "Reserva: pedido pago que, no sistema do fornecedor, ainda não virou venda (sem nota)."
                  : form.tipo === "devolucao"
                    ? "Devolução: digite as quantidades normais; o sistema guarda como saída da venda escolhida."
                    : "Venda: compra faturada pelo fornecedor."}
              </p>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="compra-numero">Número do documento</Label>
              <Input
                id="compra-numero"
                inputMode="numeric"
                value={form.numero}
                onChange={(e) => muda("numero", e.target.value)}
                placeholder="Ex.: 23500"
              />
              {form.numero.trim() && (
                <p className="text-xs text-muted-foreground">Fica registrado como {documentoComTipo(form.tipo, form.numero)}.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compra-data">Data e hora da operação</Label>
              <Input
                id="compra-data"
                type="datetime-local"
                value={form.data}
                onChange={(e) => muda("data", e.target.value)}
              />
            </div>

            {form.tipo === "devolucao" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Venda que esta devolução desfaz</Label>
                {vendas.length === 0 ? (
                  <p className="text-sm text-destructive">Nenhuma venda registrada neste fornecedor para devolver.</p>
                ) : (
                  <Select
                    value={form.devolve_compra_id ?? undefined}
                    onValueChange={(v) => muda("devolve_compra_id", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha a venda" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendas.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.documento} · {brl(v.total)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Quem comprou</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["bex_print", "Bex Print"],
                    ["agencia", "Agência Bex"],
                    ["outro", "Outro CNPJ"],
                  ] as [Comprador, string][]
                ).map(([valor, rotulo]) => (
                  <Button
                    key={valor}
                    type="button"
                    size="sm"
                    variant={comprador === valor ? "default" : "outline"}
                    aria-pressed={comprador === valor}
                    className="h-11 md:h-8"
                    onClick={() => setComprador(valor)}
                  >
                    {rotulo}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="compra-comprador">Razão social de quem comprou</Label>
              <Input
                id="compra-comprador"
                value={form.comprador_nome}
                disabled={comprador !== "outro"}
                onChange={(e) => muda("comprador_nome", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compra-comprador-cnpj">CNPJ de quem comprou</Label>
              <Input
                id="compra-comprador-cnpj"
                value={form.comprador_cnpj}
                disabled={comprador !== "outro"}
                onChange={(e) => muda("comprador_cnpj", e.target.value)}
                placeholder={comprador === "agencia" ? "não aparece no documento" : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compra-codigo-cliente">Código do cliente no fornecedor</Label>
              <Input
                id="compra-codigo-cliente"
                value={form.codigo_cliente}
                onChange={(e) => muda("codigo_cliente", e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="compra-forma">Forma de pagamento</Label>
              <Input
                id="compra-forma"
                list="compra-formas"
                value={form.forma_pagamento}
                onChange={(e) => muda("forma_pagamento", e.target.value)}
              />
              <datalist id="compra-formas">
                {["Pix", "Dinheiro", "Cartão débito", "Cartão crédito", "Boleto", "Transferência"].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compra-condicao">Condição</Label>
              <Input
                id="compra-condicao"
                list="compra-condicoes"
                value={form.condicao_pagamento}
                onChange={(e) => muda("condicao_pagamento", e.target.value)}
              />
              <datalist id="compra-condicoes">
                {["À vista", "Cartão", "A prazo"].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </div>
            <div className="flex items-end gap-3 pb-2">
              <Switch id="compra-pago" checked={form.pago} onCheckedChange={(v) => muda("pago", v)} />
              <Label htmlFor="compra-pago" className="font-normal">
                {form.pago ? "Pago (operação recebida)" : "Ainda não pago"}
              </Label>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Itens</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setForm((f) => ({ ...f, linhas: [...f.linhas, linhaVazia()] }))}
              >
                <Plus className="mr-1 h-4 w-4" /> Adicionar item
              </Button>
            </div>
            {form.linhas.map((l, i) => {
              const preco = precoDaLinha(l);
              const qtd = lerValor(l.quantidade);
              const totalDaLinha = preco != null && qtd != null ? Math.round(Math.abs(qtd) * preco * 100) / 100 : null;
              const material = l.material_id ? porId.get(l.material_id) : undefined;
              return (
                <div key={i} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Item {i + 1}</span>
                    {form.linhas.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 md:h-8"
                        aria-label={`Tirar o item ${i + 1}`}
                        onClick={() => setForm((f) => ({ ...f, linhas: f.linhas.filter((_, j) => j !== i) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-6">
                    <div className="space-y-1 sm:col-span-1">
                      <Label htmlFor={`item-${i}-codigo`} className="text-xs">Código</Label>
                      <Input id={`item-${i}-codigo`} value={l.codigo} onChange={(e) => mudaLinha(i, { codigo: e.target.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-4">
                      <Label htmlFor={`item-${i}-descricao`} className="text-xs">Descrição</Label>
                      <Input id={`item-${i}-descricao`} value={l.descricao} onChange={(e) => mudaLinha(i, { descricao: e.target.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-1">
                      <Label htmlFor={`item-${i}-unidade`} className="text-xs">Unidade</Label>
                      <Input id={`item-${i}-unidade`} value={l.unidade} onChange={(e) => mudaLinha(i, { unidade: e.target.value })} placeholder="UN, RL, MT" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`item-${i}-qtd`} className="text-xs">Quantidade</Label>
                      <Input id={`item-${i}-qtd`} inputMode="decimal" value={l.quantidade} onChange={(e) => mudaLinha(i, { quantidade: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`item-${i}-lista`} className="text-xs">Preço de tabela</Label>
                      <Input id={`item-${i}-lista`} inputMode="decimal" value={l.preco_lista} onChange={(e) => mudaLinha(i, { preco_lista: e.target.value })} placeholder="450,00" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`item-${i}-desc`} className="text-xs">Desconto %</Label>
                      <Input id={`item-${i}-desc`} inputMode="decimal" value={l.desconto_pct} onChange={(e) => mudaLinha(i, { desconto_pct: e.target.value })} placeholder="20" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`item-${i}-preco`} className="text-xs">Preço pago (un.)</Label>
                      <Input
                        id={`item-${i}-preco`}
                        inputMode="decimal"
                        value={l.preco_unitario}
                        onChange={(e) => mudaLinha(i, { preco_unitario: e.target.value })}
                        placeholder={preco != null && !l.preco_unitario ? preco.toFixed(2).replace(".", ",") : "360,00"}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <span className="block text-xs text-muted-foreground">Total do item</span>
                      <span className="block py-2 text-sm font-medium tabular-nums">
                        {totalDaLinha == null ? "—" : brl(form.tipo === "devolucao" ? -totalDaLinha : totalDaLinha)}
                      </span>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Para quê</Label>
                      <Select value={l.finalidade} onValueChange={(v) => mudaLinha(i, { finalidade: v as Finalidade })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROTULO_DA_FINALIDADE) as Finalidade[]).map((f) => (
                            <SelectItem key={f} value={f}>
                              {ROTULO_DA_FINALIDADE[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Material do estoque (opcional)</Label>
                      <Select value={l.material_id ?? NENHUM} onValueChange={(v) => escolherMaterial(i, v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NENHUM}>Nenhum (ferramenta, copa…)</SelectItem>
                          {(materiais.data ?? []).map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.nome} ({m.unidade})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {l.material_id && (
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`item-${i}-rende`} className="text-xs">
                          Uma unidade rende ({material?.unidade ?? "unidade do material"})
                        </Label>
                        <Input
                          id={`item-${i}-rende`}
                          inputMode="decimal"
                          value={l.rende}
                          onChange={(e) => mudaLinha(i, { rende: e.target.value })}
                          placeholder="rolo 1,06 × 50 = 53"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <div className="space-y-1.5">
            <Label htmlFor="compra-obs">Observações</Label>
            <Textarea id="compra-obs" rows={2} value={form.observacoes} onChange={(e) => muda("observacoes", e.target.value)} />
          </div>

          <dl className="grid grid-cols-3 gap-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Bruto</dt>
              <dd className="tabular-nums">{brl(totais.bruto)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Desconto</dt>
              <dd className="tabular-nums">{brl(totais.desconto)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="text-base font-semibold tabular-nums">{brl(totais.total)}</dd>
            </div>
          </dl>

          {tentouSalvar && problemas.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={salvar}>
            {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Registrar compra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
