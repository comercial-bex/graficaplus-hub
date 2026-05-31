import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/clientes/$id")({
  head: () => ({ meta: [{ title: "Cliente — BEX PRINT OS" }] }),
  component: ClienteDetailPage,
});

function ClienteDetailPage() {
  const { id } = Route.useParams();
  const { canSeeFinancials } = useAuth();
  const { data: cliente, isLoading } = useQuery({
    queryKey: ["cliente", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clientes").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!cliente) return <div className="p-6">Cliente não encontrado</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/clientes"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <Badge variant="secondary">{cliente.tipo.toUpperCase()}</Badge>
          <h1 className="text-2xl font-bold tracking-tight">{cliente.nome}</h1>
          <p className="text-sm text-muted-foreground">{cliente.documento} · {cliente.email} · {cliente.telefone}</p>
        </div>
      </div>

      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Dados</TabsTrigger>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
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

function DadosTab({ cliente }: { cliente: any }) {
  return (
    <Card><CardContent className="p-6 grid md:grid-cols-2 gap-4 text-sm">
      <div><Label className="text-xs text-muted-foreground">Razão social</Label><div>{cliente.razao_social || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Endereço</Label><div>{cliente.endereco || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">Cidade/UF</Label><div>{cliente.cidade || "—"} / {cliente.estado || "—"}</div></div>
      <div><Label className="text-xs text-muted-foreground">CEP</Label><div>{cliente.cep || "—"}</div></div>
      <div className="md:col-span-2"><Label className="text-xs text-muted-foreground">Observações</Label><div className="whitespace-pre-wrap">{cliente.observacoes || "—"}</div></div>
    </CardContent></Card>
  );
}

function ContatosTab({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ nome: "", telefone: "", email: "", cargo: "" });
  const { data = [] } = useQuery({
    queryKey: ["contatos", clienteId],
    queryFn: async () => (await supabase.from("cliente_contatos").select("*").eq("cliente_id", clienteId)).data ?? [],
  });
  async function add() {
    if (!form.nome) return toast.error("Nome obrigatório");
    const { error } = await supabase.from("cliente_contatos").insert({ ...form, cliente_id: clienteId });
    if (error) return toast.error(error.message);
    setForm({ nome: "", telefone: "", email: "", cargo: "" });
    qc.invalidateQueries({ queryKey: ["contatos", clienteId] });
  }
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="grid grid-cols-5 gap-2">
        <Input placeholder="Nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <Input placeholder="Cargo" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <Input placeholder="Telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        <Input placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Button onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Cargo</TableHead><TableHead>Telefone</TableHead><TableHead>E-mail</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem contatos</TableCell></TableRow>}
          {data.map((c: any) => <TableRow key={c.id}><TableCell>{c.nome}</TableCell><TableCell>{c.cargo}</TableCell><TableCell>{c.telefone}</TableCell><TableCell>{c.email}</TableCell></TableRow>)}
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
