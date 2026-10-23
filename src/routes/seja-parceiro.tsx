import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgePercent, FileText, Gift, HandCoins, LogIn, Send, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LOGO_FUNDO_ESCURO } from "@/lib/marca";
import { ThemeToggle } from "@/components/bex/ThemeToggle";

/**
 * A página que explica a parceria (22/10/2026), para mandar a quem a gráfica
 * quer como parceiro ou terceirizado: como funciona, o que o parceiro ganha e
 * por onde entrar.
 *
 * Os níveis e as regras vêm do cadastro do programa (`programa_parceiros_publico`),
 * o mesmo que o dono edita na tela de Parceiros: o que mudar lá muda aqui, e a
 * página não tem número para envelhecer. A função devolve só o programa — nenhum
 * dado de parceiro, cliente ou preço de produto.
 *
 * O que a página NÃO promete: o crédito de boas-vindas e o bônus de indicação só
 * existem para quem entra indicado por outro parceiro (a regra do banco exige
 * `indicado_por`); quem entra pelo convite da casa tem a tabela de parceiro e o
 * crédito por pedido pago, não esses dois.
 */

export const Route = createFileRoute("/seja-parceiro")({
  head: () => ({
    meta: [
      { title: "Seja parceiro — Bex Print" },
      {
        name: "description",
        content:
          "Revenda ou terceirize com a Bex Print: tabela de parceiro, orçamento com a sua marca e crédito a cada pedido pago.",
      },
    ],
  }),
  component: SejaParceiroPage,
});

type Programa = {
  niveis: {
    nome: string;
    cor: string | null;
    desconto_pct: number;
    compra_minima_90d: number;
    cashback_pct: number;
    desconto_faixa_pct: number;
  }[];
  boas_vindas: { ativa: boolean; pct: number; teto: number; validade_dias: number } | null;
  indicacao: { ativa: boolean; pct: number; teto: number; compras: number } | null;
  credito_max_pct_pedido: number | null;
};

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const PASSOS = [
  { icone: Send, titulo: "Peça o seu cadastro", texto: "Preencha o formulário com os dados da sua empresa. Leva alguns minutos." },
  { icone: ShieldCheck, titulo: "Entre na hora", texto: "Terminou o cadastro, o painel já está liberado: é só entrar com o seu e-mail e a senha." },
  { icone: FileText, titulo: "Oriente na frente do cliente", texto: "No painel você monta o orçamento com a sua marca, com o preço de parceiro, e manda em PDF." },
  { icone: HandCoins, titulo: "Peça, acompanhe e ganhe", texto: "Envie o pedido à gráfica, acompanhe a produção e acumule crédito a cada pedido pago." },
];

