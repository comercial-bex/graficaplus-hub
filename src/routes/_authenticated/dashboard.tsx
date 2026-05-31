import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Users, FileText, ClipboardList, AlertTriangle, DollarSign, TrendingUp, Wallet, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — BEX PRINT OS" }] }),
  component: DashboardPage,
});

function StatCard({ title, value, icon: Icon, hint, accent }: { title: string; value: string | number; icon: any; hint?: string; accent?: string }) {
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

function DashboardPage() {
  const { canSeeFinancials } = useAuth();
  const clientes = useCount("clientes");
  const orcamentos = useCount("orcamentos", (q) => q.in("status", ["rascunho", "enviado"]));
  const osAbertas = useCount("ordens_servico", (q) => q.not("status", "in", "(concluido,faturado,cancelado)"));
  const today = new Date().toISOString().slice(0, 10);
  const osAtrasadas = useCount("ordens_servico", (q) =>
    q.lt("prazo_entrega", today).not("status", "in", "(concluido,faturado,cancelado)")
  );

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const { data: finStats } = useQuery({
    enabled: canSeeFinancials,
    queryKey: ["fin-stats", inicioMes],
    queryFn: async () => {
      const [pagos, pendentes, osMes] = await Promise.all([
        supabase.from("pagamentos").select("valor").eq("status", "pago").gte("data_pagamento", inicioMes),
        supabase.from("pagamentos").select("valor").eq("status", "pendente"),
        supabase.from("ordens_servico").select("valor_total").gte("created_at", inicioMes),
      ]);
      const faturamento = (pagos.data ?? []).reduce((s, p: any) => s + Number(p.valor), 0);
      const aReceber = (pendentes.data ?? []).reduce((s, p: any) => s + Number(p.valor), 0);
      const osList = osMes.data ?? [];
      const ticket = osList.length ? osList.reduce((s, o: any) => s + Number(o.valor_total), 0) / osList.length : 0;
      return { faturamento, aReceber, ticket, qtdOSMes: osList.length };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da operação</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Clientes" value={clientes.data ?? "—"} icon={Users} />
        <StatCard title="Orçamentos em aberto" value={orcamentos.data ?? "—"} icon={FileText} />
        <StatCard title="OS abertas" value={osAbertas.data ?? "—"} icon={ClipboardList} />
        <StatCard title="OS atrasadas" value={osAtrasadas.data ?? "—"} icon={AlertTriangle} hint="Prazo vencido" accent="text-destructive" />
      </div>

      {canSeeFinancials && finStats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Faturamento (mês)" value={`R$ ${finStats.faturamento.toFixed(2)}`} icon={DollarSign} accent="text-green-600" />
          <StatCard title="A receber" value={`R$ ${finStats.aReceber.toFixed(2)}`} icon={Wallet} />
          <StatCard title="Ticket médio (mês)" value={`R$ ${finStats.ticket.toFixed(2)}`} icon={TrendingUp} hint={`${finStats.qtdOSMes} OS`} />
          <StatCard title="OS criadas (mês)" value={finStats.qtdOSMes} icon={Receipt} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Próximos passos</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Fase 1 do BEX PRINT OS instalada. Comece cadastrando clientes, criando orçamentos e convertendo em OS.</p>
          <p>Fases seguintes incluem WhatsApp/Z-API, máquinas, estoque, área do cliente e IA.</p>
        </CardContent>
      </Card>
    </div>
  );
}
