import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Target, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { brl } from "@/domain/parceiros/preco";
import { cn } from "@/lib/utils";

/**
 * "Meta do mês" — quanto a gráfica precisa faturar para empatar.
 *
 * É o primeiro bloco do painel de quem responde pelo dinheiro (admin, gestor,
 * financeiro), antes de qualquer KPI: a pergunta que o dono faz ao abrir o
 * sistema não é "quantas OS estão abertas", é "estou pagando as contas deste
 * mês?". A conta vem inteira da RPC `ponto_de_equilibrio()`: custo fixo do mês
 * dividido pela margem de contribuição.
 *
 * REGRA DA CASA: número de dinheiro só para quem tem `canSeeFinancials`. A RPC
 * levanta 42501 para os demais, então o bloco nem chega a chamá-la — some por
 * inteiro, sem cartão vazio nem zero mentiroso no lugar.
 *
 * A outra regra é não mentir com número vazio. A gráfica mal começou a usar o
 * sistema: o realizado do mês é R$ 0 porque nenhuma OS foi fechada, não porque
 * não houve trabalho. Toda vez que um número sai zero por falta de cadastro, o
 * bloco diz POR QUE e abre o caminho para resolver.
 */

type PontoDeEquilibrio = {
  mes: string;
  custo_fixo: number;
  material_pct: number;
  perda_pct: number;
  falha_pct: number;
  imposto_pct: number;
  cartao_pct: number;
  custo_variavel_pct: number;
  margem_contribuicao_pct: number;
  /** Nulo quando o custo variável come a venda inteira — aí não existe meta. */
  meta_faturamento: number | null;
  realizado: number;
  em_producao: number;
  falta: number | null;
  atingido_pct: number;
  dias_no_mes: number;
  dias_corridos: number;
};

const num = (v: unknown): number => Number(v ?? 0);

