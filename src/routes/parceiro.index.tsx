/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, ShoppingCart, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { carregarPainel, CHAVE_PAINEL } from "@/lib/parceiro-api";
import { resumoDaOferta, type PainelDoParceiro } from "@/domain/parceiros/painel";
import { NivelCard } from "@/components/parceiro/nivel-card";
import { CreditoCard } from "@/components/parceiro/credito-card";
import { Metas } from "@/components/parceiro/metas";
import { Pedidos } from "@/components/parceiro/pedidos";
import { NovoOrcamento } from "@/components/parceiro/novo-orcamento";
import { PrimeirosPassos } from "@/components/parceiro/primeiros-passos";
import { ConviteCard } from "@/components/parceiro/convite-card";
import { BlocoDeAcao } from "@/components/parceiro/bloco-de-acao";

export const Route = createFileRoute("/parceiro/")({
  head: () => ({
    meta: [
      { title: "Início · Painel do parceiro Bex Print" },
      { name: "description", content: "Compre da gráfica e orce para seus clientes com preço de parceiro." },
      { property: "og:title", content: "Início · Painel do parceiro Bex Print" },
      { property: "og:description", content: "Compre da gráfica e orce para seus clientes com preço de parceiro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InicioDoParceiro,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const data = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
const STATUS: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  aprovado: "Aprovado",
  pedido: "Pedido",
  recusado: "Recusado",
};

type Linha = {
  id: string;
  numero: number;
  titulo: string | null;
  cliente_nome: string | null;
  status: string;
  created_at: string;
  venda_direta: boolean;
  pagamento_modelo: string | null;
  total_pedido: number | null;
};

function InicioDoParceiro() {
  // O layout só renderiza as telas depois que o painel carregou.
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const { data: linhas = [] } = useQuery({
    queryKey: ["parceiro-inicio-blocos"],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase as any)
        .from("parceiro_orcamentos")
        .select("id, numero, titulo, cliente_nome, status, created_at, venda_direta, pagamento_modelo, total_pedido")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });
  if (!painel) return null;

  const compras = linhas.filter((l) => l.venda_direta);
  const orcs = linhas.filter((l) => !l.venda_direta);
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const doMes = compras.filter((c) => new Date(c.created_at) >= inicioMes);
  const totalMes = doMes.reduce((s, c) => s + Number(c.total_pedido ?? 0), 0);
  const aPagar = compras
    .filter((c) => c.pagamento_modelo === "sinal")
    .reduce((s, c) => s + Number(c.total_pedido ?? 0) / 2, 0);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="bloco-entra flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Parceiro desde {new Date(painel.parceiro.desde).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </p>
          <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">Olá, {painel.parceiro.nome}</h1>
        </div>
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

      <div className="grid gap-4 lg:grid-cols-2 md:gap-6">
        <BlocoDeAcao
          cor="venda"
          icone={ShoppingCart}
          sobretitulo="Venda direta"
          titulo="Comprar da gráfica"
          acao={
            <Button asChild className="bg-[color:var(--venda)] text-[color:var(--background)] hover:bg-[color:var(--venda)]/90">
              <Link to="/parceiro/compras">Nova compra</Link>
            </Button>
          }
          numeros={[
            { rotulo: "Comprado no mês", valor: totalMes, formato: brl },
            { rotulo: "Compras no mês", valor: doMes.length },
            { rotulo: "Saldo a pagar", valor: aPagar, formato: brl },
          ]}
          linhas={compras.slice(0, 3).map((c) => ({
            id: c.id,
            titulo: `Compra #${c.numero}`,
            detalhe: data(c.created_at),
            selo: c.pagamento_modelo === "sinal" ? "Sinal 50%" : "À vista",
            valor: brl(Number(c.total_pedido ?? 0)),
            para: "/parceiro/compras",
          }))}
          vazio="Nenhuma compra ainda — faça a primeira."
          verTodos={{ rotulo: "Ver minhas compras", para: "/parceiro/compras" }}
        />
        <BlocoDeAcao
          cor="orcamento"
          icone={FileText}
          sobretitulo="Para o seu cliente"
          titulo="Orçar com a sua marca"
          atraso={90}
          acao={
            <NovoOrcamento
              parceiroId={painel.parceiro.id}
              className="bg-[color:var(--orcamento)] text-[color:var(--background)] hover:bg-[color:var(--orcamento)]/90"
            />
          }
          numeros={[
            { rotulo: "Orçamentos no mês", valor: painel.orcamentos.mes },
            { rotulo: "Em aberto", valor: painel.orcamentos.abertos },
            { rotulo: "Viraram pedido", valor: painel.orcamentos.pedidos },
          ]}
          linhas={orcs.slice(0, 3).map((o) => ({
            id: o.id,
            titulo: o.titulo || `Orçamento #${o.numero}`,
            detalhe: `${o.cliente_nome ?? "Sem cliente"} · ${data(o.created_at)}`,
            selo: STATUS[o.status] ?? o.status,
            para: `/parceiro/orcamentos/${o.id}`,
          }))}
          vazio="Nenhum orçamento ainda — crie o primeiro."
          verTodos={{ rotulo: "Ver todos os orçamentos", para: "/parceiro/orcamentos" }}
        />
      </div>

      <PrimeirosPassos painel={painel} />

      <div className="grid gap-4 md:gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <NivelCard painel={painel} />
        </div>
        <CreditoCard painel={painel} />
      </div>

      <Ofertas painel={painel} />

      <div className="grid gap-4 md:gap-6 2xl:grid-cols-2">
        <ConviteCard painel={painel} />
        <Metas campanhas={painel.campanhas} conquistas={painel.conquistas} />
      </div>
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
      <p className="text-xs leading-tight text-muted-foreground md:text-xs">{props.rotulo}</p>
    </Link>
  );
}
