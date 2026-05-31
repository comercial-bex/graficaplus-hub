import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Upload, Plus, Trash2, CheckCircle2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { gerarPDFOS } from "@/lib/pdf/generate";

export const Route = createFileRoute("/_authenticated/os/$id")({
  head: () => ({ meta: [{ title: "OS — BEX PRINT OS" }] }),
  component: OSDetailPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">OS não encontrada</div>,
});

const STATUS_OS = [
  "novo","aguardando_briefing","briefing_ok","em_design","aguardando_aprovacao_arte",
  "arte_aprovada","arte_rejeitada","aguardando_producao","em_producao","em_impressao",
  "em_corte","em_acabamento","em_uv","em_laser_cnc","em_3d","controle_qualidade",
  "aguardando_retirada","aguardando_entrega","em_entrega","em_instalacao",
  "concluido","faturado","cancelado","retrabalho","pausado",
];

function OSDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { canSeeFinancials, user } = useAuth();

  const { data: os, isLoading } = useQuery({
    queryKey: ["os", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("*, clientes(id, nome, telefone, email)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  async function updateStatus(novoStatus: string) {
    const { error } = await supabase.from("ordens_servico").update({ status: novoStatus as any }).eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.from("logs_auditoria").insert({
      entidade: "ordens_servico", entidade_id: id, acao: "status_change",
      detalhes: { novo: novoStatus }, usuario_id: user?.id,
    });
    toast.success("Status atualizado");
    qc.invalidateQueries({ queryKey: ["os", id] });
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  if (!os) return <div className="p-6">OS não encontrada</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/os"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <div className="text-xs text-muted-foreground">OS #{os.numero}</div>
            <h1 className="text-2xl font-bold tracking-tight">{os.titulo}</h1>
            <div className="text-sm text-muted-foreground mt-1">
              <Link to="/clientes/$id" params={{ id: os.clientes?.id }} className="hover:underline">{os.clientes?.nome}</Link>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{os.status.replace(/_/g, " ")}</Badge>
          <Select value={os.status} onValueChange={updateStatus}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OS.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          {canSeeFinancials && (
            <Button variant="outline" onClick={() => gerarPDFOS(id, true).catch((e) => toast.error(e.message))}>
              <FileDown className="h-4 w-4 mr-1" /> PDF Cliente
            </Button>
          )}
          <Button variant="outline" onClick={() => gerarPDFOS(id, false).catch((e) => toast.error(e.message))}>
            <FileDown className="h-4 w-4 mr-1" /> PDF Produção
          </Button>
        </div>
      </div>

      <Tabs defaultValue="resumo">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="itens">Itens</TabsTrigger>
          <TabsTrigger value="arquivos">Arquivos</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          {canSeeFinancials && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
        </TabsList>

        <TabsContent value="resumo"><ResumoTab os={os} /></TabsContent>
        <TabsContent value="itens"><ItensTab osId={id} canSeeFinancials={canSeeFinancials} /></TabsContent>
        <TabsContent value="arquivos"><ArquivosTab osId={id} userId={user?.id} /></TabsContent>
        <TabsContent value="tarefas"><TarefasTab osId={id} userId={user?.id} /></TabsContent>
        <TabsContent value="historico"><HistoricoTab osId={id} /></TabsContent>
        {canSeeFinancials && <TabsContent value="financeiro"><FinanceiroTab osId={id} userId={user?.id} /></TabsContent>}
      </Tabs>
    </div>
  );
}

function ResumoTab({ os }: { os: any }) {
  return (
    <Card>
      <CardContent className="p-6 grid md:grid-cols-2 gap-6">
        <div>
          <Label className="text-xs text-muted-foreground">Briefing</Label>
          <p className="mt-1 whitespace-pre-wrap text-sm">{os.briefing || <span className="text-muted-foreground">—</span>}</p>
        </div>
        <div className="space-y-3 text-sm">
          <div><span className="text-muted-foreground">Prazo:</span> {os.prazo_entrega || "—"}</div>
          <div><span className="text-muted-foreground">Prioridade:</span> {os.prioridade}</div>
          <div><span className="text-muted-foreground">Criada em:</span> {new Date(os.created_at).toLocaleString("pt-BR")}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ItensTab({ osId, canSeeFinancials }: { osId: string; canSeeFinancials: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ descricao: "", quantidade: "1", unidade: "un", valor_unitario: "0", custo_unitario: "0" });
  const { data: itens = [] } = useQuery({
    queryKey: ["itens-os", osId],
    queryFn: async () => {
      const { data } = await supabase.from("itens_os").select("*").eq("os_id", osId).order("ordem");
      return data ?? [];
    },
  });
  async function add() {
    if (!form.descricao) return toast.error("Descrição obrigatória");
    const qtd = parseFloat(form.quantidade);
    const vu = parseFloat(form.valor_unitario);
    const { error } = await supabase.from("itens_os").insert({
      os_id: osId, descricao: form.descricao, quantidade: qtd, unidade: form.unidade,
      valor_unitario: vu, custo_unitario: parseFloat(form.custo_unitario),
      valor_total: qtd * vu, ordem: itens.length,
    });
    if (error) return toast.error(error.message);
    setForm({ descricao: "", quantidade: "1", unidade: "un", valor_unitario: "0", custo_unitario: "0" });
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  async function remove(id: string) {
    await supabase.from("itens_os").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5"><Label>Descrição</Label><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div className="col-span-1"><Label>Qtd</Label><Input type="number" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /></div>
          <div className="col-span-1"><Label>Un</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /></div>
          <div className="col-span-2"><Label>Valor un.</Label><Input type="number" step="0.01" value={form.valor_unitario} onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })} /></div>
          {canSeeFinancials && <div className="col-span-2"><Label>Custo un.</Label><Input type="number" step="0.01" value={form.custo_unitario} onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })} /></div>}
          <Button className="col-span-1" onClick={add}><Plus className="h-4 w-4" /></Button>
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
                <TableCell><Button variant="ghost" size="icon" onClick={() => remove(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ArquivosTab({ osId, userId }: { osId: string; userId?: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data: arquivos = [] } = useQuery({
    queryKey: ["arquivos-os", osId],
    queryFn: async () => {
      const { data } = await supabase.from("arquivos").select("*").eq("os_id", osId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `${osId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("arquivos-clientes").upload(path, file);
      if (upErr) throw upErr;
      const versao = arquivos.filter((a: any) => a.nome === file.name).length + 1;
      const { error } = await supabase.from("arquivos").insert({
        os_id: osId, nome: file.name, caminho: path, mime_type: file.type,
        tamanho_bytes: file.size, enviado_por: userId, versao,
      });
      if (error) throw error;
      toast.success("Arquivo enviado");
      qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    } catch (err: any) { toast.error(err.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function marcarFinal(id: string) {
    await supabase.from("arquivos").update({ final_producao: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    toast.success("Marcado como final");
  }

  async function download(caminho: string) {
    const { data } = await supabase.storage.from("arquivos-clientes").createSignedUrl(caminho, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4 mr-2" /> {uploading ? "Enviando..." : "Enviar arquivo"}
          </Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Versão</TableHead><TableHead>Tamanho</TableHead><TableHead>Final</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {arquivos.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Sem arquivos</TableCell></TableRow>}
            {arquivos.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.nome}</TableCell>
                <TableCell>v{a.versao}</TableCell>
                <TableCell>{((a.tamanho_bytes ?? 0) / 1024).toFixed(1)} KB</TableCell>
                <TableCell>{a.final_producao && <Badge>Final</Badge>}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => download(a.caminho)}>Baixar</Button>
                  {!a.final_producao && <Button size="sm" variant="ghost" onClick={() => marcarFinal(a.id)}><CheckCircle2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TarefasTab({ osId, userId }: { osId: string; userId?: string }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas-os", osId],
    queryFn: async () => {
      const { data } = await supabase.from("tarefas").select("*").eq("os_id", osId).order("created_at");
      return data ?? [];
    },
  });
  async function add() {
    if (!titulo) return;
    await supabase.from("tarefas").insert({ os_id: osId, titulo, created_by: userId });
    setTitulo("");
    qc.invalidateQueries({ queryKey: ["tarefas-os", osId] });
  }
  async function toggle(t: any) {
    await supabase.from("tarefas").update({
      concluida: !t.concluida,
      concluida_em: !t.concluida ? new Date().toISOString() : null,
    }).eq("id", t.id);
    qc.invalidateQueries({ queryKey: ["tarefas-os", osId] });
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-2">
          <Input placeholder="Nova tarefa..." value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-1">
          {tarefas.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem tarefas</p>}
          {tarefas.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
              <input type="checkbox" checked={t.concluida} onChange={() => toggle(t)} />
              <span className={t.concluida ? "line-through text-muted-foreground" : ""}>{t.titulo}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricoTab({ osId }: { osId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["historico-os", osId],
    queryFn: async () => {
      const { data } = await supabase.from("logs_auditoria").select("*")
        .eq("entidade", "ordens_servico").eq("entidade_id", osId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <Card><CardContent className="p-4">
      {data.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Sem histórico</p> :
        <div className="space-y-2">{data.map((l: any) => (
          <div key={l.id} className="text-sm border-l-2 border-accent pl-3 py-1">
            <div className="font-medium">{l.acao}</div>
            <div className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")} — {JSON.stringify(l.detalhes)}</div>
          </div>
        ))}</div>}
    </CardContent></Card>
  );
}

function FinanceiroTab({ osId, userId }: { osId: string; userId?: string }) {
  const qc = useQueryClient();
  const [pag, setPag] = useState({ valor: "", data_vencimento: "", forma_pagamento: "" });
  const [custo, setCusto] = useState({ descricao: "", valor: "", categoria: "" });

  const { data: pagamentos = [] } = useQuery({
    queryKey: ["pag-os", osId],
    queryFn: async () => (await supabase.from("pagamentos").select("*").eq("os_id", osId).order("data_vencimento")).data ?? [],
  });
  const { data: custos = [] } = useQuery({
    queryKey: ["custos-os", osId],
    queryFn: async () => (await supabase.from("custos_os").select("*").eq("os_id", osId).order("data", { ascending: false })).data ?? [],
  });

  async function addPag() {
    if (!pag.valor) return toast.error("Valor obrigatório");
    const { error } = await supabase.from("pagamentos").insert({
      os_id: osId, valor: parseFloat(pag.valor),
      data_vencimento: pag.data_vencimento || null, forma_pagamento: pag.forma_pagamento || null,
      registrado_por: userId,
    });
    if (error) return toast.error(error.message);
    setPag({ valor: "", data_vencimento: "", forma_pagamento: "" });
    qc.invalidateQueries({ queryKey: ["pag-os", osId] });
  }

  async function addCusto() {
    if (!custo.descricao || !custo.valor) return toast.error("Descrição e valor obrigatórios");
    const { error } = await supabase.from("custos_os").insert({
      os_id: osId, descricao: custo.descricao, valor: parseFloat(custo.valor),
      categoria: custo.categoria || null, registrado_por: userId,
    });
    if (error) return toast.error(error.message);
    setCusto({ descricao: "", valor: "", categoria: "" });
    qc.invalidateQueries({ queryKey: ["custos-os", osId] });
  }

  async function marcarPago(id: string) {
    await supabase.from("pagamentos").update({ status: "pago", data_pagamento: new Date().toISOString().slice(0, 10) }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["pag-os", osId] });
  }

  const totalRecebido = pagamentos.filter((p: any) => p.status === "pago").reduce((s: number, p: any) => s + Number(p.valor), 0);
  const totalCustos = custos.reduce((s: number, c: any) => s + Number(c.valor), 0);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Pagamentos — Recebido R$ {totalRecebido.toFixed(2)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Input placeholder="Valor" type="number" step="0.01" value={pag.valor} onChange={(e) => setPag({ ...pag, valor: e.target.value })} />
            <Input type="date" value={pag.data_vencimento} onChange={(e) => setPag({ ...pag, data_vencimento: e.target.value })} />
            <Input placeholder="Forma" value={pag.forma_pagamento} onChange={(e) => setPag({ ...pag, forma_pagamento: e.target.value })} />
            <Button onClick={addPag}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-1">
            {pagamentos.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between text-sm border rounded p-2">
                <div>R$ {Number(p.valor).toFixed(2)} <span className="text-muted-foreground">— venc. {p.data_vencimento ?? "—"}</span></div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.status === "pago" ? "default" : "outline"}>{p.status}</Badge>
                  {p.status !== "pago" && <Button size="sm" variant="ghost" onClick={() => marcarPago(p.id)}>Marcar pago</Button>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Custos reais — Total R$ {totalCustos.toFixed(2)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Input placeholder="Descrição" value={custo.descricao} onChange={(e) => setCusto({ ...custo, descricao: e.target.value })} />
            <Input placeholder="Categoria" value={custo.categoria} onChange={(e) => setCusto({ ...custo, categoria: e.target.value })} />
            <Input placeholder="Valor" type="number" step="0.01" value={custo.valor} onChange={(e) => setCusto({ ...custo, valor: e.target.value })} />
            <Button onClick={addCusto}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-1">
            {custos.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between text-sm border rounded p-2">
                <div>{c.descricao} {c.categoria && <span className="text-muted-foreground">({c.categoria})</span>}</div>
                <div>R$ {Number(c.valor).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
