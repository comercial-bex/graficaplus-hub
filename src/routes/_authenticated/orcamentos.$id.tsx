import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, ArrowRight, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";
import { PDFHistoryCard } from "@/lib/pdf/PDFHistoryCard";

export const Route = createFileRoute("/_authenticated/orcamentos/$id")({
  head: () => ({ meta: [{ title: "Orçamento — BEX PRINT OS" }] }),
  component: OrcamentoDetailPage,
});

function OrcamentoDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [form, setForm] = useState({ descricao: "", quantidade: "1", unidade: "un", valor_unitario: "0", custo_unitario: "0" });
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: orc, isLoading } = useQuery({
    queryKey: ["orcamento", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("orcamentos").select("*, clientes(id, nome)").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["orc-itens", id],
    queryFn: async () => (await supabase.from("orcamento_itens").select("*").eq("orcamento_id", id).order("ordem")).data ?? [],
  });

  async function recalcular() {
    const subtotal = itens.reduce((s: number, i: any) => s + Number(i.valor_total), 0);
    const custo = itens.reduce((s: number, i: any) => s + Number(i.custo_unitario) * Number(i.quantidade), 0);
    await supabase.from("orcamentos").update({
      valor_subtotal: subtotal, valor_total: subtotal, custo_estimado: custo,
    }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  async function addItem() {
    if (!form.descricao) return toast.error("Descrição obrigatória");
    const qtd = parseFloat(form.quantidade);
    const vu = parseFloat(form.valor_unitario);
    const { error } = await supabase.from("orcamento_itens").insert({
      orcamento_id: id, descricao: form.descricao, quantidade: qtd, unidade: form.unidade,
      valor_unitario: vu, custo_unitario: parseFloat(form.custo_unitario),
      valor_total: qtd * vu, ordem: itens.length,
    });
    if (error) return toast.error(error.message);
    setForm({ descricao: "", quantidade: "1", unidade: "un", valor_unitario: "0", custo_unitario: "0" });
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    setTimeout(recalcular, 100);
  }

  async function removeItem(itemId: string) {
    await supabase.from("orcamento_itens").delete().eq("id", itemId);
    await qc.invalidateQueries({ queryKey: ["orc-itens", id] });
    setTimeout(recalcular, 100);
  }

  async function setStatus(novoStatus: string) {
    const update: any = { status: novoStatus };
    if (novoStatus === "enviado") update.enviado_em = new Date().toISOString();
    if (novoStatus === "aprovado") update.aprovado_em = new Date().toISOString();
    const { error } = await supabase.from("orcamentos").update(update).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Status atualizado");
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  async function converterEmOS() {
    if (!orc) return;
    const { data: os, error } = await supabase.from("ordens_servico").insert({
      cliente_id: orc.cliente_id, orcamento_id: orc.id, titulo: orc.titulo,
      valor_total: orc.valor_total, custo_previsto: orc.custo_estimado, status: "novo",
    }).select().single();
    if (error) return toast.error(error.message);
    await supabase.from("orcamentos").update({ status: "convertido", os_id: os.id }).eq("id", id);
    toast.success(`OS #${os.numero} criada`);
    qc.invalidateQueries({ queryKey: ["orcamento", id] });
  }

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!orc) return <div className="p-6">Orçamento não encontrado</div>;

  const margem = canSeeFinancials && Number(orc.valor_total) > 0
    ? ((Number(orc.valor_total) - Number(orc.custo_estimado)) / Number(orc.valor_total)) * 100
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/orcamentos"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <div className="text-xs text-muted-foreground">Orçamento #{orc.numero}</div>
            <h1 className="text-2xl font-bold tracking-tight">{orc.titulo}</h1>
            <Link to="/clientes/$id" params={{ id: orc.clientes?.id }} className="text-sm text-muted-foreground hover:underline">{orc.clientes?.nome}</Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{orc.status}</Badge>
          <Select value={orc.status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["rascunho","enviado","aprovado","rejeitado","expirado"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => gerarPDFOrcamento(id).catch((e) => toast.error(e.message))}>
            <FileDown className="h-4 w-4 mr-1" /> PDF
          </Button>
          {orc.status !== "convertido" && !orc.os_id && (
            <Button onClick={converterEmOS}>Converter em OS <ArrowRight className="h-4 w-4 ml-1" /></Button>
          )}
        </div>
      </div>

      <Card><CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5"><Label>Descrição</Label><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div className="col-span-1"><Label>Qtd</Label><Input type="number" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /></div>
          <div className="col-span-1"><Label>Un</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></div>
          <div className="col-span-2"><Label>Valor un.</Label><Input type="number" step="0.01" value={form.valor_unitario} onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })} /></div>
          {canSeeFinancials && <div className="col-span-2"><Label>Custo un.</Label><Input type="number" step="0.01" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })} /></div>}
          <Button className="col-span-1" onClick={addItem}><Plus className="h-4 w-4" /></Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Qtd</TableHead><TableHead>Valor un.</TableHead><TableHead>Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {itens.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem itens</TableCell></TableRow>}
            {itens.map((i: any) => (
              <TableRow key={i.id}>
                <TableCell>{i.descricao}</TableCell>
                <TableCell>{i.quantidade} {i.unidade}</TableCell>
                <TableCell>R$ {Number(i.valor_unitario).toFixed(2)}</TableCell>
                <TableCell>R$ {Number(i.valor_total).toFixed(2)}</TableCell>
                <TableCell><Button variant="ghost" size="icon" onClick={() => removeItem(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end gap-6 text-sm pt-3 border-t">
          <div><span className="text-muted-foreground">Total:</span> <strong>R$ {Number(orc.valor_total).toFixed(2)}</strong></div>
          {canSeeFinancials && <>
            <div><span className="text-muted-foreground">Custo:</span> R$ {Number(orc.custo_estimado).toFixed(2)}</div>
            {margem !== null && <div><span className="text-muted-foreground">Margem:</span> <strong className={margem < 20 ? "text-destructive" : "text-accent"}>{margem.toFixed(1)}%</strong></div>}
          </>}
        </div>
      </CardContent></Card>
    </div>
  );
}
