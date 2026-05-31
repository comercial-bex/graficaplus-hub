import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, Pencil, Trash2, Upload, Star, FileText, DollarSign, Package, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  head: () => ({ meta: [{ title: "Cliente — BEX PRINT OS" }] }),
  component: ClienteDetailPage,
});

function ClienteDetailPage() {
  const { id } = Route.useParams();
  const { canSeeFinancials, hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(["admin", "gestor"]);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: cliente, isLoading } = useQuery({
    queryKey: ["cliente", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("*, vendedor:usuarios!clientes_vendedor_id_fkey(id, nome)")
        .eq("id", id)
        .single();
      if (error) {
        // fallback sem FK relationship
        const r = await supabase.from("clientes").select("*").eq("id", id).single();
        if (r.error) throw r.error;
        return r.data;
      }
      return data;
    },
  });

  async function toggleAtivo() {
    if (!cliente) return;
    const { error } = await supabase.from("clientes").update({ ativo: !cliente.ativo }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(cliente.ativo ? "Cliente desativado" : "Cliente reativado");
    qc.invalidateQueries({ queryKey: ["cliente", id] });
    qc.invalidateQueries({ queryKey: ["clientes"] });
  }

  async function handleDelete() {
    const { error } = await supabase.from("clientes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cliente excluído");
    qc.invalidateQueries({ queryKey: ["clientes"] });
    navigate({ to: "/clientes" });
  }

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!cliente) return <div className="p-6">Cliente não encontrado</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3">
          <Link to="/clientes"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <Avatar className="h-16 w-16">
            <AvatarImage src={cliente.logo_url ?? undefined} />
            <AvatarFallback className="text-xl">{cliente.nome.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{cliente.tipo.toUpperCase()}</Badge>
              <Badge variant={cliente.ativo ? "default" : "outline"}>{cliente.ativo ? "Ativo" : "Inativo"}</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{cliente.nome}</h1>
            <p className="text-sm text-muted-foreground">
              {[cliente.documento, cliente.email, cliente.telefone].filter(Boolean).join(" · ") || "Sem dados de contato"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={cliente.ativo} onCheckedChange={toggleAtivo} />
            <span className="text-muted-foreground">{cliente.ativo ? "Ativo" : "Inativo"}</span>
          </div>
          <EditClienteDialog cliente={cliente} />
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação não pode ser desfeita. OS, orçamentos e pagamentos vinculados podem ser afetados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <StatsCard clienteId={id} canSeeFinancials={canSeeFinancials} />

      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Dados</TabsTrigger>
          <TabsTrigger value="contatos">Responsáveis</TabsTrigger>
          <TabsTrigger value="os">OS</TabsTrigger>
          <TabsTrigger value="orcamentos">Orçamentos</TabsTrigger>
          {canSeeFinancials && <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>}
        </TabsList>
        <TabsContent value="resumo"><DadosTab cliente={cliente} /></TabsContent>
        <TabsContent value="contatos"><ContatosTab clienteId={id} /></TabsContent>
        <TabsContent value="os"><OSTab clienteId={id} /></TabsContent>
        <TabsContent value="orcamentos"><OrcamentosTab clienteId={id} /></TabsContent>
        {canSeeFinancials && <TabsContent value="pagamentos"><PagamentosTab clienteId={id} /></TabsContent>}
      </Tabs>
    </div>
  );
}

function StatsCard({ clienteId, canSeeFinancials }: { clienteId: string; canSeeFinancials: boolean }) {
  const { data } = useQuery({
    queryKey: ["cliente-stats", clienteId],
    queryFn: async () => {
      const [os, orc, pag] = await Promise.all([
        supabase.from("ordens_servico").select("id, valor_total, status, created_at").eq("cliente_id", clienteId),
        supabase.from("orcamentos").select("id, status").eq("cliente_id", clienteId),
        supabase.from("pagamentos").select("valor, status, ordens_servico!inner(cliente_id)").eq("ordens_servico.cliente_id", clienteId),
      ]);
      const osData = os.data ?? [];
      const orcData = orc.data ?? [];
      const pagData = pag.data ?? [];
      const faturamento = pagData.filter((p: any) => p.status === "pago").reduce((s: number, p: any) => s + Number(p.valor || 0), 0);
      const totalOS = osData.length;
      const ticket = totalOS > 0 ? osData.reduce((s: number, o: any) => s + Number(o.valor_total || 0), 0) / totalOS : 0;
      const ultimaOS = osData.sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0]?.created_at;
      return { totalOS, totalOrc: orcData.length, faturamento, ticket, ultimaOS };
    },
  });
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatTile icon={<Package className="h-4 w-4" />} label="Total de OS" value={String(data.totalOS)} />
      <StatTile icon={<FileText className="h-4 w-4" />} label="Orçamentos" value={String(data.totalOrc)} />
      {canSeeFinancials && <StatTile icon={<DollarSign className="h-4 w-4" />} label="Faturamento" value={`R$ ${data.faturamento.toFixed(2)}`} />}
      {canSeeFinancials && <StatTile icon={<DollarSign className="h-4 w-4" />} label="Ticket médio" value={`R$ ${data.ticket.toFixed(2)}`} />}
      {!canSeeFinancials && <StatTile icon={<Calendar className="h-4 w-4" />} label="Última OS" value={data.ultimaOS ? new Date(data.ultimaOS).toLocaleDateString("pt-BR") : "—"} />}
      {!canSeeFinancials && <StatTile icon={<Calendar className="h-4 w-4" />} label="" value="" />}
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  if (!label) return <div />;
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </CardContent></Card>
  );
}

