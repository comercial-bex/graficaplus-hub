import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Lock,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/a-receber")({
  head: () => ({ meta: [{ title: "Contas a receber — BEX PRINT OS" }] }),
  component: AReceberPage,
});

/* ------------------------------------------------------------------ */
/* O que a função do banco devolve                                     */
/* ------------------------------------------------------------------ */

type Parcela = {
  parcela_id: string;
  numero: number;
  valor: number;
  vencimento: string | null;
  /** `prevista` ou `paga`. */
  status: string;
  atrasada: boolean;
};

type Conta = {
  conta_id: string;
  /** `previsto` (nada pago) · `parcial` · `recebido`. */
  status: string;
  valor_total: number;
  created_at: string | null;
  os_id: string | null;
  os_numero: number | string | null;
  os_titulo: string | null;
  cliente_id: string | null;
  cliente: string | null;
  vencimento_mais_antigo: string | null;
  recebido: number;
  a_receber: number;
  vencido: number;
  parcelas: Parcela[];
};

type Resumo = {
  hoje: string;
  total_a_receber: number;
  total_vencido: number;
  total_recebido: number;
  contas: Conta[];
};

const MEIOS = [
  ["pix", "Pix"],
  ["dinheiro", "Dinheiro"],
  ["cartao", "Cartão"],
  ["boleto", "Boleto"],
  ["transferencia", "Transferência"],
] as const;

const brl = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Data sem hora lida como UTC volta um dia atrás no fuso de Macapá. O meio-dia
 * fixo tira a data do alcance do deslocamento.
 */
const dia = (d: string | null | undefined) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR") : "—";

