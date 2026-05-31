import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye, FileArchive, FileText, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/arquivos")({
  head: () => ({ meta: [{ title: "Arquivos — BEX PRINT OS" }] }),
  component: ArquivosPage,
});

const TIPOS = ["arte", "briefing", "referencia", "producao", "orcamento", "comprovante", "outro"];
const STATUS = ["ativo", "substituido", "inativo", "aprovado", "rejeitado"];

function ArquivosPage() {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [preview, setPreview] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: arquivos = [], isLoading } = useQuery({
    queryKey: ["arquivos", busca, tipo, status],
    queryFn: async () => {
      let query = supabase
        .from("arquivos")
        .select("*, ordens_servico(id, numero, titulo), clientes(id, nome), usuarios(nome), aprovacoes(id, aprovado, canal, created_at, observacao, usuarios(nome), cliente_contatos(nome))")
        .order("created_at", { ascending: false })
        .limit(200);

      if (tipo !== "todos") query = query.eq("tipo", tipo as any);
      if (status !== "todos") query = query.eq("status", status as any);
      if (busca.trim()) query = query.or(`nome.ilike.%${busca.trim()}%,observacao.ilike.%${busca.trim()}%`);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const agrupados = useMemo(() => {
    return arquivos.reduce((acc: Record<string, any[]>, arquivo: any) => {
      const key = `${arquivo.os_id ?? arquivo.cliente_id ?? "sem-vinculo"}:${arquivo.nome}`;
      acc[key] = [...(acc[key] ?? []), arquivo];
      return acc;
    }, {});
  }, [arquivos]);

  async function abrirPreview(arquivo: any) {
    setPreview(arquivo);
    setPreviewUrl(null);
    const url = arquivo.url;
    if (url) {
      setPreviewUrl(url);
      return;
    }
    const { data, error } = await supabase.storage.from("arquivos-clientes").createSignedUrl(arquivo.caminho, 300);
    if (error) return toast.error(error.message);
    setPreviewUrl(data.signedUrl);
  }

  const ativos = arquivos.filter((arquivo: any) => arquivo.ativo && !["substituido", "inativo"].includes(arquivo.status)).length;
  const substituidos = arquivos.filter((arquivo: any) => arquivo.status === "substituido").length;
  const aprovados = arquivos.filter((arquivo: any) => arquivo.status === "aprovado").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
        <p className="text-muted-foreground">Busca, filtros, preview e histórico de versões sem apagar arquivos antigos.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-6"><Metric icon={<FileText className="h-8 w-8 text-primary" />} label="Arquivos ativos" value={ativos} /></CardContent></Card>
        <Card><CardContent className="pt-6"><Metric icon={<FileArchive className="h-8 w-8 text-muted-foreground" />} label="Versões substituídas" value={substituidos} /></CardContent></Card>
        <Card><CardContent className="pt-6"><Metric icon={<Eye className="h-8 w-8 text-green-600" />} label="Artes aprovadas" value={aprovados} /></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Buscar</Label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Nome ou observação" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {TIPOS.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {STATUS.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-muted-foreground">Carregando...</div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Vínculo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead>Aprovação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {arquivos.length === 0 && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Nenhum arquivo encontrado</TableCell></TableRow>}
                {arquivos.map((arquivo: any) => {
                  const historico = agrupados[`${arquivo.os_id ?? arquivo.cliente_id ?? "sem-vinculo"}:${arquivo.nome}`] ?? [];
                  const ultimaAprovacao = arquivo.aprovacoes?.[0];
                  return (
                    <TableRow key={arquivo.id}>
                      <TableCell>
                        <div className="font-medium">{arquivo.nome}</div>
                        <div className="text-xs text-muted-foreground">v{arquivo.versao} · {formatBytes(arquivo.tamanho_bytes)} · {new Date(arquivo.created_at).toLocaleString("pt-BR")}</div>
                      </TableCell>
                      <TableCell>
                        {arquivo.ordens_servico ? <Link to="/os/$id" params={{ id: arquivo.ordens_servico.id }} className="hover:underline">OS #{arquivo.ordens_servico.numero}</Link> : arquivo.clientes?.nome ?? "—"}
                        <div className="text-xs text-muted-foreground">{arquivo.ordens_servico?.titulo}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{label(arquivo.tipo ?? "outro")}</Badge></TableCell>
                      <TableCell><StatusBadge status={arquivo.status} ativo={arquivo.ativo} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{historico.length} versão(ões)</TableCell>
                      <TableCell className="text-xs">
                        {ultimaAprovacao ? `${ultimaAprovacao.aprovado ? "Aprovado" : "Rejeitado"} via ${label(ultimaAprovacao.canal)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => abrirPreview(arquivo)}>Preview</Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{preview?.nome}</DialogTitle></DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="min-h-[420px] rounded border bg-muted/30 p-2">
              {previewUrl && preview?.mime_type?.startsWith("image/") && <img src={previewUrl} alt={preview.nome} className="mx-auto max-h-[70vh] rounded object-contain" />}
              {previewUrl && preview?.mime_type === "application/pdf" && <iframe title={preview.nome} src={previewUrl} className="h-[70vh] w-full rounded" />}
              {previewUrl && !preview?.mime_type?.startsWith("image/") && preview?.mime_type !== "application/pdf" && (
                <div className="flex h-[420px] items-center justify-center"><Button asChild><a href={previewUrl} target="_blank" rel="noreferrer">Abrir arquivo</a></Button></div>
              )}
            </div>
            <div className="space-y-4 text-sm">
              <div><Label>Status</Label><div className="mt-1"><StatusBadge status={preview?.status} ativo={preview?.ativo} /></div></div>
              <div><Label>Observação</Label><p className="mt-1 text-muted-foreground">{preview?.observacao || "—"}</p></div>
              <div><Label>Histórico desta linha</Label><HistoryList itens={agrupados[`${preview?.os_id ?? preview?.cliente_id ?? "sem-vinculo"}:${preview?.nome}`] ?? []} /></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <div className="flex items-center gap-3">{icon}<div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></div>;
}

function HistoryList({ itens }: { itens: any[] }) {
  return <div className="mt-2 space-y-2">{itens.map((item) => <div key={item.id} className="rounded border p-2"><div className="flex items-center justify-between"><span>v{item.versao}</span><StatusBadge status={item.status} ativo={item.ativo} /></div><div className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("pt-BR")}</div></div>)}</div>;
}

function StatusBadge({ status, ativo }: { status?: string; ativo?: boolean }) {
  const variant = status === "aprovado" ? "default" : status === "rejeitado" ? "destructive" : "outline";
  return <Badge variant={variant}>{ativo === false ? "Inativo" : label(status ?? "ativo")}</Badge>;
}

function label(value: string) {
  return value.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function formatBytes(value?: number | null) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
