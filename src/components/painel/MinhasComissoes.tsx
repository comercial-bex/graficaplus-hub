import { useQuery } from "@tanstack/react-query";
import { BadgePercent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl } from "@/domain/parceiros/preco";

/**
 * "Suas comissões" — o que a pessoa logada tem a receber por vendas que trouxe.
 *
 * Aparece no painel de quem tem comissão configurada, seja qual for o papel:
 * o impressor que traz cliente vê aqui, sem precisar de permissão financeira,
 * porque é o dinheiro dele. Some para quem não tem regra nem lançamento.
 */

type Item = {
  id: string; os_numero: number | null; os_titulo: string | null; cliente: string | null;
  base: number; pct: number; valor: number; status: string; quando: string; pago_em: string | null;
};
type Resumo = { pct: number | null; a_pagar: number; pagas_ano: number; itens: Item[] };

export function MinhasComissoes({ className }: { className?: string }) {
  const { data, isSuccess } = useQuery({
    queryKey: ["minhas-comissoes"],
    queryFn: async (): Promise<Resumo> => {
      const { data: d, error } = await (supabase.rpc as any)("minhas_comissoes");
      if (error) throw error;
      return (d ?? { pct: null, a_pagar: 0, pagas_ano: 0, itens: [] }) as Resumo;
    },
  });

  if (!isSuccess || !data) return null;
  if (data.pct == null && data.itens.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <BadgePercent className="h-4 w-4 text-[color:var(--bex-lime)]" />
          Suas comissões
          {data.pct != null && (
            <Badge variant="outline" className="text-[10px] font-normal">{Number(data.pct)}% do bruto da OS</Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Toda OS que você trouxe gera comissão quando é paga. O financeiro paga no fechamento.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">A receber</div>
            <div className="font-mono text-xl font-bold tabular-nums text-[color:var(--bex-amber)]">{brl(Number(data.a_pagar))}</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recebido no ano</div>
            <div className="font-mono text-xl font-bold tabular-nums text-[color:var(--bex-lime)]">{brl(Number(data.pagas_ano))}</div>
          </div>
        </div>

        {data.itens.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {data.itens.slice(0, 6).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate">#{i.os_numero ?? "—"} {i.os_titulo ?? ""}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.cliente ?? "—"} · {brl(Number(i.base))} × {Number(i.pct)}%
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono font-semibold tabular-nums">{brl(Number(i.valor))}</div>
                  <div className="text-xs text-muted-foreground">{i.status === "paga" ? "paga" : i.status === "a_pagar" ? "a pagar" : "cancelada"}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
