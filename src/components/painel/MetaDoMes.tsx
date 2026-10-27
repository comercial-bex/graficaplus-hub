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
import { metaGeralDaEquipe, useMetasDaEquipe } from "@/hooks/useMetasDaEquipe";
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
  /** Dia de hoje no relógio de Macapá ("2026-10-26"), o mesmo que a conta usou para os dias corridos. */
  hoje?: string;
  /** Orçamentos aprovados no mês + OS do mês que não vieram de orçamento. */
  vendido?: number;
  orcamentos_aprovados_n?: number;
  /** Dinheiro que entrou no mês (pagamentos pagos, sem estorno). */
  recebido?: number;
  os_concluidas_n?: number;
  os_abertas_n?: number;
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

  // A meta GERAL do mês (27/10/2026: R$ 40 mil = a soma das metas de cada vendedor). O ponto de equilíbrio
  // continua, mas como marco dentro da barra: é o mínimo para pagar as contas, não o objetivo.
  const { data: metasDaEquipe } = useMetasDaEquipe(canSeeFinancials);

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
  // 24/10/2026: a barra media só o que foi CONCLUÍDO (R$ 121 em outubro), com R$ 5,4 mil
  // de orçamentos aprovados e R$ 3,1 mil recebidos no mesmo mês. Agora são três
  // medidas lado a lado: vendido (o que o cliente aprovou), recebido (o que
  // entrou no caixa, que é o que paga a conta) e concluído (a OS entregue e
  // fechada). A principal é o vendido; as outras explicam o resto.
  const concluido = num(data.realizado);
  const vendido = num(data.vendido ?? data.realizado);
  const recebido = num(data.recebido);
  const custoFixo = num(data.custo_fixo);
  const diasNoMes = num(data.dias_no_mes);
  const diasCorridos = num(data.dias_corridos);

  const metaGeral = metaGeralDaEquipe(metasDaEquipe);
  const temEquilibrio = meta != null && meta > 0;
  // A barra mede contra a meta geral; sem metas por vendedor, volta para o ponto de equilíbrio.
  const metaDaBarra = metaGeral > 0 ? metaGeral : temEquilibrio ? meta : 0;
  const temMeta = metaDaBarra > 0;
  const pctDaMeta = (v: number) => (temMeta ? Math.round((1000 * v) / metaDaBarra) / 10 : 0);
  const atingido = pctDaMeta(vendido);
  const faltaVender = temMeta ? Math.max(metaDaBarra - vendido, 0) : null;
  const faltaVenderParaEmpatar = temEquilibrio ? Math.max(meta - vendido, 0) : null;
  const faltaReceber = temEquilibrio ? Math.max(meta - recebido, 0) : null;
  const bateu = temMeta && faltaVender === 0;
  // Onde o ponto de equilíbrio cai na barra da meta geral (só aparece quando a barra é maior que ele).
  const marcoEquilibrio = temEquilibrio && temMeta && metaDaBarra > meta ? (100 * meta) / metaDaBarra : null;

  // Ritmo: o mês já andou X% dos dias, a venda devia ter andado o mesmo.
  const esperado = diasNoMes > 0 ? (100 * diasCorridos) / diasNoMes : 0;
  const atrasado = atingido < esperado;
  const diasRestantes = Math.max(diasNoMes - diasCorridos, 0);
  const [, mesDeHoje, diaDeHoje] = String(data.hoje ?? "").slice(0, 10).split("-");
  const hojeCurto = mesDeHoje && diaDeHoje ? `${diaDeHoje}/${mesDeHoje}` : "";

  // Barra: verde = já entrou no caixa, azul = vendido e ainda a receber (completa até o vendido) e
  // vermelho = o que falta vender para bater a meta. Meta batida: a barra inteira fica verde.
  const fatiaRecebido = temMeta ? Math.min((100 * Math.min(recebido, vendido)) / metaDaBarra, 100) : 0;
  const fatiaVendido = temMeta ? Math.max(Math.min((100 * vendido) / metaDaBarra, 100) - fatiaRecebido, 0) : 0;
  const fatiaFalta = temMeta ? Math.max(100 - fatiaRecebido - fatiaVendido, 0) : 0;

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
          {mesPorExtenso(data.mes)} ·{" "}
          {metaGeral > 0 ? (
            <>
              meta geral <strong className="text-foreground">{brl(metaGeral)}</strong> (a soma das metas de cada vendedor). Só para
              pagar {brl(custoFixo)} de custo fixo com {pct(num(data.margem_contribuicao_pct))} de margem, precisa vender{" "}
              <strong className="text-foreground">{temEquilibrio ? brl(meta) : "—"}</strong>.
            </>
          ) : (
            <>
              precisa vender <strong className="text-foreground">{temEquilibrio ? brl(meta) : "—"}</strong> para pagar{" "}
              {brl(custoFixo)} de custo fixo com {pct(num(data.margem_contribuicao_pct))} de margem.
            </>
          )}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Sem margem de contribuição não existe meta: dizer isso é melhor do
            que desenhar uma barra em cima de um número que não existe. */}
        {!temEquilibrio ? (
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
                  {brl(vendido)}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">vendido no mês</span>
                </span>
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {pct(atingido)} de {brl(meta)}
                </span>
              </div>

              {/* Barra própria em vez do Progress da ui: são três fatias e cores da casa. O vermelho é o
                  que falta; o marcador é o ponto de equilíbrio (o mínimo para pagar as contas). */}
              <div className="relative pb-5">
                <div
                  className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`${pct(atingido)} da meta vendidos; ${pct(pctDaMeta(recebido))} recebidos; faltam ${pct(Math.max(100 - atingido, 0))}`}
                >
                  <div
                    className={cn("h-full", bateu ? "bg-emerald-500" : "bg-[color:var(--bex-lime)]")}
                    style={{ width: `${fatiaRecebido}%` }}
                  />
                  <div
                    className="h-full bg-[color:var(--bex-cyan)]/60"
                    style={{ width: `${fatiaVendido}%` }}
                  />
                  <div className="h-full bg-red-500/75" style={{ width: `${fatiaFalta}%` }} />
                </div>
                {marcoEquilibrio != null && (
                  <div
                    className="pointer-events-none absolute top-[-3px] flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${marcoEquilibrio}%` }}
                    aria-hidden="true"
                  >
                    <span className="h-[18px] w-0.5 rounded bg-foreground/80" />
                    <span className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
                      empata em {brl(meta ?? 0)}
                    </span>
                  </div>
                )}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[color:var(--bex-lime)]" /> recebido</li>
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[color:var(--bex-cyan)]/60" /> vendido, a receber</li>
                <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500/75" /> falta vender</li>
              </ul>
            </div>

            {/* As três medidas, cada uma com a sua régua contra a meta. */}
            <dl className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--bex-cyan)]/60" /> Vendido
                </dt>
                <dd className="font-mono text-lg font-bold tabular-nums">{brl(vendido)}</dd>
                <dd className="text-xs text-muted-foreground">
                  {num(data.orcamentos_aprovados_n)} orçamento(s) aprovado(s) · {pct(pctDaMeta(vendido))} da meta
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--bex-lime)]" /> Recebido
                </dt>
                <dd className="font-mono text-lg font-bold tabular-nums">{brl(recebido)}</dd>
                <dd className="text-xs text-muted-foreground">entrou no caixa · {pct(pctDaMeta(recebido))} da meta</dd>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60" /> Concluído
                </dt>
                <dd className="font-mono text-lg font-bold tabular-nums">{brl(concluido)}</dd>
                <dd className="text-xs text-muted-foreground">
                  {num(data.os_concluidas_n)} OS fechada(s) · {num(data.os_abertas_n)} aberta(s)
                </dd>
              </div>
            </dl>

            {/* O número em destaque: o que falta para empatar. */}
            {bateu ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                <p className="text-sm font-semibold text-foreground">
                  Meta de vendas batida. Falta receber {brl(faltaReceber)} para o caixa pagar as contas do mês.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {faltaVenderParaEmpatar != null && metaGeral > 0 && (
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Faltam vender para empatar</p>
                    <p className={cn("font-mono text-2xl font-bold tabular-nums", faltaVenderParaEmpatar > 0 ? "text-red-500" : "text-emerald-500")}>
                      {faltaVenderParaEmpatar > 0 ? brl(faltaVenderParaEmpatar) : "Empatou"}
                    </p>
                  </div>
                )}
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {metaGeral > 0 ? `Faltam vender para a meta de ${brl(metaGeral)}` : "Faltam vender para empatar"}
                  </p>
                  <p className="font-mono text-2xl font-bold tabular-nums text-red-500">{brl(faltaVender)}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Faltam receber para pagar as contas</p>
                  <p className={cn("font-mono text-2xl font-bold tabular-nums", (faltaReceber ?? 0) > 0 ? "text-red-500" : "text-emerald-500")}>
                    {faltaReceber != null && faltaReceber > 0 ? brl(faltaReceber) : "Pagas"}
                  </p>
                </div>
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
                  {/* `dias_corridos` conta os dias JÁ FECHADOS (no dia 7 vale 6) e é contado no
                      relógio de Macapá (até 27/10/2026 era UTC: depois das 21h o painel já
                      "andava um dia"). Com a data de hoje escrita, quem lê confere sozinho. */}
                  <span className="text-muted-foreground">
                    {hojeCurto ? `Hoje é ${hojeCurto}. ` : ""}
                    {diasCorridos === 1
                      ? `1 de ${diasNoMes} dias do mês já fechou`
                      : `${diasCorridos} de ${diasNoMes} dias do mês já fecharam`}
                    : o esperado até ontem era {pct(esperado)} da meta e o vendido está em {pct(atingido)}.
                    {faltaVenderParaEmpatar != null && faltaVenderParaEmpatar > 0 && diasRestantes > 0
                      ? ` Para empatar faltam ${brl(faltaVenderParaEmpatar)}: cerca de ${brl(faltaVenderParaEmpatar / diasRestantes)} por dia nos ${diasRestantes} dias que restam, contando hoje.`
                      : ""}
                    {metaGeral > 0 && faltaVender != null && faltaVender > 0 && diasRestantes > 0
                      ? ` Para a meta geral, ${brl(faltaVender / diasRestantes)} por dia.`
                      : ""}
                  </span>
                </span>
              </div>
            )}

            {/* Concluído muito abaixo do vendido quase sempre é OS que ninguém
                fechou no sistema, não mês sem trabalho. */}
            {vendido > 0 && concluido < vendido / 2 && (
              <PorQueZero
                texto={`Só ${brl(concluido)} estão concluídos porque ${num(data.os_concluidas_n)} de ${num(data.os_concluidas_n) + num(data.os_abertas_n)} OS foram fechadas no sistema. O resto está vendido mas parado no quadro: mover a OS e fechar no fim é o que leva o valor para "Concluído" e avisa o cliente.`}
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
