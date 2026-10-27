/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Gem, Medal, Users } from "lucide-react";
import { metaGeralDaEquipe, useMetasDaEquipe } from "@/hooks/useMetasDaEquipe";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { brl } from "@/domain/parceiros/preco";
import { foco, nomeDoMes, NOME_DO_NIVEL, type MetaDoMes } from "@/domain/metas/progresso";
import { cn } from "@/lib/utils";
import { BarraDeMeta } from "@/components/metas/barra-de-meta";

/**
 * "Metas da equipe" — a meta de venda de CADA vendedor no painel de quem responde pela gráfica.
 *
 * Existia, mas só dentro de Financeiro: o painel mostrava o ponto de equilíbrio da EMPRESA (quanto
 * a gráfica precisa faturar para pagar as contas) e cada vendedor só via a própria barra. Quem
 * cobra a equipe (dono, gestor, financeiro) não via de ninguém. Aqui ficam lado a lado, e a meta
 * de uma pessoa NÃO depende do ponto de equilíbrio: é um número combinado com ela.
 *
 * Mesma regra de todo o sistema de metas: o nível (Ouro/Diamante) e a comissão são do PAGO; o
 * vendido ainda não pago aparece como camada clara da barra. A conta vem pronta de `meta_painel()`
 * (o banco decide o nível); aqui só se desenha.
 *
 * Quem não pode ver (a RPC levanta 42501) não vê o bloco: sem cartão vazio.
 */

const ESTILO: Record<MetaDoMes["nivel"], string> = {
  nenhum: "text-muted-foreground",
  ouro: "border-[color:var(--bex-amber)]/60 text-[color:var(--status-amber)]",
  diamante: "border-[color:var(--bex-cyan)]/60 text-[color:var(--status-cyan)]",
};

const pctDe = (valor: number, meta: number) => (meta > 0 ? Math.round((1000 * valor) / meta) / 10 : 0);
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function MetasDaEquipe({ className }: { className?: string }) {
  const { hasRole, hasPermission } = useAuth();
  const podeVer = hasRole("admin") || hasRole("gestor") || hasPermission("financeiro.read");

  const { data, isLoading, isError } = useMetasDaEquipe(podeVer);

  if (!podeVer) return null;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // A RPC é mais estrita que a tela (admin, gestor ou financeiro.read): negada ou fora do ar, o
  // bloco some em vez de desenhar zeros que parecem "ninguém vendeu".
  if (isError || !data || data.length === 0) {
    return isError ? null : (
      <Card className={className}>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Nenhum vendedor tem meta neste mês.{" "}
          <Link to="/financeiro" className="font-semibold underline underline-offset-4">
            Definir as metas de venda
          </Link>
        </CardContent>
      </Card>
    );
  }

  const total = {
    meta: metaGeralDaEquipe(data),
    vendido: data.reduce((t, m) => t + Number(m.vendido), 0),
    pago: data.reduce((t, m) => t + Number(m.pago), 0),
  };
  // Como a meta geral foi repartida: quanto cada um carrega dos R$ 40 mil.
  const divisao = data.map((m) => `${m.usuario_nome ?? "—"} ${brl(Number(m.meta))} (${pct(pctDe(Number(m.meta), total.meta))})`).join(" · ");
  const mes = data[0].mes;

  return (
    <Card className={cn("border-l-4 border-l-[color:var(--bex-cyan)]", className)}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            Metas da equipe
            <span className="text-sm font-normal text-muted-foreground">{nomeDoMes(mes)}</span>
          </CardTitle>
          <Link
            to="/financeiro"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[color:var(--bex-cyan)] underline-offset-4 hover:underline"
          >
            ajustar metas
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          A meta geral do mês é a soma das metas de cada vendedor: <strong className="text-foreground">{brl(total.meta)}</strong>.
          Divisão: {divisao}. Juntos: <strong className="text-foreground">{brl(total.vendido)}</strong> vendidos (
          {pct(pctDe(total.vendido, total.meta))}), {brl(total.pago)} já pagos.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {data.map((m) => {
          const f = foco(m);
          const Icone = m.nivel === "diamante" ? Gem : Medal;
          return (
            <div key={m.meta_id} className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{m.usuario_nome ?? "—"}</span>
                  <Badge variant="outline" className={cn("gap-1 text-[11px] font-medium", ESTILO[m.nivel])}>
                    {m.nivel !== "nenhum" && <Icone className="h-3 w-3" aria-hidden="true" />}
                    {NOME_DO_NIVEL[m.nivel]}
                  </Badge>
                </div>
                <div className="font-mono text-sm tabular-nums">
                  <strong>{brl(m.vendido)}</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    de {brl(m.meta)} · {pct(pctDe(m.vendido, m.meta))} vendido · {brl(m.pago)} pago
                  </span>
                </div>
              </div>

              <BarraDeMeta meta={m} compacta />

              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{f.titulo}.</span>{" "}
                {m.nivel === "nenhum" && m.ritmo_por_dia_util != null && m.dias_uteis_restantes > 0
                  ? `Ritmo de ${brl(m.ritmo_por_dia_util)} por dia útil (restam ${m.dias_uteis_restantes}) para o Ouro. `
                  : ""}
                {m.os_vendidas} OS no mês.
              </p>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Vendido = valor das OS abertas no mês no nome do vendedor. O nível e a comissão contam só o que o cliente já pagou.
        </p>
      </CardContent>
    </Card>
  );
}