/** "73,3%" — uma casa, como o resto do sistema. */
function pct(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * "setembro de 2026" a partir de "2026-09-01".
 *
 * O meio-dia é obrigatório: data sem hora é lida como UTC e, no fuso de
 * Brasília, vira o dia anterior — o mês inteiro sairia errado na virada.
 */
function mesPorExtenso(mes: string | null | undefined): string {
  if (!mes) return "";
  const d = new Date(`${String(mes).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/**
 * Linha de aviso com caminho clicável: zero sempre vem com o que fazer.
 *
 * O âmbar é o `amber-500` do Tailwind, não `--bex-amber`. Os dois tokens da
 * casa (`--bex-lime` e `--bex-amber`) apontam para a MESMA cor, #f5d90a — usar
 * o token aqui deixaria alerta e "deu certo" idênticos na tela, que é
 * exatamente o sinal que este bloco existe para dar. É o mesmo `amber-500` do
 * aviso de fila parada que já está no painel.
 */
function PorQueZero({
  texto,
  para,
  acao,
}: {
  texto: string;
  para: "/os" | "/compromissos" | "/precificacao";
  acao: string;
}) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm leading-relaxed text-foreground">{texto}</p>
      <Link
        to={para}
        className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--bex-cyan)] underline-offset-4 hover:underline"
      >
        {acao}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export function MetaDoMes({ className }: { className?: string }) {
  const { canSeeFinancials } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["ponto-de-equilibrio"],
    // Sem permissão a RPC levanta 42501: nem chamamos.
    enabled: canSeeFinancials,
    queryFn: async (): Promise<PontoDeEquilibrio> => {
      const { data: d, error: e } = await (supabase.rpc as any)("ponto_de_equilibrio");
      if (e) throw e;
      return d as PontoDeEquilibrio;
    },
  });

  useEffect(() => {
    if (error) toast.error(mensagemErro(error));
  }, [error]);

  if (!canSeeFinancials) return null;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-3 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            Não deu para calcular a meta do mês. {mensagemErro(error)}
          </p>
        </CardContent>
      </Card>
    );
  }

  const meta = data.meta_faturamento == null ? null : num(data.meta_faturamento);
  const realizado = num(data.realizado);
  const emProducao = num(data.em_producao);
  const custoFixo = num(data.custo_fixo);
  const diasNoMes = num(data.dias_no_mes);
  const diasCorridos = num(data.dias_corridos);
  const atingido = num(data.atingido_pct);

  const temMeta = meta != null && meta > 0;
  const falta = temMeta ? Math.max(meta - realizado, 0) : null;
  const bateu = temMeta && falta === 0;

  // Ritmo: o mês já andou X% dos dias, o faturamento devia ter andado o mesmo.
  const esperado = diasNoMes > 0 ? (100 * diasCorridos) / diasNoMes : 0;
  const atrasado = atingido < esperado;

  // Barra em duas fatias: o que já fechou e o que ainda está na oficina. O
  // segundo não conta como realizado — só mostra o que pode virar.
  const fatiaRealizado = temMeta ? Math.min((100 * realizado) / meta, 100) : 0;
  const fatiaEmProducao = temMeta
    ? Math.min((100 * emProducao) / meta, 100 - fatiaRealizado)
    : 0;

  return (
    <Card className={cn("border-l-4 border-l-[color:var(--bex-cyan)]", className)}>
      <CardHeader className="gap-2 pb-3">
        {/* No celular o link desce: lado a lado em 375px o título quebrava. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            Meta do mês
          </CardTitle>
          <Link
            to="/meta"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[color:var(--bex-cyan)] underline-offset-4 hover:underline"
          >
            ver a conta
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          {mesPorExtenso(data.mes)} · precisa faturar{" "}
          <strong className="text-foreground">{temMeta ? brl(meta) : "—"}</strong> para pagar{" "}
          {brl(custoFixo)} de custo fixo com {pct(num(data.margem_contribuicao_pct))} de margem.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Sem margem de contribuição não existe meta: dizer isso é melhor do
            que desenhar uma barra em cima de um número que não existe. */}
        {meta == null ? (
          <PorQueZero
            texto={`A conta não fecha: material, perda, falha, imposto e cartão somam ${pct(num(data.custo_variavel_pct))} do preço de venda. Não sobra nada para pagar o custo fixo, então não há meta possível com esses números.`}
            para="/precificacao"
            acao="Rever a precificação"
          />
        ) : custoFixo === 0 ? (
          <PorQueZero
            texto="Nenhuma conta a pagar vence neste mês, então a meta ficou em zero. Não é que a gráfica não tenha despesa — é que aluguel, energia, salários e parcelas ainda não estão cadastrados."
            para="/compromissos"
            acao="Cadastrar as contas do mês"
          />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-mono text-3xl font-bold tabular-nums text-foreground">
                  {brl(realizado)}
                </span>
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {pct(atingido)} de {brl(meta)}
                </span>
              </div>

              {/* Barra própria em vez do Progress da ui: são duas fatias e
                  cores da casa, e o Progress só pinta uma em bg-primary. */}
              <div
                className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${pct(atingido)} da meta do mês`}
              >
                <div
                  className={cn("h-full", bateu ? "bg-emerald-500" : "bg-[color:var(--bex-lime)]")}
                  style={{ width: `${fatiaRealizado}%` }}
                />
                <div
                  className="h-full bg-[color:var(--bex-cyan)]/35"
                  style={{ width: `${fatiaEmProducao}%` }}
                />
              </div>

              {emProducao > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[color:var(--bex-cyan)]/35 align-middle" />
                  {brl(emProducao)} em produção — entra na conta quando a OS for concluída ou
                  faturada.
                </p>
              )}
            </div>

            {/* O número em destaque: o que falta para empatar. */}
            {bateu ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                <p className="text-sm font-semibold text-foreground">
                  Meta batida. Daqui para a frente o mês é lucro.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Faltam para empatar
                </p>
                <p className="font-mono text-2xl font-bold tabular-nums text-amber-500">
                  {brl(falta)}
                </p>
              </div>
            )}

            {/* Ritmo: só faz sentido depois que o mês começou a andar. No dia 1
                `dias_corridos` é 0 e o esperado é 0% — todo mundo estaria "no
                ritmo", o que não informa nada. */}
            {diasCorridos > 0 && (
              <div
                className={cn(
                  "flex items-start gap-2 text-sm",
                  atrasado ? "text-amber-500" : "text-emerald-500",
                )}
              >
                {atrasado ? (
                  <TrendingDown className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>
                  <strong>{atrasado ? "Atrás do ritmo do mês" : "No ritmo"}.</strong>{" "}
                  <span className="text-muted-foreground">
                    Dia {diasCorridos} de {diasNoMes}: o esperado até hoje era {pct(esperado)} da
                    meta.
                  </span>
                </span>
              </div>
            )}

            {/* Zero honesto: realizado R$ 0 com custo fixo cadastrado quase
                sempre é OS que ninguém fechou, não mês sem trabalho. */}
            {realizado === 0 && (
              <PorQueZero
                texto="Nenhuma OS foi concluída ou faturada neste mês, por isso o realizado está em R$ 0. O que já foi entregue só entra na conta depois de fechar a OS."
                para="/os"
                acao="Ver as ordens de serviço"
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
