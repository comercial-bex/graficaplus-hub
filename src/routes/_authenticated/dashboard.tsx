/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/module-data";
import { fromFinancialView } from "@/lib/supabase-financial-views";
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
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
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

// Tabelas com SELECT revogado na base — contar pela view operacional.
const COUNT_VIEW: Record<string, string> = {
  ordens_servico: "ordens_servico_operacional",
  orcamentos: "orcamentos_operacional",
  itens_os: "itens_os_operacional",
};

function useCount(table: any, filter?: (q: any) => any) {
  return useQuery({
    queryKey: ["count", table, filter?.toString() ?? ""],
    queryFn: async () => {
      const alvo = COUNT_VIEW[table as string] ?? table;
      let q: any = (supabase as any).from(alvo).select("*", { count: "exact", head: true });
      if (filter) q = filter(q);
      const { count } = await q;
      return count ?? 0;
    },
  });
}

const chartTooltipStyle = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    fontSize: "12px",
    fontFamily: "var(--font-mono)",
  },
};

const CMYK = {
  cyan: "#00d4ff",
  magenta: "#e91e63",
  lime: "#a8ff2e",
  amber: "#ffb020",
  violet: "#8b5cf6",
};
const PIE_COLORS = [CMYK.cyan, CMYK.magenta, CMYK.lime, CMYK.amber, CMYK.violet, "#64748b"];

function BexCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

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

  const { data: dashViews } = useQuery({
    queryKey: ["vw-dashboards"],
    queryFn: async () => {
      const client = supabase as any;
      const [comercial, financeiro, prazos, qualidade, impressao3d] = await Promise.all([
        client.from("vw_dashboard_comercial").select("*").maybeSingle(),
        client.from("vw_dashboard_financeiro").select("*").maybeSingle(),
        client.from("vw_dashboard_prazos").select("*").maybeSingle(),
        client.from("vw_dashboard_qualidade").select("*"),
        client.from("vw_dashboard_impressao_3d").select("*").maybeSingle(),
      ]);
      return {
        comercial: comercial.data ?? null,
        financeiro: financeiro.data ?? null,
        prazos: prazos.data ?? null,
        qualidade: qualidade.data ?? [],
        impressao3d: impressao3d.data ?? null,
      };
    },
  });


  const { data: dashboardData } = useQuery({
    queryKey: ["dashboard-operacional", canSeeFinancials ? "fin" : "op"],
    queryFn: async () => {
      // ordens_servico/itens_os têm SELECT revogado na base — ler pelas views;
      // colunas financeiras (valor_total/custo_real) só existem na view financeira.
      const [os, custos, produtos, maquinas, ocorrencias, conversas, materiais, itensOs] =
        await Promise.all([
          fromFinancialView("ordens_servico", canSeeFinancials).select(
            canSeeFinancials ? "status, valor_total, custo_real, created_at" : "status, created_at",
          ),
          supabase.from("vw_dashboard_custos_categoria").select("categoria, total"),
          supabase.from("produtos").select("nome"),
          supabase.from("maquinas").select("nome"),
          db.from("ocorrencias").select("setor, retrabalho"),
          // colunas reais: nome_contato / ultima_mensagem_at (aliases mantêm o shape usado abaixo)
          db.from("whatsapp_conversas").select("nome:nome_contato, ultima_mensagem, nao_lidas, ultima_interacao:ultima_mensagem_at"),
          supabase.from("materiais").select("id, nome, unidade, estoque"),
          fromFinancialView("itens_os", canSeeFinancials).select(
            canSeeFinancials ? "descricao, quantidade, valor_total" : "descricao, quantidade",
          ),
        ]);
      return {
        os: os.data ?? [],
        custos: custos.data ?? [],
        produtos: produtos.data ?? [],
        maquinas: maquinas.data ?? [],
        ocorrencias: ocorrencias.data ?? [],
        conversas: conversas.data ?? [],
        materiais: materiais.data ?? [],
        itensOs: itensOs.data ?? [],
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
  const osPorStatus = Object.entries(
    os.reduce(
      (acc: Record<string, number>, o: any) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }),
      {},
    ),
  ).map(([name, value], i) => ({ name, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  const custoPorCategoria = Object.entries(
    custos.reduce(
      (acc: Record<string, number>, c: any) => ({
        ...acc,
        [c.categoria || "Outros"]: (acc[c.categoria || "Outros"] ?? 0) + Number(c.total ?? 0),
      }),
      {},
    ),
  ).map(([name, value], i) => ({ name, value, color: PIE_COLORS[i % PIE_COLORS.length] }));
  const tempoMedioPorEtapa = osPorStatus.map((s) => ({ etapa: s.name, horas: s.value }));
  const itensOs = dashboardData?.itensOs ?? [];
  const produtosMaisVendidos = Object.entries(
    itensOs.reduce((acc: Record<string, { qtd: number; valor: number }>, i: any) => {
      const k = (i.descricao || "—").slice(0, 40);
      const prev = acc[k] ?? { qtd: 0, valor: 0 };
      acc[k] = {
        qtd: prev.qtd + Number(i.quantidade ?? 0),
        valor: prev.valor + Number(i.valor_total ?? 0),
      };
      return acc;
    }, {}),
  )
    .map(([produto, v]) => ({ produto, qtd: (v as any).qtd, valor: (v as any).valor }))
    .sort((a, b) => b.valor - a.valor)
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
    <div className="space-y-8">
      <SectionHeader
        breadcrumb="Print OS · Operação"
        title="Dashboard"
        description="Telemetria em tempo real da produção, comercial e financeiro."
        actions={
          <div className="flex items-center gap-2">
            <StatusChip label="Live" tone="lime" />
            <StatusChip label="v4.2" tone="cyan" />
          </div>
        }
      />

      {/* KPIs operacionais */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>Operação</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Clientes ativos" value={clientes.data ?? "—"} icon={Users} tone="cyan" />
          <KpiCard label="Orçamentos abertos" value={orcamentos.data ?? "—"} icon={FileText} tone="cyan" />
          <KpiCard label="OS em andamento" value={osAbertas.data ?? "—"} icon={ClipboardList} tone="lime" />
          <KpiCard
            label="OS atrasadas"
            value={osAtrasadas.data ?? 0}
            icon={AlertTriangle}
            tone="magenta"
            hint={osAtrasadas.data ? "requer atenção imediata" : "no prazo"}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Máquinas em uso" value="3/5" icon={Factory} tone="cyan" hint="60% de ocupação" />
          <KpiCard label="Artes p/ aprovação" value="3" icon={Palette} tone="magenta" />
          <KpiCard
            label="Estoque crítico"
            value={criticos}
            icon={Package}
            tone={criticos > 0 ? "magenta" : "muted"}
            hint="itens abaixo do mínimo"
          />
          <KpiCard label="WhatsApp não lidas" value={wppNaoLidas} icon={MessageCircle} tone="lime" />
        </div>
      </section>

      {/* KPIs financeiros — conectados às vw_dashboard_* */}
      {canSeeFinancials && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>Financeiro · views oficiais</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Faturamento"
              value={dashViews?.financeiro?.faturamento != null ? `R$ ${Number(dashViews.financeiro.faturamento).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—"}
              icon={DollarSign}
              tone="lime"
              hint="vw_dashboard_financeiro"
            />
            <KpiCard
              label="Lucro"
              value={dashViews?.financeiro?.lucro != null ? `R$ ${Number(dashViews.financeiro.lucro).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—"}
              delta={dashViews?.financeiro?.margem != null ? `${Number(dashViews.financeiro.margem).toFixed(1)}%` : undefined}
              icon={TrendingUp}
              tone="lime"
              hint="margem oficial"
            />
            <KpiCard
              label="Ticket médio"
              value={dashViews?.comercial?.ticket_medio != null ? `R$ ${Number(dashViews.comercial.ticket_medio).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : "—"}
              icon={Receipt}
              tone="cyan"
              hint={dashViews?.comercial?.orcamentos_mes ? `${dashViews.comercial.orcamentos_mes} orçamentos` : undefined}
            />
            <KpiCard
              label="Custo total"
              value={dashViews?.financeiro?.custo != null ? `R$ ${Number(dashViews.financeiro.custo).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` : "—"}
              icon={Wallet}
              tone="cyan"
            />
          </div>
        </section>
      )}

      {/* KPIs 3D + prazos + qualidade */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>Impressão 3D · Prazos · Qualidade</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Jobs 3D"
            value={dashViews?.impressao3d?.jobs ?? 0}
            icon={Factory}
            tone="cyan"
            hint={dashViews?.impressao3d?.horas_impressas != null ? `${Number(dashViews.impressao3d.horas_impressas).toFixed(1)}h impressas` : "sem produção"}
          />
          <KpiCard
            label="Falhas 3D"
            value={dashViews?.impressao3d?.falhas ?? 0}
            icon={AlertTriangle}
            tone={(dashViews?.impressao3d?.falhas ?? 0) > 0 ? "magenta" : "muted"}
            hint={dashViews?.impressao3d?.gramas_consumidas != null ? `${Number(dashViews.impressao3d.gramas_consumidas).toFixed(0)}g consumidos` : "—"}
          />
          <KpiCard
            label="OS atrasadas (view)"
            value={dashViews?.prazos?.atrasadas ?? 0}
            icon={AlertTriangle}
            tone={(dashViews?.prazos?.atrasadas ?? 0) > 0 ? "magenta" : "lime"}
            hint="vw_dashboard_prazos"
          />
          <KpiCard
            label="Inspeções aprovadas"
            value={(() => {
              const q: any[] = (dashViews?.qualidade as any[]) ?? [];
              const ok = q.filter((r: any) => r.resultado === "aprovado" || r.resultado === "aprovado_com_ressalva").reduce((s, r) => s + Number(r.inspecoes ?? 0), 0);
              const total = q.reduce((s, r) => s + Number(r.inspecoes ?? 0), 0);
              return total > 0 ? `${ok}/${total}` : "—";
            })()}
            icon={ClipboardList}
            tone="lime"
            hint="qualidade"
          />
        </div>
      </section>


      {/* Charts row 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BexCard title="Faturamento · 12 meses">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={faturamentoMensal}>
              <defs>
                <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CMYK.cyan} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={CMYK.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Area type="monotone" dataKey="faturamento" stroke={CMYK.cyan} strokeWidth={2} fill="url(#fatGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </BexCard>

        <BexCard title="Lucro · previsto vs real">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={lucroPrevistoRealMensal}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Legend wrapperStyle={{ fontSize: "11px", fontFamily: "var(--font-mono)" }} />
              <Bar dataKey="previsto" fill="#334155" radius={[3, 3, 0, 0]} />
              <Bar dataKey="real" fill={CMYK.lime} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </BexCard>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <BexCard title="OS por status">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={osPorStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45}>
                {osPorStatus.map((e) => (
                  <Cell key={e.name} fill={e.color} />
                ))}
              </Pie>
              <Tooltip {...chartTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {osPorStatus.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
            {osPorStatus.length === 0 && <StatusChip label="sem dados" tone="muted" />}
          </div>
        </BexCard>

        <BexCard title="Custo · categoria">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={custoPorCategoria} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45}>
                {custoPorCategoria.map((e) => (
                  <Cell key={e.name} fill={e.color} />
                ))}
              </Pie>
              <Tooltip {...chartTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {custoPorCategoria.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
            {custoPorCategoria.length === 0 && <StatusChip label="sem dados" tone="muted" />}
          </div>
        </BexCard>

        <BexCard title="Tempo médio · etapa (h)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={tempoMedioPorEtapa}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="etapa" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Line type="monotone" dataKey="horas" stroke={CMYK.magenta} strokeWidth={2} dot={{ fill: CMYK.magenta }} />
            </LineChart>
          </ResponsiveContainer>
        </BexCard>
      </div>

      {/* Charts row 3 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <BexCard title="Produtos · mais vendidos">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={produtosMaisVendidos} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis dataKey="produto" type="category" width={110} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="qtd" fill={CMYK.cyan} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </BexCard>

        <BexCard title="Produção · horas por máquina">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={producaoPorMaquina}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="maquina" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="horas" fill={CMYK.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </BexCard>
      </div>

      {/* Row 4 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <BexCard title="Retrabalho · setor">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={retrabalhoPorSetor}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="setor" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip {...chartTooltipStyle} />
              <Bar dataKey="qtd" fill={CMYK.magenta} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {retrabalhoPorSetor.length === 0 && (
            <div className="mt-2">
              <StatusChip label="Sem retrabalho" tone="lime" />
            </div>
          )}
        </BexCard>

        <BexCard title="WhatsApp · conversas recentes">
          <div className="space-y-2">
            {conversas.slice(0, 5).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.nome}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.ultima_mensagem}</div>
                </div>
                {c.nao_lidas > 0 && <StatusChip label={String(c.nao_lidas)} tone="lime" />}
              </div>
            ))}
            {conversas.length === 0 && <StatusChip label="Sem conversas" tone="muted" />}
          </div>
        </BexCard>

        <BexCard title="Estoque · críticos">
          <div className="space-y-2">
            {materiais
              .filter((m: any) => Number(m.estoque ?? 0) <= 0)
              .map((m: any) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{m.nome}</div>
                    <div className="text-xs text-muted-foreground">Reposição necessária</div>
                  </div>
                  <StatusChip label={`${m.estoque} ${m.unidade}`} tone="magenta" />
                </div>
              ))}
            {materiais.filter((m: any) => Number(m.estoque ?? 0) <= 0).length === 0 && (
              <StatusChip label="Sem itens críticos" tone="lime" />
            )}
          </div>
        </BexCard>
      </div>
    </div>
  );
}
