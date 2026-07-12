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
      const { data } = await supabase
        .from("ordens_servico")
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
        .eq("os_id", osSelecionada)
        .order("created_at", { ascending: false });
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
                      <div>
                        <div className="font-medium">{d.tipo ?? "Documento"}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {new Date(d.created_at).toLocaleString("pt-BR")}
                        </div>
                      </div>
                      {d.url && (
                        <Button asChild size="sm" variant="outline">
                          <a href={d.url} target="_blank" rel="noreferrer">
                            <Download className="h-3 w-3 mr-1" />
                            Baixar
                          </a>
                        </Button>
                      )}
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
    </div>
  );
}
