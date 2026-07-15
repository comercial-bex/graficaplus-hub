/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Cuboid,
  Clock,
  Weight,
  AlertTriangle,
  Activity,
  DollarSign,
} from "lucide-react";
import {
  price,
  operationalCost,
  MOTOR_VERSION,
} from "@/domain/impressao3d/cost-engine";

export const Route = createFileRoute("/_authenticated/impressao-3d")({
  head: () => ({ meta: [{ title: "Impressão 3D — BEX PRINT OS" }] }),
  component: Impressao3DPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Erro: {error.message}</div>
  ),
});

function toneForStatus(status: string): "cyan" | "magenta" | "lime" | "muted" {
  if (status === "aprovado" || status === "convertido") return "lime";
  if (status === "rejeitado" || status === "cancelado") return "magenta";
  if (status === "rascunho") return "muted";
  return "cyan";
}

function Impressao3DPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const converter = useMutation({
    mutationFn: async (orcamento3dId: string) => {
      const { data, error } = await (supabase.rpc as any)("converter_orcamento_3d_em_os", {
        p_orcamento_3d_id: orcamento3dId,
      });
      if (error) throw error;
      return data as { os_id: string };
    },
    onSuccess: (res) => {
      toast.success("Orçamento convertido em OS");
      qc.invalidateQueries({ queryKey: ["orcamentos-3d"] });
      if (res?.os_id) navigate({ to: "/os/$id", params: { id: res.os_id } });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: orcamentos = [], isLoading } = useQuery({
    queryKey: ["orcamentos-3d"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("orcamentos_3d")
        .select("*, clientes(nome)")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["producao-3d-jobs"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("producao_3d_jobs")
        .select("*, ordens_servico(numero, titulo), maquinas(nome)")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const { data: apontamentos = [] } = useQuery({
    queryKey: ["producao-3d-apontamentos"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("producao_3d_apontamentos")
        .select("*, producao_3d_jobs(os_id, maquina_id, maquinas(nome))")
        .order("inicio", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ["vw-dashboard-3d"],
    queryFn: async () =>
      (await (supabase as any).from("vw_dashboard_impressao_3d").select("*").maybeSingle())
        .data,
  });

  // Motor de referência (exemplo)
  const custoRef = operationalCost({
    material: "30.5000",
    maquina: "35.7000",
    energia: "1.1220",
    maoDeObra: "40.0000",
    embalagem: "5.0000",
    indiretosRateados: "10.0000",
    reservaFalha: 0,
  });
  const precoRef = price({
    custoOperacional: custoRef,
    tributosVenda: "0.06",
    taxaPagamento: "0.03",
    margemLiquidaAlvo: "0.25",
    margemMinima: "0.10",
    quantidade: 1,
  });

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Comercial · Impressão 3D"
        title="Impressão 3D"
        description="Orçamentos 3D com motor de custo Decimal, produção e apontamentos"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link to="/orcamento-3d-novo">Novo orçamento</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/filamentos-3d">Filamentos</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/impressoras-3d">Impressoras</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/configuracoes-3d">Config</Link>
            </Button>
            <StatusChip label={`Motor ${MOTOR_VERSION}`} tone="cyan" />
            <StatusChip
              label={`Nível: ${(dashboard as any)?.nivel_padrao ?? "validado"}`}
              tone="lime"
            />
          </div>
        }
      />

      {/* KPIs da view oficial + motor */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Jobs 3D"
          value={(dashboard as any)?.jobs ?? 0}
          icon={Cuboid}
          tone="cyan"
        />
        <KpiCard
          label="Horas impressas"
          value={
            (dashboard as any)?.horas_impressas != null
              ? Number((dashboard as any).horas_impressas).toFixed(1) + "h"
              : "—"
          }
          icon={Clock}
          tone="cyan"
        />
        <KpiCard
          label="Filamento consumido"
          value={
            (dashboard as any)?.gramas_consumidas != null
              ? Number((dashboard as any).gramas_consumidas).toFixed(0) + "g"
              : "—"
          }
          icon={Weight}
          tone="lime"
        />
        <KpiCard
          label="Falhas 3D"
          value={(dashboard as any)?.falhas ?? 0}
          icon={AlertTriangle}
          tone={((dashboard as any)?.falhas ?? 0) > 0 ? "magenta" : "muted"}
        />
      </div>

      {/* Referência do motor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Referência do motor de custo (exemplo)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4 text-sm">
          <div className="rounded border p-3">
            <div className="text-muted-foreground text-xs">Custo operacional</div>
            <div className="font-mono font-semibold">R$ {custoRef.toString(2)}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-muted-foreground text-xs">Preço sugerido</div>
            <div className="font-mono font-semibold">R$ {precoRef.precoComercial.toString(2)}</div>
          </div>
          <div className="rounded border p-3">
            <div className="text-muted-foreground text-xs">Margem líquida</div>
            <div className="font-mono font-semibold">
              {(precoRef.margemLiquida.toNumber() * 100).toFixed(2)}%
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-muted-foreground text-xs">Markup</div>
            <div className="font-mono font-semibold">{precoRef.markup.toString(2)}x</div>
          </div>
        </CardContent>
      </Card>

      {/* Orçamentos 3D reais */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orçamentos 3D</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
          ) : orcamentos.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Cuboid className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum orçamento 3D cadastrado. Crie um em{" "}
                <Link to="/orcamentos" className="underline">
                  Orçamentos
                </Link>{" "}
                marcando a modalidade Impressão 3D.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead className="text-right">Preço comercial</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orcamentos.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/orcamento-3d/$id"
                        params={{ id: o.id }}
                        className="hover:underline text-primary"
                      >
                        {o.titulo}
                      </Link>
                    </TableCell>
                    <TableCell>{o.clientes?.nome ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{o.nivel_precisao}</span>
                    </TableCell>
                    <TableCell>
                      <StatusChip label={o.status} tone={toneForStatus(o.status)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(o.quantidade).toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {o.preco_comercial != null
                        ? `R$ ${Number(o.preco_comercial).toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {o.os_id ? (
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/os/$id" params={{ id: o.os_id }}>
                            Ver OS
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!o.cliente_id || converter.isPending}
                          title={!o.cliente_id ? "Associe um cliente ao orçamento" : "Converter em OS"}
                          onClick={() => converter.mutate(o.id)}
                        >
                          Converter em OS
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Jobs de produção 3D */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Jobs em produção
            </CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum job planejado.
              </p>
            ) : (
              <div className="space-y-2">
                {jobs.slice(0, 10).map((j: any) => (
                  <div
                    key={j.id}
                    className="flex items-center justify-between rounded border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        OS #{j.ordens_servico?.numero ?? "—"} · {j.ordens_servico?.titulo ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {j.maquinas?.nome ?? "sem máquina"} · rep {j.repeticao}
                      </div>
                    </div>
                    <StatusChip
                      label={j.status}
                      tone={
                        j.status === "concluido"
                          ? "lime"
                          : j.status === "falha" || j.status === "cancelado"
                            ? "magenta"
                            : "cyan"
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Apontamentos recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {apontamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhum apontamento registrado.
              </p>
            ) : (
              <div className="space-y-2">
                {apontamentos.slice(0, 10).map((a: any) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded border p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {a.producao_3d_jobs?.maquinas?.nome ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {new Date(a.inicio).toLocaleString("pt-BR")}
                        {a.tempo_real_segundos
                          ? ` · ${(a.tempo_real_segundos / 3600).toFixed(2)}h`
                          : ""}
                      </div>
                    </div>
                    <StatusChip
                      label={a.resultado}
                      tone={
                        a.resultado === "sucesso"
                          ? "lime"
                          : a.resultado === "falha"
                            ? "magenta"
                            : "cyan"
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
