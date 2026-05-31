import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Upload, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes — BEX PRINT OS" }] }),
  component: ClientesPage,
});

type FormState = {
  tipo: "pf" | "pj";
  nome: string;
  razao_social: string;
  documento: string;
  email: string;
  telefone: string;
  endereco: string;
  cidade: string;
  estado: string;
  cep: string;
  vendedor_id: string;
  observacoes: string;
  logo_url: string;
};

const emptyForm: FormState = {
  tipo: "pj", nome: "", razao_social: "", documento: "", email: "", telefone: "",
  endereco: "", cidade: "", estado: "", cep: "", vendedor_id: "", observacoes: "", logo_url: "",
};

function ClientesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "pf" | "pj">("todos");
  const [filtroAtivo, setFiltroAtivo] = useState<"todos" | "ativos" | "inativos">("ativos");
  const [filtroVendedor, setFiltroVendedor] = useState<string>("todos");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploading, setUploading] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ["vendedores"],
    queryFn: async () => (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
  });

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes", filtroTipo, filtroAtivo, filtroVendedor],
    queryFn: async () => {
      let q = supabase.from("clientes").select("*").order("created_at", { ascending: false });
      if (filtroTipo !== "todos") q = q.eq("tipo", filtroTipo);
      if (filtroAtivo === "ativos") q = q.eq("ativo", true);
      if (filtroAtivo === "inativos") q = q.eq("ativo", false);
      if (filtroVendedor !== "todos") q = q.eq("vendedor_id", filtroVendedor);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    if (!search) return clientes;
    const s = search.toLowerCase();
    return clientes.filter((c: any) =>
      c.nome?.toLowerCase().includes(s) ||
      c.documento?.toLowerCase().includes(s) ||
      c.email?.toLowerCase().includes(s) ||
      c.telefone?.includes(s)
    );
  }, [clientes, search]);

  async function handleLogoUpload(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast.error("Máx 2MB");
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `clientes/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("avatares").upload(path, file, { upsert: false });
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("avatares").getPublicUrl(path);
    setForm({ ...form, logo_url: data.publicUrl });
    setUploading(false);
    toast.success("Logo enviada");
  }

  async function handleCreate() {
    if (!form.nome.trim()) return toast.error("Nome é obrigatório");
    const payload: any = { ...form };
    if (!payload.vendedor_id) delete payload.vendedor_id;
    const { error } = await supabase.from("clientes").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Cliente cadastrado");
    setOpen(false);
    setForm(emptyForm);
    qc.invalidateQueries({ queryKey: ["clientes"] });
  }

  const stats = useMemo(() => ({
    total: clientes.length,
    pj: clientes.filter((c: any) => c.tipo === "pj").length,
    pf: clientes.filter((c: any) => c.tipo === "pf").length,
  }), [clientes]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground">{stats.total} cliente(s) · {stats.pj} PJ · {stats.pf} PF</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo cliente</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={form.logo_url} />
                  <AvatarFallback>{form.nome.charAt(0).toUpperCase() || "?"}</AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Label htmlFor="logo-upload" className="cursor-pointer">
                    <div className="inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md hover:bg-accent">
                      <Upload className="h-4 w-4" /> {uploading ? "Enviando..." : "Enviar logo"}
                    </div>
                    <input id="logo-upload" type="file" accept="image/*" className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])} />
                  </Label>
                  <p className="text-xs text-muted-foreground">PNG/JPG, máx 2MB</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={form.tipo} onValueChange={(v: "pf" | "pj") => setForm({ ...form, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pj">Pessoa Jurídica</SelectItem>
                      <SelectItem value="pf">Pessoa Física</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Vendedor responsável</Label>
                  <Select value={form.vendedor_id || "none"} onValueChange={(v) => setForm({ ...form, vendedor_id: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem responsável</SelectItem>
                      {vendedores.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Nome fantasia *</Label>
                  <Input maxLength={200} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                </div>
                {form.tipo === "pj" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Razão social</Label>
                    <Input maxLength={200} value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{form.tipo === "pj" ? "CNPJ" : "CPF"}</Label>
                  <Input maxLength={20} value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input maxLength={20} value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>E-mail</Label>
                  <Input type="email" maxLength={150} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Endereço</Label>
                  <Input maxLength={250} value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input maxLength={100} value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>UF</Label>
                    <Input maxLength={2} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="space-y-2">
                    <Label>CEP</Label>
                    <Input maxLength={10} value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Observações</Label>
                  <Textarea rows={3} maxLength={1000} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Cadastrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar nome, CNPJ, e-mail, telefone..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filtroTipo} onValueChange={(v: any) => setFiltroTipo(v)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="pj">PJ</SelectItem>
                <SelectItem value="pf">PF</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroAtivo} onValueChange={(v: any) => setFiltroAtivo(v)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos vendedores</SelectItem>
                {vendedores.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhum cliente</TableCell></TableRow>}
              {filtered.map((c: any) => (
                <TableRow key={c.id} className="hover:bg-muted/50">
                  <TableCell>
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={c.logo_url} />
                      <AvatarFallback>{c.nome.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link to="/clientes/$id" params={{ id: c.id }} className="text-accent hover:underline">{c.nome}</Link>
                    {c.razao_social && <div className="text-xs text-muted-foreground">{c.razao_social}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{c.tipo.toUpperCase()}</Badge></TableCell>
                  <TableCell>{c.documento || "—"}</TableCell>
                  <TableCell>
                    <div className="text-sm">{c.email || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.telefone || "—"}</div>
                  </TableCell>
                  <TableCell>{c.cidade ? `${c.cidade}/${c.estado || ""}` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.ativo ? "default" : "outline"}>{c.ativo ? "Ativo" : "Inativo"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