const hojeISO = () => {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * As duas funções desta tela foram aplicadas por migração e o `types.ts` é
 * gerado pelo Lovable — ele ainda não as conhece, então `supabase.rpc` recusa o
 * nome. Esta assinatura é o mesmo escape usado no resto do projeto, só que sem
 * `any`: o que volta continua sendo tratado como desconhecido e validado aqui.
 */
type RpcSemTipo = (
  nome: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

const rpc = supabase.rpc as unknown as RpcSemTipo;

/**
 * Contas a receber.
 *
 * Até aqui a gráfica não tinha uma tela para a pergunta mais simples do caixa:
 * o que já foi entregue e ainda não foi pago. A cobrança só existia impressa
 * dentro do PDF da OS — ou seja, ninguém conseguia olhar o total, ninguém via o
 * que estava vencido e dar baixa era editar registro na mão.
 *
 * A conta a receber nasce quando o orçamento vira OS, e ela é a obrigação
 * inteira; as parcelas são os pedaços que vencem. O status da conta não é
 * digitado: um gatilho no banco move a conta para `parcial` ou `recebido`
 * conforme as parcelas caem, então aqui só se confirma o pagamento da parcela.
 */
function AReceberPage() {
  const qc = useQueryClient();
  const { canSeeFinancials, hasPermission } = useAuth();
  const podeDarBaixa = hasPermission("pagamentos.confirm");

  const [incluirQuitadas, setIncluirQuitadas] = useState(false);

  // Parcela escolhida para baixa + a conta dela (para o diálogo mostrar de quem é).
  const [baixa, setBaixa] = useState<{ conta: Conta; parcela: Parcela } | null>(null);
  const [valor, setValor] = useState("");
  const [meio, setMeio] = useState<string>("pix");
  const [data, setData] = useState(hojeISO());
  const [referencia, setReferencia] = useState("");

  /**
   * Papel sem visão financeira NÃO chama a função: ela levanta 42501 e o erro
   * derrubaria a tela inteira em vez de mostrar o aviso de permissão.
   */
  const {
    data: resumo,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["contas-a-receber", incluirQuitadas],
    enabled: canSeeFinancials,
    queryFn: async (): Promise<Resumo> => {
      const { data: r, error: e } = await rpc("contas_a_receber", {
        p_incluir_quitadas: incluirQuitadas,
      });
      if (e) throw e;
      const bruto = (r ?? {}) as Record<string, unknown>;
      return {
        hoje: String(bruto.hoje ?? hojeISO()),
        total_a_receber: num(bruto.total_a_receber),
        total_vencido: num(bruto.total_vencido),
        total_recebido: num(bruto.total_recebido),
        contas: ((bruto.contas ?? []) as Conta[]).map((c) => ({
          ...c,
          valor_total: num(c.valor_total),
          recebido: num(c.recebido),
          a_receber: num(c.a_receber),
          vencido: num(c.vencido),
          parcelas: (c.parcelas ?? []).map((p) => ({ ...p, valor: num(p.valor) })),
        })),
      };
    },
  });

  const confirmar = useMutation({
    mutationFn: async (v: {
      parcela_id: string;
      valor: number;
      meio: string;
      data: string;
      referencia: string | null;
    }) => {
      const { data: r, error: e } = await rpc("confirmar_pagamento", {
        p_parcela_id: v.parcela_id,
        p_valor: v.valor,
        p_meio: v.meio,
        p_data: v.data,
        p_referencia_externa: v.referencia,
      });
      if (e) throw e;
      return r;
    },
    onSuccess: (r) => {
      const n = baixa?.parcela.numero;
      // A função aceita recebimento PARCIAL: só quita a parcela quando o
      // somado alcança o valor dela. Dizer "recebida" num pagamento pela
      // metade seria a mentira mais cara desta tela.
      const res = r as { quitou?: boolean; falta?: number | string } | null;
      const falta = Number(res?.falta ?? 0);
      if (res?.quitou === false && falta > 0) {
        toast.success(
          n
            ? `Parcela ${n}: recebimento parcial. Ainda faltam ${brl(falta)}.`
            : `Recebimento parcial. Ainda faltam ${brl(falta)}.`,
        );
      } else {
        toast.success(n ? `Parcela ${n} recebida` : "Parcela recebida");
      }
      qc.invalidateQueries({ queryKey: ["contas-a-receber"] });
      // O painel de pendências usa a chave longa; a curta fica aqui porque é a
      // combinada com as outras telas desta onda.
      qc.invalidateQueries({ queryKey: ["pendencias"] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
      qc.invalidateQueries({ queryKey: ["ponto-de-equilibrio"] });
      setBaixa(null);
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  function abrirBaixa(conta: Conta, parcela: Parcela) {
    setBaixa({ conta, parcela });
    setValor(String(parcela.valor));
    setMeio("pix");
    setData(hojeISO());
    setReferencia("");
  }

  /* ---------------------------------------------------------------- */
  /* Sem visão financeira: a tela existe, mas não mostra número nenhum */
  /* ---------------------------------------------------------------- */
  if (!canSeeFinancials) {
    return (
      <div className="space-y-6">
        <SectionHeader
          breadcrumb="Financeiro"
          title="Contas a receber"
          description="O que a gráfica já entregou e ainda não recebeu, por cliente e por parcela."
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="h-4 w-4 text-muted-foreground" />
              Cobrança é do financeiro
            </div>
            {/* Melhor dizer que o número existe e não é seu do que mostrar zero:
                zero por falta de permissão é mentira, não informação. */}
            <p className="max-w-prose text-sm text-muted-foreground">
              Quem acompanha o que os clientes devem e quem dá baixa nos recebimentos é o
              financeiro. Seu acesso não inclui valores de cobrança, então esta tela não carrega
              nada — não é que não haja conta a receber.
            </p>
            <Button asChild variant="outline" className="min-h-11 md:min-h-9">
              <Link to="/dashboard">Voltar para o painel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const contas = resumo?.contas ?? [];
  const emAberto = contas.filter((c) => c.status !== "recebido").length;

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Financeiro"
        title="Contas a receber"
        description="O que a gráfica já entregou e ainda não recebeu, por cliente e por parcela."
        ajuda="A conta a receber nasce quando o orçamento vira OS. Cada parcela vence sozinha; ao confirmar o recebimento de uma parcela, o próprio banco move a conta para parcial ou recebido."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            <Button
              size="sm"
              variant={incluirQuitadas ? "ghost" : "secondary"}
              className="min-h-11 md:min-h-9"
              onClick={() => setIncluirQuitadas(false)}
            >
              Em aberto
            </Button>
            <Button
              size="sm"
              variant={incluirQuitadas ? "secondary" : "ghost"}
              className="min-h-11 md:min-h-9"
              onClick={() => setIncluirQuitadas(true)}
            >
              Todas
            </Button>
          </div>
        }
      />

      {/* Enquanto a função não respondeu (carregando ou erro) os cartões mostram
          "—", nunca R$ 0,00: zero aqui seria a gráfica ler "ninguém me deve"
          quando na verdade a consulta não voltou. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="A receber" value={brl(resumo?.total_a_receber)} icon={Wallet} />
        <KpiCard
          label="Vencido"
          value={brl(resumo?.total_vencido)}
          icon={AlertTriangle}
          tone={resumo && resumo.total_vencido > 0 ? "amber" : "muted"}
          hint={resumo ? (resumo.total_vencido > 0 ? "cobrar hoje" : "nada vencido") : undefined}
        />
        <KpiCard
          label="Recebido"
          value={brl(resumo?.total_recebido)}
          icon={CircleDollarSign}
          tone="lime"
        />
        <KpiCard
          label="Contas em aberto"
          value={resumo ? String(emAberto) : "—"}
          icon={ReceiptText}
          tone="muted"
        />
      </div>

      {!podeDarBaixa && (
        <p className="text-sm text-muted-foreground">
          Você enxerga a cobrança, mas quem dá baixa em recebimento é o financeiro (ou o admin) —
          por isso o botão de baixa não aparece aqui.
        </p>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="p-5 text-sm text-destructive">
            Não deu para carregar as contas a receber: {mensagemErro(error)}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Carregando…</CardContent>
        </Card>
      ) : error ? null : contas.length === 0 ? (
        /* Consulta que falhou não é lista vazia: sem esta saída a tela dizia
           "nada a receber, nenhum orçamento virou OS" logo abaixo do aviso de
           erro — explicação errada para uma cobrança que existe. */
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {incluirQuitadas ? "Nenhuma conta a receber registrada" : "Nada a receber no momento"}
            </div>
            {/* Estado vazio que diz POR QUE está vazio e para onde ir: sem isso,
                a tela em branco parece defeito do sistema. */}
            <p className="max-w-prose text-sm text-muted-foreground">
              A conta a receber nasce quando um orçamento é aprovado e vira OS — é o fechamento do
              orçamento que define o valor e as parcelas. Enquanto nenhum orçamento virar OS, não há
              o que cobrar.
              {!incluirQuitadas && " Se alguma já foi paga, ela aparece no filtro Todas."}
            </p>
            <Button asChild variant="outline" className="min-h-11 md:min-h-9">
              <Link to="/orcamentos">Ver orçamentos</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {(resumo?.total_vencido ?? 0) === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span>
                <strong>Nada vencido.</strong> Todas as parcelas em aberto ainda estão dentro do
                prazo — não há cobrança atrasada hoje.
              </span>
            </div>
          )}

          <div className="space-y-3">
            {/* A ordem vem da função: quem tem a parcela em aberto mais antiga
                aparece primeiro, porque é quem precisa de cobrança antes. */}
            {contas.map((c) => (
              <ContaCard
                key={c.conta_id}
                conta={c}
                podeDarBaixa={podeDarBaixa}
                onBaixa={(p) => abrirBaixa(c, p)}
              />
            ))}
          </div>
        </>
      )}

      <Dialog open={!!baixa} onOpenChange={(v) => !v && setBaixa(null)}>
        <DialogContent className="max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              Dar baixa na parcela {baixa?.parcela.numero} de {baixa?.conta.parcelas.length}
            </DialogTitle>
            <DialogDescription>
              {baixa?.conta.cliente ?? "Cliente sem nome"}
              {baixa?.conta.os_numero ? ` · OS #${baixa.conta.os_numero}` : ""} · vence{" "}
              {dia(baixa?.parcela.vencimento)}. Confirmar o recebimento registra o pagamento e fecha
              a parcela — a conta se ajusta sozinha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Valor recebido</Label>
              {/* text-base no celular: abaixo de 16px o iOS dá zoom ao focar. */}
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                className="h-11 font-mono text-base md:h-9 md:text-sm"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Vem preenchido com o valor da parcela. Mude se o cliente pagou um valor diferente do
                combinado.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Como o cliente pagou</Label>
              <Select value={meio} onValueChange={setMeio}>
                <SelectTrigger className="h-11 text-base md:h-9 md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEIOS.map(([v, r]) => (
                    <SelectItem key={v} value={v}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Dia em que o dinheiro entrou</Label>
              <Input
                type="date"
                className="h-11 text-base md:h-9 md:text-sm"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Referência (opcional)</Label>
              <Input
                className="h-11 text-base md:h-9 md:text-sm"
                placeholder="Número do comprovante, fim do Pix, maquininha…"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="min-h-11 md:min-h-9"
              onClick={() => setBaixa(null)}
            >
              Cancelar
            </Button>
            <Button
              className="min-h-11 md:min-h-9"
              disabled={confirmar.isPending || !data || !(Number(valor.replace(",", ".")) > 0)}
              onClick={() => {
                if (!baixa) return;
                confirmar.mutate({
                  parcela_id: baixa.parcela.parcela_id,
                  valor: Number(valor.replace(",", ".")),
                  meio,
                  data,
                  referencia: referencia.trim() || null,
                });
              }}
            >
              {confirmar.isPending ? "Registrando…" : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function seloDaConta(status: string) {
  if (status === "recebido")
    return (
      <StatusChip
        label="recebido"
        tone="muted"
        className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      />
    );
  if (status === "parcial") return <StatusChip label="parcial" tone="amber" />;
  return <StatusChip label="previsto" tone="cyan" />;
}

function ContaCard({
  conta,
  podeDarBaixa,
  onBaixa,
}: {
  conta: Conta;
  podeDarBaixa: boolean;
  onBaixa: (p: Parcela) => void;
}) {
  const total = conta.parcelas.length;
  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{conta.cliente ?? "Cliente sem nome"}</h3>
              {seloDaConta(conta.status)}
            </div>
            <p className="text-sm text-muted-foreground">
              {conta.os_id ? (
                <Link to="/os/$id" params={{ id: conta.os_id }} className="hover:underline">
                  OS #{conta.os_numero ?? "—"}
                  {conta.os_titulo ? ` · ${conta.os_titulo}` : ""}
                </Link>
              ) : (
                // Conta sem OS não é erro de tela: é cobrança lançada sem origem.
                "Sem OS vinculada"
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-bold">{brl(conta.a_receber)}</div>
            <div className="text-xs text-muted-foreground">a receber</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Total da conta
            </div>
            <div className="font-mono font-bold">{brl(conta.valor_total)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Vencido
            </div>
            <div
              className={`font-mono font-bold ${conta.vencido > 0 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {conta.vencido > 0 ? brl(conta.vencido) : "—"}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Recebido
            </div>
            <div className="font-mono font-bold">{brl(conta.recebido)}</div>
          </div>
        </div>

        <ul className="space-y-2 border-t border-border pt-3">
          {conta.parcelas.map((p) => {
            const paga = p.status === "paga";
            return (
              <li
                key={p.parcela_id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
              >
                <span className={paga ? "text-muted-foreground line-through" : ""}>
                  Parcela {p.numero} de {total} · <span className="font-mono">{brl(p.valor)}</span>{" "}
                  · vence {dia(p.vencimento)}
                </span>
                {paga && <StatusChip label="paga" tone="muted" />}
                {!paga && p.atrasada && <StatusChip label="atrasada" tone="amber" />}
                {!paga && podeDarBaixa && (
                  <Button
                    size="sm"
                    variant="outline"
                    // 44px de alvo no celular: é o botão que movimenta dinheiro.
                    className="ml-auto min-h-11 md:min-h-8"
                    onClick={() => onBaixa(p)}
                  >
                    <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Dar baixa
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
