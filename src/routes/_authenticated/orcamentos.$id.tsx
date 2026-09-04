import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { ArrowLeft, Plus, Trash2, ArrowRight, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";
import { PDFHistoryCard } from "@/lib/pdf/PDFHistoryCard";
import { ProdutoAutocomplete } from "@/components/produto-autocomplete";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import {
  areaTotal,
  areaUnitaria,
  descreverMetragem,
  ehUnidadeDeArea,
  somaAreaTotal,
  temDimensoes,
  valorUnitarioPorM2,
} from "@/domain/orcamentos/area";
import { mensagemErro } from "@/lib/erros";

const itemVazio = {
  descricao: "",
  quantidade: "1",
  unidade: "un",
  largura: "",
  altura: "",
  acabamento: "",
  preco_m2: "",
  valor_unitario: "0",
  custo_unitario: "0",
  produto_id: null as string | null,
  arquivo_id: null as string | null,
  arquivo_nome: null as string | null,
};

const paraNumero = (texto: string) => {
  const n = Number(String(texto).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

type TamanhoProduto = {
  id: string;
  produto_id: string;
  nome: string;
  largura: number;
  altura: number;
  padrao: boolean;
};

const statusTone: Record<string, "cyan" | "magenta" | "lime" | "amber" | "muted"> = {
  rascunho: "muted",
  enviado: "cyan",
  aprovado: "lime",
  rejeitado: "magenta",
  expirado: "amber",
  convertido: "lime",
};

export const Route = createFileRoute("/_authenticated/orcamentos/$id")({
  head: () => ({ meta: [{ title: "Orçamento — BEX PRINT OS" }] }),
  component: OrcamentoDetailPage,
});

function OrcamentoDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [form, setForm] = useState({ ...itemVazio });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProducaoOpen, setPreviewProducaoOpen] = useState(false);
  const [gerandoLink, setGerandoLink] = useState(false);
  const [enviandoLayout, setEnviandoLayout] = useState(false);


  const { data: orc, isLoading } = useQuery({
    queryKey: ["orcamento", id, canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("orcamentos", canSeeFinancials)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["orc-itens", id, canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () =>
      (
        await fromFinancialView("orcamento_itens", canSeeFinancials)
          .select("*")
          .eq("orcamento_id", id)
          .order("ordem")
      ).data ?? [],
  });

  // Tamanhos do produto escolhido no catálogo. Só busca quando há produto: item
  // digitado à mão não tem preset para oferecer.
  const { data: tamanhos = [] } = useQuery({
    queryKey: ["produto-tamanhos", form.produto_id],
    enabled: !!form.produto_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_tamanhos")
        .select("id, produto_id, nome, largura, altura, padrao")
        .eq("produto_id", form.produto_id)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as TamanhoProduto[];
    },
  });

  function aplicarTamanho(t: TamanhoProduto) {
    setForm((atual) => ({
      ...atual,
      largura: String(t.largura),
      altura: String(t.altura),
    }));
  }

  async function recalcular() {
    if (!canSeeFinancials) return;
    // Relê os itens do banco em vez de somar o estado da tela: recalcular é
    // chamado logo depois de inserir/remover, quando `itens` ainda é a lista
    // anterior. Somando o estado velho, o total do orçamento ficava zerado após
    // adicionar o primeiro item — e era esse zero que ia para o PDF e para a
    // conta a receber criada na conversão em OS.
    const { data: atuais } = await fromFinancialView("orcamento_itens", true)
      .select("valor_total, custo_unitario, quantidade")
      .eq("orcamento_id", id);
    const lista = (atuais ?? []) as {
      valor_total: number | null;
      custo_unitario: number | null;
      quantidade: number | null;
    }[];
    const subtotal = lista.reduce((s, i) => s + Number(i.valor_total ?? 0), 0);
    const custo = lista.reduce(
      (s, i) => s + Number(i.custo_unitario ?? 0) * Number(i.quantidade ?? 0),
      0,
    );
    await supabase
      .from("orcamentos")
      .update({
        valor_subtotal: subtotal,
        valor_total: subtotal,
        custo_estimado: custo,
      })
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  // Dimensões do item em edição, para mostrar a área antes de gravar.
  const dimensoesForm = {
    largura: paraNumero(form.largura),
    altura: paraNumero(form.altura),
    quantidade: paraNumero(form.quantidade),
  };
  const precoM2Form = paraNumero(form.preco_m2);
  const vendidoPorArea = temDimensoes(dimensoesForm);
  // Com preço/m² informado, o valor unitário é derivado — o trigger no banco
  // aplica a mesma regra, então o campo fica só como leitura.
  const valorUnitarioDerivado =
    vendidoPorArea && precoM2Form > 0 ? valorUnitarioPorM2(dimensoesForm, precoM2Form) : null;

  async function enviarLayout(arquivo: File) {
    setEnviandoLayout(true);
    try {
      const extensao = arquivo.name.split(".").pop() ?? "bin";
      const caminho = `orcamento/${id}/${Date.now()}.${extensao}`;
      const { error: erroUpload } = await supabase.storage
        .from("arquivos-clientes")
        .upload(caminho, arquivo, { contentType: arquivo.type });
      if (erroUpload) throw erroUpload;

      const { data: registro, error: erroRegistro } = await supabase
        .from("arquivos")
        .insert({
          nome: arquivo.name,
          caminho,
          // tipo 'arte' é o que a produção procura como layout a imprimir
          tipo: "arte",
          cliente_id: (orc as any)?.cliente_id ?? null,
          tamanho_bytes: arquivo.size,
        } as any)
        .select("id, nome")
        .single();
      if (erroRegistro) throw erroRegistro;

      setForm((atual) => ({
        ...atual,
        arquivo_id: (registro as any).id,
        arquivo_nome: (registro as any).nome,
      }));
      toast.success("Layout anexado ao item");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar o layout");
    } finally {
      setEnviandoLayout(false);
    }
  }

  async function addItem() {
    if (!form.descricao) return toast.error("Descrição obrigatória");
    if (vendidoPorArea && areaUnitaria(dimensoesForm) <= 0) {
      return toast.error("Largura e altura devem ser maiores que zero");
    }
    const qtd = paraNumero(form.quantidade) || 1;
    // valor_total e (quando há preço/m²) valor_unitario são derivados pelo
    // trigger tg_orcamento_itens_precificar — não são enviados daqui para não
    // haver dois lugares calculando o mesmo número.
    const { error } = await supabase.from("orcamento_itens").insert({
      orcamento_id: id,
      descricao: form.descricao,
      quantidade: qtd,
      unidade: form.unidade,
      largura: vendidoPorArea ? dimensoesForm.largura : null,
      altura: vendidoPorArea ? dimensoesForm.altura : null,
      acabamento: form.acabamento.trim() || null,
      preco_m2: canSeeFinancials && precoM2Form > 0 ? precoM2Form : null,
      valor_unitario: canSeeFinancials ? paraNumero(form.valor_unitario) : 0,
      custo_unitario: paraNumero(form.custo_unitario),
      ordem: itens.length,
      produto_id: form.produto_id,
      arquivo_id: form.arquivo_id,
    } as any);
    if (error) return toast.error(mensagemErro(error));
    setForm({ ...itemVazio });
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    await recalcular();
  }

  async function removeItem(itemId: string) {
    await supabase.from("orcamento_itens").delete().eq("id", itemId);
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    await recalcular();
  }

  async function setStatus(novoStatus: string) {
    const update: any = { status: novoStatus };
    if (novoStatus === "enviado") update.enviado_em = new Date().toISOString();
    if (novoStatus === "aprovado") update.aprovado_em = new Date().toISOString();
    const { error } = await supabase.from("orcamentos").update(update).eq("id", id);
    if (error) return toast.error(mensagemErro(error));
    toast.success("Status atualizado");
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  async function converterEmOS() {
    const { data, error } = await (supabase.rpc as any)("converter_orcamento_em_os", {
      p_orcamento_id: id,
      p_opcoes: {},
    });
    if (error) return toast.error(mensagemErro(error));
    const osId = typeof data === "object" && data && "os_id" in data ? String((data as any).os_id) : "";
    toast.success(`OS criada${osId ? ` (${osId})` : ""}`);
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!orc) return <div className="p-6">Orçamento não encontrado</div>;

  const margem =
    canSeeFinancials && Number(orc.valor_total) > 0
      ? ((Number(orc.valor_total) - Number(orc.custo_estimado)) / Number(orc.valor_total)) * 100
      : null;

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb={`Orçamento · #${orc.numero}`}
        title={orc.titulo}
        description={
          orc.cliente_nome ? `Cliente: ${orc.cliente_nome}` : undefined
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Link to="/orcamentos">
              <Button variant="ghost" size="icon" title="Voltar">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <StatusChip label={orc.status} tone={statusTone[orc.status] ?? "muted"} />
            <Select value={orc.status} onValueChange={setStatus}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["rascunho", "enviado", "aprovado", "rejeitado", "expirado"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <FileDown className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button variant="outline" onClick={() => setPreviewProducaoOpen(true)}>
              <Printer className="h-4 w-4 mr-1" /> Via de produção
            </Button>
            <Button variant="outline" onClick={copiarLinkCliente} disabled={gerandoLink}>
              {gerandoLink ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <LinkIcon className="h-4 w-4 mr-1" />
              )}
              Link do cliente
            </Button>
            <Button variant="outline" onClick={enviarWhatsApp} disabled={gerandoLink}>
              <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
            </Button>

            {orc.status !== "convertido" && !orc.os_id && (
              <Button onClick={converterEmOS}>
                Converter em OS <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex justify-end">
            <ProdutoAutocomplete
              onSelect={(p) =>
                setForm({
                  ...itemVazio,
                  descricao: p.nome,
                  quantidade: form.quantidade || "1",
                  unidade: p.unidade,
                  // produto medido em área já entra no modo de venda por m²;
                  // o catálogo usa "m2", mas "m²" aparece digitado à mão
                  preco_m2: ehUnidadeDeArea(p.unidade) ? String(p.preco_base ?? "") : "",
                  valor_unitario: String(p.preco_base ?? 0),
                  custo_unitario: String(p.custo_medio ?? 0),
                  produto_id: p.id,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <Label htmlFor="item-descricao">Descrição</Label>
                <Input
                  id="item-descricao"
                  value={form.descricao}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="item-qtd">Qtd</Label>
                <Input
                  id="item-qtd"
                  type="number"
                  min="0"
                  step="1"
                  value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="item-unidade">Un</Label>
                <Input
                  id="item-unidade"
                  value={form.unidade}
                  onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="item-acabamento">Acabamento</Label>
                <Input
                  id="item-acabamento"
                  placeholder="Refile, ilhós…"
                  value={form.acabamento}
                  onChange={(e) => setForm({ ...form, acabamento: e.target.value })}
                />
              </div>
            </div>

            {/* Tamanhos que a gráfica vende sempre iguais: um clique evita
                redigitar medida — e medida redigitada é onde entra erro. */}
            {tamanhos.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Tamanhos comuns:</span>
                {tamanhos.map((t) => {
                  const ativo =
                    paraNumero(form.largura) === Number(t.largura) &&
                    paraNumero(form.altura) === Number(t.altura);
                  return (
                    <Button
                      key={t.id}
                      type="button"
                      size="sm"
                      variant={ativo ? "default" : "outline"}
                      className="h-7 text-xs font-normal"
                      onClick={() => aplicarTamanho(t)}
                    >
                      {t.nome}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Medidas em metros: preencher as duas liga a venda por m². */}
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-2">
                <Label htmlFor="item-largura">Largura (m)</Label>
                <Input
                  id="item-largura"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="3,000"
                  value={form.largura}
                  onChange={(e) => setForm({ ...form, largura: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="item-altura">Altura (m)</Label>
                <Input
                  id="item-altura"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="2,450"
                  value={form.altura}
                  onChange={(e) => setForm({ ...form, altura: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <Label>Área</Label>
                <div className="h-10 flex items-center px-3 rounded-md border bg-muted/40 text-sm">
                  {vendidoPorArea ? (
                    <span>
                      {areaUnitaria(dimensoesForm).toFixed(3).replace(".", ",")}m² ·{" "}
                      <strong>{areaTotal(dimensoesForm).toFixed(3).replace(".", ",")}m²</strong> total
                    </span>
                  ) : (
                    <span className="text-muted-foreground">informe as medidas</span>
                  )}
                </div>
              </div>
              {canSeeFinancials && (
                <>
                  <div className="col-span-2">
                    <Label htmlFor="item-preco-m2">Preço/m²</Label>
                    <Input
                      id="item-preco-m2"
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!vendidoPorArea}
                      value={form.preco_m2}
                      onChange={(e) => setForm({ ...form, preco_m2: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="item-valor-un">Valor un.</Label>
                    <Input
                      id="item-valor-un"
                      type="number"
                      step="0.01"
                      readOnly={valorUnitarioDerivado !== null}
                      title={
                        valorUnitarioDerivado !== null
                          ? "Calculado a partir da área e do preço/m²"
                          : undefined
                      }
                      className={valorUnitarioDerivado !== null ? "bg-muted/40" : undefined}
                      value={
                        valorUnitarioDerivado !== null
                          ? valorUnitarioDerivado.toFixed(2)
                          : form.valor_unitario
                      }
                      onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="item-custo-un">Custo un.</Label>
                    <Input
                      id="item-custo-un"
                      type="number"
                      step="0.01"
                      value={form.custo_unitario}
                      onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="item-layout">Layout (arte a ser impressa)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="item-layout"
                    type="file"
                    accept="image/*,application/pdf"
                    className="max-w-xs"
                    disabled={enviandoLayout}
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) void enviarLayout(arquivo);
                      e.target.value = "";
                    }}
                  />
                  {enviandoLayout && (
                    <span className="text-sm text-muted-foreground">enviando…</span>
                  )}
                  {form.arquivo_nome && (
                    <Badge variant="secondary" className="gap-1">
                      {form.arquivo_nome}
                      <button
                        type="button"
                        aria-label="Remover layout do item"
                        onClick={() =>
                          setForm({ ...form, arquivo_id: null, arquivo_nome: null })
                        }
                        className="ml-1"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              </div>
              <Button onClick={addItem}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar item
              </Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Qtd</TableHead>
                <TableHead>Metragem</TableHead>
                <TableHead>Acabamento</TableHead>
                <TableHead>Layout</TableHead>
                {canSeeFinancials && (
                  <>
                    <TableHead>Valor un.</TableHead>
                    <TableHead>Total</TableHead>
                  </>
                )}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canSeeFinancials ? 8 : 6} className="text-center text-muted-foreground">
                    Sem itens
                  </TableCell>
                </TableRow>
              )}
              {itens.map((i: any) => (
                <TableRow key={i.id}>
                  <TableCell>{i.descricao}</TableCell>
                  <TableCell>
                    {i.quantidade} {i.unidade}
                  </TableCell>
                  <TableCell className="text-xs">
                    {descreverMetragem(i) ?? <span className="text-muted-foreground">—</span>}
                    {/* Mínimo aplicado precisa aparecer: o vendedor tem de saber
                        por que a conta deu mais que a área da peça. */}
                    {Number(i.area_cobrada ?? 0) > Number(i.area_total ?? 0) && (
                      <span className="block text-amber-600">
                        cobrado {Number(i.area_cobrada).toFixed(3).replace(".", ",")}m² (mínimo)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {i.acabamento || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {i.arquivo_id ? (
                      <Badge variant="secondary">anexado</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">sem arte</span>
                    )}
                  </TableCell>
                  {canSeeFinancials && (
                    <>
                      <TableCell>R$ {Number(i.valor_unitario).toFixed(2)}</TableCell>
                      <TableCell>R$ {Number(i.valor_total).toFixed(2)}</TableCell>
                    </>
                  )}
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => removeItem(i.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end gap-6 text-sm pt-3 border-t">
            {somaAreaTotal(itens) > 0 && (
              <div>
                <span className="text-muted-foreground">Soma área:</span>{" "}
                <strong>{somaAreaTotal(itens).toFixed(3).replace(".", ",")}m²</strong>
              </div>
            )}
            {canSeeFinancials && (
              <>
                <div>
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <strong>R$ {Number(orc.valor_total).toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Custo:</span> R${" "}
                  {Number(orc.custo_estimado).toFixed(2)}
                </div>
                {margem !== null && (
                  <div>
                    <span className="text-muted-foreground">Margem:</span>{" "}
                    <strong className={margem < 20 ? "text-destructive" : "text-accent"}>
                      {margem.toFixed(1)}%
                    </strong>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <PDFHistoryCard tipo="orcamento" referencia_id={id} />

      <PDFPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        tipo="orcamento"
        referencia_id={id}
      />
    </div>
  );
}
