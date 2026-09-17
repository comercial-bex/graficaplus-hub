import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Send, ShoppingBag, Zap } from "lucide-react";
import { carregarPainel, CHAVE_PAINEL } from "@/lib/parceiro-api";
import { resumoDaOferta, type PainelDoParceiro } from "@/domain/parceiros/painel";
import { NivelCard } from "@/components/parceiro/nivel-card";
import { CreditoCard } from "@/components/parceiro/credito-card";
import { Metas } from "@/components/parceiro/metas";
import { Pedidos } from "@/components/parceiro/pedidos";
import { NovoOrcamento } from "@/components/parceiro/novo-orcamento";
import { PrimeirosPassos } from "@/components/parceiro/primeiros-passos";

export const Route = createFileRoute("/parceiro/")({
  component: InicioDoParceiro,
});

function InicioDoParceiro() {
  // O layout só renderiza as telas depois que o painel carregou.
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  if (!painel) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Parceiro desde {new Date(painel.parceiro.desde).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">Olá, {painel.parceiro.nome}</h1>
        </div>
        <NovoOrcamento parceiroId={painel.parceiro.id} className="w-full sm:w-auto" />
      </div>

      {!painel.parceiro.tem_atendente && (
        <div className="flex gap-3 rounded-2xl border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
          <p>
            Seu cadastro ainda não tem um atendente na gráfica. Você já pode orçar e baixar o PDF, mas o
            primeiro pedido só sai depois que a equipe indicar quem vai te atender.
          </p>
        </div>
      )}

      <PrimeirosPassos painel={painel} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <NivelCard painel={painel} />
        </div>
        <CreditoCard painel={painel} />
      </div>

      <Ofertas painel={painel} />

      <div className="grid grid-cols-3 gap-3">
        <Numero icone={FileText} rotulo="Orçamentos no mês" valor={painel.orcamentos.mes} para="/parceiro/orcamentos" />
        <Numero icone={Send} rotulo="Em aberto" valor={painel.orcamentos.abertos} para="/parceiro/orcamentos" />
        <Numero icone={ShoppingBag} rotulo="Viraram pedido" valor={painel.orcamentos.pedidos} para="/parceiro/orcamentos" />
      </div>

      <Metas campanhas={painel.campanhas} conquistas={painel.conquistas} />
      <Pedidos painel={painel} />
    </div>
  );
}

function Ofertas({ painel }: { painel: PainelDoParceiro }) {
  if (painel.ofertas.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Zap className="h-5 w-5 text-[color:var(--bex-amber)]" />
        Ofertas para você
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {painel.ofertas.map((o) => (
          <Link
            key={o.id}
            to="/parceiro/tabela"
            className="block rounded-2xl border border-[color:var(--bex-amber)]/30 bg-card p-4 transition-colors hover:border-[color:var(--bex-amber)]/70"
          >
            <p className="font-semibold">{o.titulo}</p>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{o.mensagem}</p>
            <p className="mt-2 text-sm font-medium text-[color:var(--bex-amber)]">{resumoDaOferta(o)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Numero(props: {
  icone: typeof FileText;
  rotulo: string;
  valor: number;
  para: "/parceiro/orcamentos";
}) {
  return (
    <Link
      to={props.para}
      className="rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-foreground/5 md:p-4"
    >
      <props.icone className="h-4 w-4 text-muted-foreground" />
      <p className="mt-2 text-2xl font-bold tabular-nums">{Number(props.valor)}</p>
      <p className="text-[11px] leading-tight text-muted-foreground md:text-xs">{props.rotulo}</p>
    </Link>
  );
}