function EditClienteDialog({ cliente }: { cliente: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(cliente);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { setForm(cliente); }, [cliente]);

  const { data: vendedores = [] } = useQuery({
    queryKey: ["vendedores"],
    queryFn: async () => (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
  });

  async function handleLogoUpload(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast.error("Máx 2MB");
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `clientes/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("avatares").upload(path, file);
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("avatares").getPublicUrl(path);
    setForm({ ...form, logo_url: data.publicUrl });
    setUploading(false);
  }

  async function save() {
    if (!form.nome?.trim()) return toast.error("Nome é obrigatório");
    const { vendedor, ...rest } = form;
    const payload = { ...rest, vendedor_id: rest.vendedor_id || null };
    const { error } = await supabase.from("clientes").update(payload).eq("id", cliente.id);
    if (error) return toast.error(error.message);
    toast.success("Salvo");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["cliente", cliente.id] });
    qc.invalidateQueries({ queryKey: ["clientes"] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pencil className="h-4 w-4 mr-2" /> Editar</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar cliente</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={form.logo_url ?? undefined} />
              <AvatarFallback>{form.nome?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            <Label htmlFor="logo-edit" className="cursor-pointer">
              <div className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-accent">
                <Upload className="h-4 w-4" /> {uploading ? "Enviando..." : "Trocar logo"}
              </div>
              <input id="logo-edit" type="file" accept="image/*" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
            </Label>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pj">PJ</SelectItem>
                  <SelectItem value="pf">PF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Vendedor</Label>
              <Select value={form.vendedor_id || "none"} onValueChange={(v) => setForm({ ...form, vendedor_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem responsável</SelectItem>
                  {vendedores.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2"><Label>Nome *</Label><Input maxLength={200} value={form.nome || ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Razão social</Label><Input maxLength={200} value={form.razao_social || ""} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} /></div>
            <div className="space-y-2"><Label>Documento</Label><Input maxLength={20} value={form.documento || ""} onChange={(e) => setForm({ ...form, documento: e.target.value })} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input maxLength={20} value={form.telefone || ""} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>E-mail</Label><Input type="email" maxLength={150} value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Endereço</Label><Input maxLength={250} value={form.endereco || ""} onChange={(e) => setForm({ ...form, endereco: e.target.value })} /></div>
            <div className="space-y-2"><Label>Cidade</Label><Input maxLength={100} value={form.cidade || ""} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2"><Label>UF</Label><Input maxLength={2} value={form.estado || ""} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} /></div>
              <div className="space-y-2"><Label>CEP</Label><Input maxLength={10} value={form.cep || ""} onChange={(e) => setForm({ ...form, cep: e.target.value })} /></div>
            </div>
            <div className="space-y-2 md:col-span-2"><Label>Observações</Label><Textarea rows={3} maxLength={1000} value={form.observacoes || ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DadosTab({ cliente }: { cliente: any }) {
  return (
    <Card><CardContent className="p-6 grid md:grid-cols-2 gap-4 text-sm">
      <div><Label className="text-xs text-muted-foreground">Razão social</Label><div>{cliente.razao_social || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Vendedor responsável</Label><div>{cliente.vendedor?.nome || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Endereço</Label><div>{cliente.endereco || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Cidade/UF</Label><div>{cliente.cidade || "—"} / {cliente.estado || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">CEP</Label><div>{cliente.cep || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Cadastrado em</Label><div>{new Date(cliente.created_at).toLocaleDateString("pt-BR")}</div></div>
      <div className="md:col-span-2"><Label className="text-xs text-muted-foreground">Observações</Label><div className="whitespace-pre-wrap">{cliente.observacoes || "—"}</div></div>
    </CardContent></Card>
  );
}

function ContatosTab({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", cargo: "" });
  const { data = [] } = useQuery({
    queryKey: ["contatos", clienteId],
    queryFn: async () => (await supabase.from("cliente_contatos").select("*").eq("cliente_id", clienteId).order("principal", { ascending: false })).data ?? [],
  });

  async function add() {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    const { error } = await supabase.from("cliente_contatos").insert({ ...form, cliente_id: clienteId });
    if (error) return toast.error(error.message);
    setForm({ nome: "", telefone: "", email: "", cargo: "" });
    qc.invalidateQueries({ queryKey: ["contatos", clienteId] });
  }

  async function togglePrincipal(c: any) {
    if (!c.principal) {
      await supabase.from("cliente_contatos").update({ principal: false }).eq("cliente_id", clienteId);
    }
    await supabase.from("cliente_contatos").update({ principal: !c.principal }).eq("id", c.id);
    qc.invalidateQueries({ queryKey: ["contatos", clienteId] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("cliente_contatos").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["contatos", clienteId] });
  }

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="grid grid-cols-5 gap-2">
        <Input placeholder="Nome" maxLength={100} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <Input placeholder="Cargo" maxLength={50} value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <Input placeholder="Telefone" maxLength={20} value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        <Input placeholder="E-mail" type="email" maxLength={150} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Button onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>Telefone</TableHead><TableHead>E-mail</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem contatos</TableCell></TableRow>}
          {data.map((c: any) => (
            <TableRow key={c.id}>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePrincipal(c)} title="Marcar como principal">
                  <Star className={`h-4 w-4 ${c.principal ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </Button>
              </TableCell>
              <TableCell className="font-medium">{c.nome}</TableCell>
              <TableCell>{c.cargo || "—"}</TableCell>
              <TableCell>{c.telefone || "—"}</TableCell>
              <TableCell>{c.email || "—"}</TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(c.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function OSTab({ clienteId }: { clienteId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["os-cliente", clienteId],
    queryFn: async () => (await supabase.from("ordens_servico").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false })).data ?? [],
  });
  return (
    <Card><CardContent className="p-4">
      <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Título</TableHead><TableHead>Status</TableHead><TableHead>Prazo</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem OS</TableCell></TableRow>}
          {data.map((o: any) => <TableRow key={o.id}><TableCell><Link to="/os/$id" params={{ id: o.id }} className="text-accent hover:underline">#{o.numero}</Link></TableCell><TableCell>{o.titulo}</TableCell><TableCell><Badge variant="outline">{o.status.replace(/_/g, " ")}</Badge></TableCell><TableCell>{o.prazo_entrega ?? "—"}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function OrcamentosTab({ clienteId }: { clienteId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["orc-cliente", clienteId],
    queryFn: async () => (await supabase.from("orcamentos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false })).data ?? [],
  });
  return (
    <Card><CardContent className="p-4">
      <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Título</TableHead><TableHead>Status</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem orçamentos</TableCell></TableRow>}
          {data.map((o: any) => <TableRow key={o.id}><TableCell><Link to="/orcamentos/$id" params={{ id: o.id }} className="text-accent hover:underline">#{o.numero}</Link></TableCell><TableCell>{o.titulo}</TableCell><TableCell><Badge variant="outline">{o.status}</Badge></TableCell><TableCell>R$ {Number(o.valor_total).toFixed(2)}</TableCell></TableRow>)}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function PagamentosTab({ clienteId }: { clienteId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["pag-cliente", clienteId],
    queryFn: async () => (await supabase.from("pagamentos").select("*, ordens_servico!inner(numero, titulo, cliente_id)").eq("ordens_servico.cliente_id", clienteId)).data ?? [],
  });
  return (
    <Card><CardContent className="p-4">
      <Table><TableHeader><TableRow><TableHead>OS</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem pagamentos</TableCell></TableRow>}
          {data.map((p: any) => <TableRow key={p.id}><TableCell>#{p.ordens_servico?.numero}</TableCell><TableCell>R$ {Number(p.valor).toFixed(2)}</TableCell><TableCell>{p.data_vencimento ?? "—"}</TableCell><TableCell><Badge variant={p.status === "pago" ? "default" : "outline"}>{p.status}</Badge></TableCell></TableRow>)}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
