/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ClipboardList, FileText, DollarSign, Truck, Download, Upload, MessageSquare } from "lucide-react";


export const Route = createFileRoute("/_authenticated/portal-cliente")({
  head: () => ({ meta: [{ title: "Portal do Cliente — BEX PRINT OS" }] }),
  component: PortalClientePage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Portal não encontrado</div>,
});

function PortalClientePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [osSelecionada, setOsSelecionada] = useState<string | null>(null);
  const [solicitacaoTipo, setSolicitacaoTipo] = useState("duvida");
  const [solicitacaoMsg, setSolicitacaoMsg] = useState("");

  const { data: acessos = [], isLoading } = useQuery({

    queryKey: ["portal-acessos", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("portal_cliente_acessos")
        .select("cliente_id, ativo, clientes(nome, logo_url)")
        .eq("usuario_id", user!.id)
        .eq("ativo", true);
      return data ?? [];
    },
  });

  const clienteIds = acessos.map((a: any) => a.cliente_id);
  const clienteNome = acessos[0]?.clientes?.nome as string | undefined;

  const { data: ordens = [] } = useQuery({
    queryKey: ["portal-os", clienteIds],
    enabled: clienteIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ordens_servico_financeiro")
        .select("id, numero, titulo, status, prazo_entrega, valor_total, created_at")
        .in("cliente_id", clienteIds)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: documentos = [] } = useQuery({
    queryKey: ["portal-documentos", osSelecionada],
    enabled: !!osSelecionada,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("documentos_gerados")
        .select("*")
        .eq("tipo", "os")
        .eq("referencia_id", osSelecionada)
        .eq("variante", "cliente")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: solicitacoes = [] } = useQuery({
    queryKey: ["portal-solicitacoes", clienteIds, osSelecionada],
    enabled: clienteIds.length > 0,
    queryFn: async () => {
      let q = (supabase as any)
        .from("portal_cliente_solicitacoes")
        .select("*")
        .in("cliente_id", clienteIds)
        .order("created_at", { ascending: false })
        .limit(20);
      if (osSelecionada) q = q.eq("os_id", osSelecionada);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: snapshot } = useQuery({
    queryKey: ["portal-snapshot", osSelecionada],
    enabled: !!osSelecionada,
    queryFn: async () =>
      (
        await (supabase as any)
          .from("os_resultado_snapshots")
          .select("*")
          .eq("os_id", osSelecionada)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  async function baixarDocumento(d: any) {
    // Signed URL from the documentos-pdf bucket (private)
    const { data, error } = await (supabase as any).storage
      .from("documentos-pdf")
      .createSignedUrl(d.caminho, 60);
    if (error || !data?.signedUrl) {
      return toast.error("Não foi possível gerar link de download");
    }
    window.open(data.signedUrl, "_blank");
  }

  async function enviarSolicitacao() {
    if (!clienteIds[0] || !solicitacaoMsg.trim()) {
      return toast.error("Descreva sua solicitação");
    }
    const { error } = await (supabase as any).from("portal_cliente_solicitacoes").insert({
      cliente_id: clienteIds[0],
      os_id: osSelecionada,
      tipo: solicitacaoTipo,
      mensagem: solicitacaoMsg,
      status: "aberta",
    });
    if (error) return toast.error(error.message);
    toast.success("Solicitação enviada à equipe BEX");
    setSolicitacaoMsg("");
    qc.invalidateQueries({ queryKey: ["portal-solicitacoes"] });
  }


  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Carregando portal...</div>;
  }

  if (acessos.length === 0) {
    return (
      <div className="space-y-6">
        <SectionHeader
          breadcrumb="Área do Cliente"
          title="Portal do Cliente"
          description="Acompanhe suas OS, pagamentos e documentos"
        />
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">
              Seu usuário ainda não foi vinculado a um cliente no portal.
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              Solicite à equipe BEX que cadastre seu acesso em <code>portal_cliente_acessos</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totais = {
    total: ordens.length,
    emAndamento: ordens.filter(
      (o: any) => !["concluido", "faturado", "cancelado"].includes(o.status),
    ).length,
    concluidas: ordens.filter((o: any) => o.status === "concluido" || o.status === "faturado")
      .length,
    valorTotal: ordens.reduce((s: number, o: any) => s + Number(o.valor_total ?? 0), 0),
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb={`Portal · ${clienteNome ?? "Cliente"}`}
        title="Seu acompanhamento BEX PRINT"
        description="OS em produção, entregas e documentos disponíveis para download"
        actions={<StatusChip label="Acesso ativo" tone="lime" />}
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total de OS" value={totais.total} icon={ClipboardList} tone="cyan" />
        <KpiCard label="Em andamento" value={totais.emAndamento} icon={Truck} tone="lime" />
        <KpiCard label="Concluídas" value={totais.concluidas} icon={FileText} tone="cyan" />
        <KpiCard
          label="Valor contratado"
          value={`R$ ${totais.valorTotal.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`}
          icon={DollarSign}
          tone="lime"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suas ordens de serviço</CardTitle>
        </CardHeader>
        <CardContent>
          {ordens.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma OS registrada.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordens.map((o: any) => (
                  <TableRow
                    key={o.id}
                    className={osSelecionada === o.id ? "bg-muted/50" : ""}
                  >
                    <TableCell className="font-mono text-xs">#{o.numero}</TableCell>
                    <TableCell>{o.titulo}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={String(o.status).replace(/_/g, " ")}
                        tone={
                          o.status === "concluido" || o.status === "faturado"
                            ? "lime"
                            : o.status === "cancelado"
                              ? "magenta"
                              : "cyan"
                        }
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      {o.prazo_entrega
                        ? new Date(o.prazo_entrega).toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      R$ {Number(o.valor_total ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={osSelecionada === o.id ? "default" : "outline"}
                        onClick={() =>
                          setOsSelecionada(osSelecionada === o.id ? null : o.id)
                        }
                      >
                        {osSelecionada === o.id ? "Fechar" : "Detalhes"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {osSelecionada && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos disponíveis</CardTitle>
            </CardHeader>
            <CardContent>
              {documentos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nenhum documento gerado ainda.
                </p>
              ) : (
                <div className="space-y-2">
                  {documentos.map((d: any) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium flex items-center gap-2">
                          <FileText className="h-3 w-3" />
                          {d.tipo === "os" ? "OS" : "Orçamento"}
                          {d.numero ? ` #${d.numero}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {new Date(d.created_at).toLocaleString("pt-BR")} ·{" "}
                          {d.tamanho_bytes
                            ? `${(Number(d.tamanho_bytes) / 1024).toFixed(0)} KB`
                            : ""}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => baixarDocumento(d)}>
                        <Download className="h-3 w-3 mr-1" />
                        Baixar
                      </Button>
                    </div>
                  ))}
                </div>

              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo do fechamento</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground font-mono">
                    Snapshot: {new Date(snapshot.created_at).toLocaleString("pt-BR")}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground text-xs">Receita líquida</div>
                      <div className="font-semibold">
                        R$ {Number(snapshot.resultado_json?.receita_liquida ?? 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-muted-foreground text-xs">Status entrega</div>
                      <div className="font-semibold">
                        {snapshot.resultado_json?.atraso ? "Com atraso" : "No prazo"}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  O resumo aparecerá aqui após o fechamento da OS.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Enviar solicitação / dúvida
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div>
              <Label>Tipo</Label>
              <select
                className="w-full border rounded h-9 px-2 bg-background text-sm"
                value={solicitacaoTipo}
                onChange={(e) => setSolicitacaoTipo(e.target.value)}
              >
                <option value="duvida">Dúvida</option>
                <option value="alteracao">Solicitar alteração</option>
                <option value="arquivo">Enviar arquivo/arte</option>
                <option value="pagamento">Pagamento</option>
                <option value="entrega">Entrega</option>
              </select>
            </div>
            <div>
              <Label>Mensagem</Label>
              <Textarea
                value={solicitacaoMsg}
                onChange={(e) => setSolicitacaoMsg(e.target.value)}
                rows={2}
                placeholder={
                  osSelecionada
                    ? "Sua mensagem sobre a OS selecionada..."
                    : "Descreva sua solicitação..."
                }
              />
            </div>
          </div>
          {solicitacaoTipo === "arquivo" && (
            <div className="rounded border-2 border-dashed p-4 text-center space-y-2">
              <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Para enviar arquivos, descreva na mensagem. Nossa equipe entrará em contato
                pelo WhatsApp/e-mail com um link seguro de upload.
              </p>
              <Input type="file" disabled title="Upload direto virá em breve" />
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={enviarSolicitacao}>Enviar solicitação</Button>
          </div>

          {solicitacoes.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-xs font-mono uppercase text-muted-foreground">
                Histórico de solicitações
              </div>
              {solicitacoes.map((s: any) => (
                <div key={s.id} className="rounded border p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {s.tipo} ·{" "}
                      {new Date(s.created_at).toLocaleDateString("pt-BR")}
                    </span>
                    <StatusChip
                      label={s.status}
                      tone={
                        s.status === "resolvida"
                          ? "lime"
                          : s.status === "cancelada"
                            ? "magenta"
                            : "cyan"
                      }
                    />
                  </div>
                  <div className="mt-1">{s.mensagem}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

