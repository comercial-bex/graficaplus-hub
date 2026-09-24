/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Clock,
  Lock,
  Percent,
  Target,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { brl, unidadeLegivel } from "@/domain/parceiros/preco";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/meta")({
  head: () => ({
    meta: [
      { title: "Meta do mês — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Quanto a gráfica precisa faturar para empatar no mês e quais produtos rendem mais por hora de máquina.",
      },
      { property: "og:title", content: "Meta do mês — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Ponto de equilíbrio do mês e ranking de margem por hora de máquina.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MetaPage,
});

type Equilibrio = {
  mes: string;
  custo_fixo: number;
  material_pct: number;
  perda_pct: number;
  falha_pct: number;
  imposto_pct: number;
  cartao_pct: number;
  custo_variavel_pct: number;
  margem_contribuicao_pct: number;
  /** Nulo quando a margem de contribuição é zero ou negativa: não existe meta que empate. */
  meta_faturamento: number | null;
  realizado: number;
  em_producao: number;
  falta: number;
  atingido_pct: number;
  dias_no_mes: number;
  dias_corridos: number;
};

type ProdutoMeta = {
  produto_id: string;
  nome: string;
  categoria: string | null;
  unidade: string | null;
  tempo_producao_min: number | null;
  preco_base: number;
  /**
   * R$ de margem por hora de máquina. A RPC só manda para o financeiro: é
   * margem, e ao lado do preço e do tempo entregaria o custo por subtração.
   * Ausente também quando falta tempo ou custo no cadastro.
   */
  margem_hora: number | null;
  /**
   * Em que terço do ranking a peça está (1 rende mais, 3 rende menos).
   * Calculado no banco e enviado a todo mundo que vê preço — é o que decide a
   * ordem da lista sem abrir conta nenhuma.
   */
  faixa: number | null;
  /** A RPC devolve nulo para quem não é do financeiro — a coluna simplesmente some. */
  custo_medio: number | null;
  /**
   * Custo CHEIO da peça: material + hora de máquina + mão de obra + rateio.
   * É por ele que o ranking ordena. `custo_medio` ficou como estava (só
   * material) porque o ponto de equilíbrio usa aquele, e são contas diferentes:
   * a margem de contribuição quer o custo VARIÁVEL, o ranking quer o custo real
   * da peça. Ambos do financeiro apenas.
   */
  custo_cheio: number | null;
  custo_material: number | null;
  custo_maquina: number | null;
  custo_mao_obra: number | null;
  custo_indireto: number | null;
  margem_pct: number | null;
  vendido_no_mes: number;
  sem_tempo: boolean;
  sem_custo: boolean;
  tem_maquina: boolean;
  /**
   * A composição ainda tem buraco — falta ficha de material, hora de máquina,
   * mão de obra ou rateio. Sai para TODO MUNDO: é aviso de que a margem ao lado
   * é otimista, e não revela valor nenhum.
   */
  custo_parcial: boolean;
  sem_ficha_de_material: boolean;
  sem_hora_de_maquina: boolean;
  sem_mao_de_obra: boolean;
  sem_rateio: boolean;
};

type MetaProduto = {
  mes: string;
  ver_custo: boolean;
  /**
   * Quantas funções ativas estão com encargo em 0%. É da casa, não do produto:
   * enquanto for maior que zero, a fatia "mão de obra" de TODA peça acima está
   * menor do que sai do bolso. Zero para quem não vê custo.
   */
  funcoes_sem_encargo: number;
  produtos: ProdutoMeta[];
};

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * Nome do mês sem o susto do fuso.
 *
 * A RPC devolve `mes` como DATE ("2026-09-01"). `new Date("2026-09-01")` é lido
 * como meia-noite UTC e, no fuso do Brasil, volta um dia — mostraria "agosto".
 * O meio-dia resolve sem depender de biblioteca.
 */
function nomeDoMes(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function MetaPage() {
  const { canSeeFinancials, canSeePrices } = useAuth();

  /**
   * Cada bloco tem a sua permissão e a sua consulta.
   *
   * `ponto_de_equilibrio` levanta 42501 para quem não é do financeiro, então
   * nem chamamos: erro de permissão previsível não é erro, é tela que não
   * existe para aquele perfil.
   */
  const equilibrio = useQuery({
    queryKey: ["ponto-de-equilibrio"],
    enabled: canSeeFinancials,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("ponto_de_equilibrio", {});
      if (error) throw error;
      return data as Equilibrio;
    },
  });

  const porProduto = useQuery({
    queryKey: ["meta-por-produto"],
    enabled: canSeePrices,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("meta_por_produto", {});
      if (error) throw error;
      return data as MetaProduto;
    },
  });

  useEffect(() => {
    if (equilibrio.error) toast.error(mensagemErro(equilibrio.error));
  }, [equilibrio.error]);

  useEffect(() => {
    if (porProduto.error) toast.error(mensagemErro(porProduto.error));
  }, [porProduto.error]);

  if (!canSeeFinancials && !canSeePrices) {
    return (
      <div>
        <SectionHeader ajuda={dicaTela("/meta")} breadcrumb="Comercial" title="Meta do mês" />
        <Card>
          <CardContent className="py-10 px-5 text-center space-y-3">
            <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Esta tela é do comercial e do financeiro: ela mostra preço de venda, custo fixo e
              margem. Seu perfil não vê esses números.
            </p>
            <Link
              to="/dashboard"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium"
            >
              Ir para o painel
              <ArrowRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/meta")}
        breadcrumb="Comercial"
        title="Meta do mês"
        description="Quanto precisa entrar para a gráfica empatar, e qual peça paga melhor a hora de máquina."
      />

      {canSeeFinancials && (
        <BlocoEquilibrio
          dados={equilibrio.data}
          carregando={equilibrio.isLoading}
          erro={equilibrio.error}
        />
      )}

      {canSeePrices && (
        <BlocoPorProduto
          dados={porProduto.data}
          carregando={porProduto.isLoading}
          erro={porProduto.error}
          verCusto={canSeeFinancials}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bloco 1 — Ponto de equilíbrio (financeiro)
 * ------------------------------------------------------------------ */

function BlocoEquilibrio({
  dados,
  carregando,
  erro,
}: {
  dados?: Equilibrio;
  carregando: boolean;
  erro: unknown;
}) {
  if (carregando) {
    return <p className="mb-8 text-sm text-muted-foreground">Carregando a meta...</p>;
  }
  if (erro || !dados) {
    return (
      <Card className="mb-8 border-[color:var(--bex-magenta)]/40">
        <CardContent className="p-5 text-sm">
          <p className="font-medium">A meta do mês não carregou.</p>
          <p className="text-muted-foreground">{mensagemErro(erro)}</p>
        </CardContent>
      </Card>
    );
  }

  const meta = dados.meta_faturamento;
  const temMeta = meta != null && meta > 0;

  // Faixas da barra. `em_producao` é o que já está vendido e ainda não faturou:
  // entra como faixa clara logo depois do realizado, nunca somado a ele.
  const fatiaRealizado = temMeta ? Math.min(100, (dados.realizado / meta!) * 100) : 0;
  const fatiaProducao = temMeta
    ? Math.max(0, Math.min(100 - fatiaRealizado, (dados.em_producao / meta!) * 100))
    : 0;

  // Onde o calendário está: 22 de 30 dias = 73% do mês gasto.
  const ritmoCalendario =
    dados.dias_no_mes > 0 ? (dados.dias_corridos / dados.dias_no_mes) * 100 : 0;
  // 5 pontos de folga para não gritar "atrasado" por arredondamento.
  const atrasado = temMeta && dados.atingido_pct < ritmoCalendario - 5;

  return (
    <section className="mb-10">
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 shadow-lg">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Ponto de equilíbrio
        </p>

        {temMeta ? (
          <>
            <p className="mt-2 text-3xl md:text-5xl font-bold tracking-tight">{brl(meta!)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              para empatar em {nomeDoMes(dados.mes)}
            </p>
          </>
        ) : (
          /* Margem de contribuição zerada ou negativa: nenhum faturamento empata,
             porque cada venda já sai no vermelho. Dizer isso é mais honesto do
             que estampar um número gigante que não significa nada. */
          <div className="mt-2 rounded-lg border border-[color:var(--bex-magenta)]/40 bg-[color:var(--bex-magenta)]/5 p-3 text-sm">
            <p className="font-medium">Não existe meta que empate com os números de hoje.</p>
            <p className="text-muted-foreground">
              A margem de contribuição está em {pct(dados.margem_contribuicao_pct)}: o custo
              variável come o preço inteiro. Antes da meta, é o preço ou o custo que precisa mudar.
            </p>
          </div>
        )}

        {/* Barra: realizado (cheio) + em produção (faixa clara) + marca do calendário. */}
        <div className="mt-5">
          <div className="relative h-4 w-full overflow-hidden rounded-full bg-muted">
            <div className="flex h-full w-full">
              <div
                className="h-full bg-emerald-500 transition-[width]"
                style={{ width: `${fatiaRealizado}%` }}
              />
              <div
                className="h-full bg-emerald-500/30 transition-[width]"
                style={{ width: `${fatiaProducao}%` }}
              />
            </div>
            {temMeta && ritmoCalendario > 0 && ritmoCalendario < 100 && (
              <span
                aria-hidden
                title="Onde o mês já está"
                className="absolute top-0 h-full w-px bg-foreground/50"
                style={{ left: `${ritmoCalendario}%` }}
              />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />{" "}
              Faturado {brl(dados.realizado)}
              {temMeta ? ` · ${pct(dados.atingido_pct)} da meta` : ""}
            </span>
            {dados.em_producao > 0 && (
              <span>
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500/30 align-middle" />{" "}
                Em produção {brl(dados.em_producao)} (vendido, ainda não faturado)
              </span>
            )}
            <span>
              <span className="inline-block h-2 w-px bg-foreground/50 align-middle" /> Marca do
              calendário
            </span>
          </div>
        </div>

        {/* Zero não é "tudo bem": é aviso. Diga por que está zerado e para onde ir. */}
        {dados.realizado === 0 && (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium">Nada faturado neste mês ainda.</p>
            <p className="text-muted-foreground">
              O realizado conta OS com status <strong>faturado</strong> ou{" "}
              <strong>concluído</strong>. Enquanto a OS não chega nesse status, ela aparece só como
              "em produção".{" "}
              <Link to="/os" className="underline underline-offset-2">
                Ver as OS abertas
              </Link>
              .
            </p>
          </div>
        )}

        {atrasado && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <p>
              <strong className="text-amber-700 dark:text-amber-500">
                O ritmo está atrás do calendário.
              </strong>{" "}
              Já se passaram {pct(ritmoCalendario)} do mês e a meta está em{" "}
              {pct(dados.atingido_pct)}. Para empatar, faltam {brl(dados.falta)} em{" "}
              {Math.max(dados.dias_no_mes - dados.dias_corridos, 0)} dias.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Custo fixo do mês"
          value={brl(dados.custo_fixo)}
          icon={Wallet}
          tone="magenta"
          hint="Contas a pagar que vencem no mês"
        />
        <KpiCard
          label="Margem de contribuição"
          value={pct(dados.margem_contribuicao_pct)}
          icon={Percent}
          tone="cyan"
          hint="Sobra de cada R$ 100 vendidos"
        />
        <KpiCard
          label="Falta faturar"
          value={temMeta ? brl(dados.falta) : "—"}
          icon={Target}
          tone={temMeta && dados.falta > 0 ? "amber" : "lime"}
          hint={temMeta && dados.falta === 0 ? "Meta batida" : "Para empatar no mês"}
        />
        <KpiCard
          label="Dias corridos"
          value={`${dados.dias_corridos} de ${dados.dias_no_mes}`}
          icon={CalendarDays}
          tone={atrasado ? "amber" : "muted"}
          hint={atrasado ? "Ritmo atrás do calendário" : "Ritmo dentro do calendário"}
        />
      </div>

      {/* Número de meta que ninguém sabe montar não é cobrado — é ignorado.
          A conta aberta aqui é curta de propósito. */}
      <details className="mt-4 rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Como esse número é feito</summary>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>
            A conta é: <strong>custo fixo ÷ margem de contribuição</strong>. Hoje,{" "}
            {brl(dados.custo_fixo)} ÷ {pct(dados.margem_contribuicao_pct)} ={" "}
            {temMeta ? brl(meta!) : "—"}.
          </p>
          <p>
            A margem de contribuição é o que sobra de cada venda depois do que varia com ela. O
            custo variável soma {pct(dados.custo_variavel_pct)}:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Material: {pct(dados.material_pct)} do preço, média dos produtos precificados.</li>
            <li>Perda de material: mais {pct(dados.perda_pct)} sobre o material.</li>
            <li>Falha de produção: mais {pct(dados.falha_pct)} sobre o material.</li>
            <li>Impostos sobre a venda: {pct(dados.imposto_pct)}.</li>
            <li>
              Taxa de cartão: {pct(dados.cartao_pct)}, contada pela metade — a premissa da casa é
              que metade das vendas sai no cartão.
            </li>
          </ul>
          <p>
            Mão de obra e hora de máquina não entram aqui: elas já estão no custo fixo, porque a
            equipe e a parcela são pagas venda ou não.
          </p>
        </div>
      </details>

      {/* Aviso obrigatório: sem ele a meta engana para baixo, e bater uma meta
          falsa é pior do que não ter meta. */}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="space-y-1">
          <p className="font-medium text-amber-700 dark:text-amber-500">
            Esta meta está abaixo da real.
          </p>
          <p className="text-muted-foreground">
            O custo fixo de {brl(dados.custo_fixo)} é só o que está lançado em contas a pagar —
            hoje, basicamente as parcelas das máquinas. Folha, pró-labore, aluguel, energia,
            internet e contador ainda não estão lançados. Enquanto não estiverem, faturar{" "}
            {temMeta ? brl(meta!) : "a meta"} não empata o mês: só paga as máquinas.
          </p>
          <Link
            to="/compromissos"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-2 md:min-h-0"
          >
            Lançar os custos fixos
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Bloco 2 — Onde a hora rende mais (preço de venda)
 * ------------------------------------------------------------------ */

/**
 * De que é feito o custo da peça.
 *
 * Existe porque o ranking mudou de base e o número mudou junto: a Fachada
 * aparecia com 98% de margem e é 61%, o Banner com 86,8% e é 46,6%. Quem olha
 * precisa ver POR QUE mudou, senão a tela vira um número novo sem explicação e
 * ninguém confia nela. As quatro fatias são material, hora de máquina, mão de
 * obra e rateio — na ordem em que o dinheiro sai.
 *
 * Fatia em zero não é "de graça": é cadastro faltando, e aparece nomeada em vez
 * de sumir da barra.
 */
function ComposicaoDoCusto({ produto, verCusto }: { produto: ProdutoMeta; verCusto: boolean }) {
  // Sem financeiro a RPC não manda as parcelas, e o buraco já foi avisado pelo
  // chip "custo incompleto" ali em cima — montar barra vazia só polui.
  if (!verCusto) return null;

  const total = Number(produto.custo_cheio ?? 0);
  if (total <= 0) return null;

  const fatias = [
    { rotulo: "material", valor: Number(produto.custo_material ?? 0), cor: "bg-sky-500" },
    { rotulo: "máquina", valor: Number(produto.custo_maquina ?? 0), cor: "bg-violet-500" },
    { rotulo: "mão de obra", valor: Number(produto.custo_mao_obra ?? 0), cor: "bg-orange-500" },
    { rotulo: "rateio", valor: Number(produto.custo_indireto ?? 0), cor: "bg-slate-400" },
  ];

  const faltando = [
    produto.sem_ficha_de_material ? "ficha de material" : null,
    produto.sem_hora_de_maquina ? "custo/hora da máquina" : null,
    produto.sem_mao_de_obra ? "mão de obra" : null,
    produto.sem_rateio ? "rateio administrativo" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mt-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-2.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {fatias.map((f) => (
          <div
            key={f.rotulo}
            className={f.cor}
            style={{ width: `${(f.valor / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {fatias.map((f) => (
          <div key={f.rotulo} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${f.cor}`} aria-hidden />
            <dt className="text-muted-foreground">{f.rotulo}</dt>
            <dd className="font-mono font-medium">{brl(f.valor)}</dd>
          </div>
        ))}
      </dl>
      {faltando.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
          Falta {faltando.join(", ")} — o custo acima está{" "}
          <strong>menor do que o real</strong> e a margem, maior.
        </p>
      )}
    </div>
  );
}

function BlocoPorProduto({
  dados,
  carregando,
  erro,
  verCusto,
}: {
  dados?: MetaProduto;
  carregando: boolean;
  erro: unknown;
  verCusto: boolean;
}) {
  if (carregando) {
    return <p className="text-sm text-muted-foreground">Carregando o ranking...</p>;
  }
  if (erro || !dados) {
    return (
      <Card className="border-[color:var(--bex-magenta)]/40">
        <CardContent className="p-5 text-sm">
          <p className="font-medium">O ranking por hora não carregou.</p>
          <p className="text-muted-foreground">{mensagemErro(erro)}</p>
        </CardContent>
      </Card>
    );
  }

  const produtos = dados.produtos ?? [];
  // `faixa` é o que diz se a peça entra no ranking: vem preenchida sempre que o
  // produto tem tempo E custo, para qualquer perfil. `margem_hora` é margem, ou
  // seja custo disfarçado, e só chega ao financeiro — filtrar por ela deixaria
  // o ranking do vendedor vazio. Quem não tem os dois números cai no bloco de
  // baixo com o motivo; sumir em silêncio seria esconder defeito.
  const ranking = produtos.filter((p) => p.faixa != null);
  const fora = produtos.filter((p) => p.faixa == null);
  const maior = ranking.length > 0 ? Number(ranking[0].margem_hora ?? 0) : 0;
  const algumVendeu = ranking.some((p) => Number(p.vendido_no_mes) > 0);

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">Onde a hora rende mais</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          O ranking é por <strong>R$ de margem por hora de máquina</strong>, não por margem em
          porcentagem. A plotter é uma só: o que falta na gráfica não é percentual, é hora dela.
          Duas peças com a mesma margem de 40% rendem valores diferentes se uma ocupa o dobro do
          tempo de impressão.
          {!verCusto &&
            " O valor em reais por hora é do financeiro; aqui aparece só a ordem, que é o que decide onde empurrar a venda."}
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
          O custo de cada peça agora é o <strong>cheio</strong>: material, hora de máquina, mão de
          obra e rateio administrativo. Antes era só o material, e por isso a peça que ocupa a
          máquina o dia inteiro aparecia no topo.
        </p>
      </div>

      {/* Um encargo zerado não engana um produto: engana todos de uma vez. O
          aviso fica acima do ranking porque muda a leitura da lista inteira. */}
      {verCusto && Number(dados.funcoes_sem_encargo ?? 0) > 0 && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {dados.funcoes_sem_encargo === 1
                  ? "Uma função está com encargos em 0%."
                  : `${dados.funcoes_sem_encargo} funções estão com encargos em 0%.`}
              </p>
              <p className="mt-1 text-muted-foreground">
                FGTS, 13º, férias e provisão de rescisão saem do caixa e não estão em nenhuma das
                margens abaixo. Com ~70% de encargo ignorado, a fatia de mão de obra de cada peça
                está cerca de <strong>41% menor</strong> do que o que a gráfica paga.
              </p>
              <Link
                to="/custos-producao"
                className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-2 md:min-h-0"
              >
                Preencher os encargos das funções
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {ranking.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm space-y-2">
            <p className="font-medium">Nenhum produto tem os dois números ainda.</p>
            <p className="text-muted-foreground">
              Para entrar no ranking o produto precisa de <strong>tempo de produção</strong> e de{" "}
              <strong>custo</strong>. Sem os dois não dá para dizer quanto ele paga por hora — e
              chutar aqui vira preço errado na proposta.
            </p>
            <Link
              to="/produtos"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-2"
            >
              Completar o cadastro dos produtos
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-lg">
          <ul className="divide-y divide-border">
            {ranking.map((p, i) => {
              const valor = p.margem_hora == null ? null : Number(p.margem_hora);
              // Sem custo a barra não pode ser proporcional à margem — ela
              // entregaria a razão entre custos. Vira largura por posição, que
              // mostra a ordem sem revelar número.
              const largura =
                valor != null && maior > 0
                  ? Math.max(4, (valor / maior) * 100)
                  : Math.max(12, 100 - (i / Math.max(ranking.length - 1, 1)) * 76);
              // Terços do ranking: verde em cima, âmbar no meio, vermelho embaixo.
              // A faixa vem calculada no banco (ntile de 3) e vale para todos.
              const terco = (Number(p.faixa ?? 1) - 1) as 0 | 1 | 2;
              const barra = ["bg-emerald-500", "bg-amber-500", "bg-red-500"][terco];
              const texto = [
                "text-emerald-600 dark:text-emerald-500",
                "text-amber-600 dark:text-amber-500",
                "text-red-600 dark:text-red-500",
              ][terco];
              const vendido = Number(p.vendido_no_mes ?? 0);

              return (
                <li key={p.produto_id} className="p-3 md:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {i + 1}.
                        </span>
                        {p.nome}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[
                          p.categoria,
                          p.tempo_producao_min
                            ? `${p.tempo_producao_min} min por ${unidadeLegivel(p.unidade)}`
                            : null,
                          `preço ${brl(Number(p.preco_base))}`,
                          // Custo e margem % são do financeiro: a RPC manda nulo,
                          // e aqui o pedaço nem é montado. O número é o custo
                          // CHEIO — material, máquina, gente e rateio —, não o
                          // custo do material que aparecia aqui antes.
                          verCusto && p.custo_cheio != null
                            ? `custo ${brl(Number(p.custo_cheio))}`
                            : null,
                          verCusto && p.margem_pct != null
                            ? `margem ${pct(Number(p.margem_pct))}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {verCusto ? (
                        <>
                          <p className={`font-mono text-sm font-bold ${texto}`}>{brl(valor ?? 0)}</p>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            por hora
                          </p>
                        </>
                      ) : (
                        /* Sem financeiro o R$/h não pode aparecer: com o preço e o tempo
                           logo ao lado, ele entrega o custo exato da peça por subtração
                           (custo = preço − R$/h × min ÷ 60) — justo o número que a RPC
                           apagou. Fica só a posição no ranking, que não abre conta. */
                        <p className={`text-[10px] font-medium uppercase tracking-wide ${texto}`}>
                          {["rende mais", "no meio", "rende menos"][terco]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full ${barra}`} style={{ width: `${largura}%` }} />
                    </div>
                    {/* "Vendido no mês" só aparece quando vendeu: coluna de zeros
                        não informa nada e ainda dá ar de relatório vazio. */}
                    {vendido > 0 && <StatusChip label={`vendeu ${brl(vendido)}`} tone="cyan" />}
                    {/* O aviso de custo incompleto vale para quem não vê custo
                        também: sem ele, a ordem do ranking parece medida quando
                        ainda é estimativa. */}
                    {p.custo_parcial && <StatusChip label="custo incompleto" tone="amber" />}
                  </div>

                  <ComposicaoDoCusto produto={p} verCusto={verCusto} />
                </li>
              );
            })}
          </ul>

          {!algumVendeu && (
            <div className="border-t border-border p-3 md:p-4 text-xs text-muted-foreground">
              Nenhum desses produtos foi vendido neste mês ainda, então o ranking mostra o{" "}
              <strong>potencial</strong> de cada peça, não o resultado. Assim que as OS do mês
              começarem a entrar, o quanto cada uma vendeu aparece aqui do lado.
            </div>
          )}
        </div>
      )}

      {fora.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-bold">Fora do ranking ({fora.length})</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Estes produtos não entram na conta porque falta um dos dois números. Eles continuam
            sendo vendidos — só não dá para saber se pagam a hora de máquina.
          </p>
          <ul className="mt-3 space-y-2">
            {fora.map((p) => {
              const motivos = [
                p.sem_tempo ? "sem tempo de produção" : null,
                p.sem_custo ? "sem custo cadastrado" : null,
              ].filter(Boolean);
              return (
                <li
                  key={p.produto_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <span className="min-w-0 truncate font-medium">{p.nome}</span>
                  <StatusChip label={motivos.join(" e ")} tone="amber" />
                </li>
              );
            })}
          </ul>
          <Link
            to="/produtos"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-2 md:min-h-0"
          >
            Completar o cadastro
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