function SejaParceiroPage() {
  const programa = useQuery({
    queryKey: ["programa-parceiros-publico"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("programa_parceiros_publico");
      if (error) throw error;
      return data as Programa;
    },
  });
  const p = programa.data;
  const niveis = p?.niveis ?? [];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="bg-sidebar text-sidebar-foreground">
        <div className="h-1" style={{ background: "var(--gradient-cmyk)" }} aria-hidden />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <img src={LOGO_FUNDO_ESCURO} alt="Bex Print" width={1165} height={532} className="h-auto w-32 sm:w-40" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/login"
              search={{ como: "parceiro" }}
              className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-foreground/30 px-3 py-1.5 text-sm hover:bg-sidebar-foreground/10"
            >
              <LogIn className="h-4 w-4" aria-hidden /> Já sou parceiro
            </Link>
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-6 pb-14 pt-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-sidebar-foreground/70">Parceiros e terceirizados</p>
          <h1 className="mt-3 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Venda com a nossa produção e a sua marca
          </h1>
          <p className="mt-3 max-w-2xl text-pretty text-sidebar-foreground/80">
            Se você tem cliente e precisa de quem produza, a Bex Print produz. Você recebe preço de parceiro, orça com a sua
            própria marca e acompanha cada pedido pelo painel.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/convite/$codigo"
              params={{ codigo: "BEXPRINT" }}
              className="inline-flex items-center gap-2 rounded-lg bg-bex-cyan px-5 py-3 text-sm font-semibold text-black hover:opacity-90"
            >
              Quero ser parceiro <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-14 px-6 py-12">
        <section aria-labelledby="como-funciona">
          <h2 id="como-funciona" className="text-2xl font-semibold tracking-tight">
            Como funciona
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PASSOS.map((passo, i) => (
              <li key={passo.titulo} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-sm">{i + 1}</span>
                  <passo.icone className="h-5 w-5 text-muted-foreground" aria-hidden />
                </div>
                <h3 className="mt-3 font-semibold">{passo.titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{passo.texto}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="beneficios">
          <h2 id="beneficios" className="text-2xl font-semibold tracking-tight">
            O que o parceiro ganha
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <Beneficio icone={BadgePercent} titulo="Tabela de parceiro">
              Preço abaixo do balcão
              {niveis.length > 0 && ` — de ${pct(niveis[0].desconto_pct)} até ${pct(niveis[niveis.length - 1].desconto_pct)}, conforme o seu nível`}.
            </Beneficio>
            <Beneficio icone={FileText} titulo="Orçamento com a sua marca">
              O PDF sai com o seu nome e a sua logo. O seu cliente vê o seu preço, não o nosso.
            </Beneficio>
            <Beneficio icone={Gift} titulo="Crédito a cada pedido pago">
              Nos níveis acima do primeiro, uma parte de cada pedido pago volta em crédito
              {p?.credito_max_pct_pedido ? `, que pode cobrir até ${pct(p.credito_max_pct_pedido)} de um pedido` : ""}.
            </Beneficio>
            <Beneficio icone={Users} titulo="Indique outros parceiros">
              {p?.indicacao?.ativa
                ? `Cada indicado tem o seu link. Nas ${p.indicacao.compras} primeiras compras dele, ${pct(p.indicacao.pct)} voltam em crédito para você (até ${brl(p.indicacao.teto)} por indicado).`
                : "Cada parceiro tem um link para indicar outros."}
              {p?.boas_vindas?.ativa &&
                ` Quem entra indicado ganha ${pct(p.boas_vindas.pct)} da primeira compra em crédito (até ${brl(p.boas_vindas.teto)}, válido por ${p.boas_vindas.validade_dias} dias).`}
            </Beneficio>
          </ul>
        </section>

        {niveis.length > 0 && (
          <section aria-labelledby="niveis">
            <h2 id="niveis" className="text-2xl font-semibold tracking-tight">
              Os níveis
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Todo parceiro começa no primeiro nível. O nível sobe conforme o que você compra nos últimos 90 dias.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {niveis.map((n) => (
                <div key={n.nome} className="rounded-2xl border border-border bg-card p-5" style={n.cor ? { borderTopColor: n.cor, borderTopWidth: 4 } : undefined}>
                  <h3 className="text-lg font-semibold">{n.nome}</h3>
                  <p className="mt-2 font-mono text-3xl tabular-nums">{pct(n.desconto_pct)}</p>
                  <p className="text-sm text-muted-foreground">abaixo do balcão</p>
                  <dl className="mt-4 space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Compras em 90 dias</dt>
                      <dd className="font-mono tabular-nums">{n.compra_minima_90d > 0 ? `a partir de ${brl(n.compra_minima_90d)}` : "sem mínimo"}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Crédito por pedido pago</dt>
                      <dd className="font-mono tabular-nums">{n.cashback_pct > 0 ? pct(n.cashback_pct) : "—"}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>
        )}

        {programa.isError && (
          <p role="alert" className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Não foi possível carregar os níveis agora. O cadastro continua funcionando; fale com a Bex Print para saber os valores.
          </p>
        )}

        <section aria-labelledby="comecar" className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 id="comecar" className="text-2xl font-semibold tracking-tight">
            Pronto para começar?
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            O cadastro libera o seu painel na hora: é só entrar com o e-mail e a senha que você escolheu.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/convite/$codigo"
              params={{ codigo: "BEXPRINT" }}
              className="inline-flex items-center gap-2 rounded-lg bg-bex-cyan px-5 py-3 text-sm font-semibold text-black hover:opacity-90"
            >
              Quero ser parceiro <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/login" search={{ como: "parceiro" }} className="inline-flex items-center rounded-lg border border-border px-5 py-3 text-sm hover:bg-muted">
              Já sou parceiro
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">Bex Print · Macapá, Amapá</footer>
    </div>
  );
}

function Beneficio({ icone: Icone, titulo, children }: { icone: typeof Gift; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-border bg-card p-5">
      <Icone className="mt-0.5 h-5 w-5 shrink-0 text-bex-cyan" aria-hidden />
      <div>
        <h3 className="font-semibold">{titulo}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
