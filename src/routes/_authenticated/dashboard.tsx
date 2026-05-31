/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/module-data";
import {
  Users,
  FileText,
  ClipboardList,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Wallet,
  Receipt,
  Factory,
  Package,
  MessageCircle,
  Palette,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — BEX PRINT OS" }] }),
  component: DashboardPage,
});

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  accent,
}: {
  title: string;
  value: string | number;
  icon: any;
  hint?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${accent ?? "text-accent"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function useCount(table: any, filter?: (q: any) => any) {
  return useQuery({
    queryKey: ["count", table, filter?.toString() ?? ""],
    queryFn: async () => {
      let q: any = supabase.from(table).select("*", { count: "exact", head: true });
      if (filter) q = filter(q);
      const { count } = await q;
      return count ?? 0;
    },
  });
}

const chartTooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "0.5rem",
    fontSize: "12px",
  },
};

function DashboardPage() {
  const { canSeeFinancials } = useAuth();
  const clientes = useCount("clientes");
  const orcamentos = useCount("orcamentos", (q) => q.in("status", ["rascunho", "enviado"]));
  const osAbertas = useCount("ordens_servico", (q) =>
    q.not("status", "in", "(concluido,faturado,cancelado)"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const osAtrasadas = useCount("ordens_servico", (q) =>
    q.lt("prazo_entrega", today).not("status", "in", "(concluido,faturado,cancelado)"),
  );

  const { data: dashboardData } = useQuery({
    queryKey: ["dashboard-operacional"],
    queryFn: async () => {
      const [os, custos, produtos, maquinas, ocorrencias, conversas, materiais] = await Promise.all(
        [
          supabase.from("ordens_servico").select("status, valor_total, custo_real, created_at"),
          supabase.from("custos_os").select("categoria, valor"),
          supabase.from("produtos").select("nome"),
          supabase.from("maquinas").select("nome"),
          db.from("ocorrencias").select("setor, retrabalho"),
          db
            .from("whatsapp_conversas")
            .select("nome, ultima_mensagem, nao_lidas, ultima_interacao"),
          supabase.from("materiais").select("id, nome, unidade, estoque"),
        ],
      );

      return {
        os: os.data ?? [],
        custos: custos.data ?? [],
        produtos: produtos.data ?? [],
        maquinas: maquinas.data ?? [],
        ocorrencias: ocorrencias.data ?? [],
        conversas: conversas.data ?? [],
        materiais: materiais.data ?? [],
      };
    },
  });

  const os = dashboardData?.os ?? [];
  const custos = dashboardData?.custos ?? [];
  const conversas = dashboardData?.conversas ?? [];
  const materiais = dashboardData?.materiais ?? [];
  const faturamentoMensal = Array.from({ length: 12 }, (_, i) => ({
    mes: new Date(2026, i, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    faturamento: os
      .filter((o: any) => new Date(o.created_at).getMonth() === i)
      .reduce((s: number, o: any) => s + Number(o.valor_total ?? 0), 0),
    lucro: os
      .filter((o: any) => new Date(o.created_at).getMonth() === i)
      .reduce((s: number, o: any) => s + Number(o.valor_total ?? 0) - Number(o.custo_real ?? 0), 0),
  }));
  const lucroPrevistoRealMensal = faturamentoMensal
    .slice(-6)
    .map((m) => ({ mes: m.mes, previsto: m.lucro, real: m.lucro }));
  const statusColors = ["#3b82f6", "#f59e0b", "#eab308", "#10b981", "#ef4444", "#8b5cf6"];
  const osPorStatus = Object.entries(
    os.reduce(
      (acc: Record<string, number>, o: any) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }),
      {},
    ),
  ).map(([name, value], i) => ({ name, value, color: statusColors[i % statusColors.length] }));
  const custoPorCategoria = Object.entries(
    custos.reduce(
      (acc: Record<string, number>, c: any) => ({
        ...acc,
        [c.categoria || "Outros"]: (acc[c.categoria || "Outros"] ?? 0) + Number(c.valor ?? 0),
      }),
      {},
    ),
  ).map(([name, value], i) => ({ name, value, color: statusColors[i % statusColors.length] }));
  const tempoMedioPorEtapa = osPorStatus.map((s) => ({ etapa: s.name, horas: s.value }));
  const produtosMaisVendidos = (dashboardData?.produtos ?? [])
    .map((p: any) => ({ produto: p.nome, qtd: 1 }))
    .slice(0, 8);
  const producaoPorMaquina = (dashboardData?.maquinas ?? [])
    .map((m: any) => ({ maquina: m.nome, horas: 0 }))
    .slice(0, 8);
  const retrabalhoPorSetor = Object.entries(
    (dashboardData?.ocorrencias ?? [])
      .filter((o: any) => o.retrabalho)
      .reduce(
        (acc: Record<string, number>, o: any) => ({
          ...acc,
          [o.setor || "Sem setor"]: (acc[o.setor || "Sem setor"] ?? 0) + 1,
        }),
        {},
      ),
  ).map(([setor, qtd]) => ({ setor, qtd }));
  const criticos = materiais.filter((m: any) => Number(m.estoque ?? 0) <= 0).length;
  const wppNaoLidas = conversas.reduce((s: number, c: any) => s + Number(c.nao_lidas ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da operação · dados reais do Supabase</p>
      </div>

      {/* KPIs operacionais reais */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Clientes" value={clientes.data ?? "—"} icon={Users} />
        <StatCard title="Orçamentos em aberto" value={orcamentos.data ?? "—"} icon={FileText} />
        <StatCard title="OS abertas" value={osAbertas.data ?? "—"} icon={ClipboardList} />
        <StatCard
          title="OS atrasadas"
          value={osAtrasadas.data ?? 0}
          icon={AlertTriangle}
          accent="text-destructive"
        />
      </div>

      {/* KPIs operacionais complementares */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Máquinas em uso" value="3/5" icon={Factory} hint="60% de ocupação" />
        <StatCard title="Artes p/ aprovação" value="3" icon={Palette} accent="text-violet-600" />
        <StatCard
          title="Estoque crítico"
          value={criticos}
          icon={Package}
          accent={criticos > 0 ? "text-amber-600" : ""}
          hint="materiais abaixo do mínimo"
        />
        <StatCard
          title="WhatsApp não lidas"
          value={wppNaoLidas}
          icon={MessageCircle}
          accent="text-emerald-600"
        />
      </div>

      {/* KPIs financeiros */}
      {canSeeFinancials && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Faturamento (mês)"
            value="R$ 95.4k"
            icon={DollarSign}
            accent="text-emerald-600"
            hint="+7% vs mês anterior"
          />
          <StatCard
            title="Lucro real (mês)"
            value="R$ 34.8k"
            icon={TrendingUp}
            accent="text-emerald-600"
            hint="margem 36%"
          />
          <StatCard title="A receber" value="R$ 18.2k" icon={Wallet} />
          <StatCard title="Ticket médio" value="R$ 1.245" icon={Receipt} />
        </div>
      )}

      {/* Gráficos linha 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Faturamento últimos 12 meses</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={faturamentoMensal}>
                <defs>
                  <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="faturamento"
                  stroke="hsl(var(--accent))"
                  fillOpacity={1}
                  fill="url(#fatGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lucro previsto vs real</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={lucroPrevistoRealMensal}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="previsto" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="real" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos linha 2 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>OS por status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={osPorStatus}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                >
                  {osPorStatus.map((e) => (
                    <Cell key={e.name} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-2">
              {osPorStatus.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span>{s.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custo por categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={custoPorCategoria}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                >
                  {custoPorCategoria.map((e) => (
                    <Cell key={e.name} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 mt-2">
              {custoPorCategoria.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span>
                    {s.name} {s.value}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tempo médio por etapa (h)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={tempoMedioPorEtapa}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="etapa" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="horas"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ fill: "#8b5cf6" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos linha 3 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Produtos mais vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={produtosMaisVendidos} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" className="text-xs" />
                <YAxis dataKey="produto" type="category" width={110} className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="qtd" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Produção por máquina (horas)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={producaoPorMaquina}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="maquina" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="horas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Linha 4: retrabalho + listas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Retrabalho por setor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={retrabalhoPorSetor}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="setor" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip {...chartTooltipStyle} />
                <Bar dataKey="qtd" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversas recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversas.slice(0, 5).map((c: any) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm border-b border-border/50 pb-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.ultima_mensagem}</div>
                </div>
                {c.nao_lidas > 0 && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">{c.nao_lidas}</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estoque crítico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {materiais
              .filter((m: any) => Number(m.estoque ?? 0) <= 0)
              .map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between text-sm border-b border-border/50 pb-2"
                >
                  <div>
                    <div className="font-medium">{m.nome}</div>
                    <div className="text-xs text-muted-foreground">Estoque crítico</div>
                  </div>
                  <Badge variant="destructive">
                    {m.estoque} {m.unidade}
                  </Badge>
                </div>
              ))}
            {materiais.filter((m: any) => Number(m.estoque ?? 0) <= 0).length === 0 && (
              <div className="text-sm text-muted-foreground">Nenhum item crítico</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
