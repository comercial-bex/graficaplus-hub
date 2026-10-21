/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gem, Medal, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dica } from "@/components/bex/Dica";
import { brl } from "@/domain/parceiros/preco";
import { dicaCampo } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { BarraDeMeta } from "./barra-de-meta";
import { foco, nivelParaComemorar, nomeDoMes, NOME_DO_NIVEL, type MetaDoMes } from "@/domain/metas/progresso";

/**
 * "Sua meta" — a barra do mês no painel de quem tem meta (Jhesselem, Fernando,
 * Leonardo). É a primeira coisa do painel: o número que a pessoa persegue.
 *
 * Some para quem não tem meta no mês, sem cartão vazio. O nível é do PAGO; o
 * vendido ainda não pago aparece como camada clara da barra e como promessa
 * ("se for pago, você fecha o Ouro"), porque venda parada no caixa do cliente
 * também é trabalho da pessoa a cobrar.
 *
 * A comemoração aparece uma vez por nível: ao ver, `meta_comemorada` grava no
 * banco e ela não volta na próxima abertura, nem em outro aparelho.
 */

const ESTILO: Record<"nenhum" | "ouro" | "diamante", { faixa: string; texto: string }> = {
  nenhum: { faixa: "", texto: "text-muted-foreground" },
  ouro: { faixa: "border-[color:var(--bex-amber)]/60", texto: "text-[color:var(--status-amber)]" },
  diamante: { faixa: "border-[color:var(--bex-cyan)]/60", texto: "text-[color:var(--status-cyan)]" },
};

export function MinhaMeta({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { data, isSuccess } = useQuery({
    queryKey: ["minha-meta"],
    queryFn: async (): Promise<MetaDoMes | null> => {
      const { data: d, error } = await (supabase.rpc as any)("minha_meta");
      if (error) throw error;
      return (d ?? null) as MetaDoMes | null;
    },
    refetchOnWindowFocus: true,
  });

  const comemorar = useMutation({
    mutationFn: async (nivel: "ouro" | "diamante") => {
      const { error } = await (supabase.rpc as any)("meta_comemorada", { p_nivel: nivel });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["minha-meta"] }),
  });

  const [festejando, setFestejando] = useState<"ouro" | "diamante" | null>(null);
  const jaChamou = useRef<string | null>(null);
  const nivelNovo = data ? nivelParaComemorar(data) : null;
  useEffect(() => {
    if (!nivelNovo || jaChamou.current === nivelNovo) return;
    jaChamou.current = nivelNovo;
    setFestejando(nivelNovo);
    comemorar.mutate(nivelNovo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivelNovo]);

  if (!isSuccess || !data) return null;

  const f = foco(data);
  const estilo = ESTILO[data.nivel];
  const Icone = data.nivel === "diamante" ? Gem : data.nivel === "ouro" ? Medal : Target;
  const pctDaMeta = data.meta > 0 ? Math.round((data.pago / data.meta) * 100) : 0;

  return (
    <Card className={cn(estilo.faixa, className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icone className={cn("h-4 w-4", data.nivel === "nenhum" ? "text-primary" : estilo.texto)} aria-hidden="true" />
          Sua meta de {nomeDoMes(data.mes)}
          <Badge variant="outline" className={cn("text-[11px] font-medium", estilo.texto)}>
            {NOME_DO_NIVEL[data.nivel]}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {festejando && (
          <div
            role="status"
            className={cn(
              "rounded-lg border p-3 text-sm font-medium",
              festejando === "diamante"
                ? "border-[color:var(--bex-cyan)]/60 bg-[color:var(--bex-cyan)]/10"
                : "border-[color:var(--bex-amber)]/60 bg-[color:var(--bex-amber)]/10",
            )}
          >
            {festejando === "diamante"
              ? `Parabéns! Você é Diamante: ${data.pct_diamante.toLocaleString("pt-BR")}% de cada OS paga do mês é seu.`
              : `Meta batida! Você é Ouro: ${data.pct_ouro.toLocaleString("pt-BR")}% de cada OS paga do mês é seu. Agora vá atrás do Diamante.`}
          </div>
        )}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="font-mono text-2xl font-bold tabular-nums">
            {brl(data.pago)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">de {brl(data.meta)}</span>
          </div>
          <Dica texto={dicaCampo("/dashboard", "meta_pago")}>
            <span className="text-sm font-semibold tabular-nums">{pctDaMeta}% da meta paga</span>
          </Dica>
        </div>

        <BarraDeMeta meta={data} />

        <div>
          <p className={cn("text-sm font-semibold", data.nivel === "nenhum" ? "" : estilo.texto)}>{f.titulo}</p>
          {f.detalhe && <p className="text-sm text-muted-foreground">{f.detalhe}</p>}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <Numero rotulo="Vendido" valor={brl(data.vendido)} dica={dicaCampo("/dashboard", "meta_vendido")} />
          <Numero rotulo="Pago" valor={brl(data.pago)} dica={dicaCampo("/dashboard", "meta_pago")} />
          <Numero
            rotulo={data.nivel === "nenhum" ? "Ritmo por dia útil" : "Comissão do mês"}
            valor={data.nivel === "nenhum" ? (data.ritmo_por_dia_util != null ? brl(data.ritmo_por_dia_util) : "—") : brl(data.comissao_atual)}
            dica={dicaCampo("/dashboard", data.nivel === "nenhum" ? "meta_ritmo" : "meta_comissao")}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Ouro: {data.pct_ouro.toLocaleString("pt-BR")}% da OS ({brl(data.ouro_em)}) · Diamante: {data.pct_diamante.toLocaleString("pt-BR")}% da OS ({brl(data.diamante_em)}). O nível vale para todas as OS pagas do mês e é pago no fechamento.
        </p>
      </CardContent>
    </Card>
  );
}

function Numero({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <Dica texto={dica} className="block">
      <div className="w-full rounded-lg border border-border p-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</div>
        <div className="font-mono text-sm font-bold tabular-nums">{valor}</div>
      </div>
    </Dica>
  );
}
