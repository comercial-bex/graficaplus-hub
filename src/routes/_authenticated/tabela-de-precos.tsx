import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GitCompareArrows, LayoutGrid, Rows3, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { useAuth } from "@/lib/auth-context";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Dica } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CATEGORIAS, categoriaLabel } from "@/lib/produtos-catalogo";
import { cn } from "@/lib/utils";
import {
  agruparPorCategoria,
  composicaoMaisRecente,
  custoCheio,
  margemSobreVenda,
  precoDoParceiro,
  type Composicao,
} from "@/domain/precos/tabela-de-precos";
import { CartaoDoProduto, fichaDaLinha, PilulaDeMargem } from "@/components/precos/cartao-do-produto";
import { FichaDoProduto, marcadoresDaLinha, pisoDaMargem, SeloDaFicha } from "@/components/precos/ficha-do-produto";
import { BarraDeComparacao, LegendaDaBarra } from "@/components/precos/barra-de-comparacao";
import { IconeDaCategoria, IconeDoProduto } from "@/components/precos/icone-do-produto";
import { brl, pct, type Concorrente, type Linha, type LinhaDaReceita, type Produto } from "@/components/precos/tipos";

export const Route = createFileRoute("/_authenticated/tabela-de-precos")({
  head: () => ({ meta: [{ title: "Tabela de preços — BEX PRINT OS" }] }),
  component: TabelaDePrecosPage,
});

const MAX_COMPARAR = 4;
type Base = "cadastro" | "cheio";
type Ordem = "categoria" | "margem" | "preco" | "nome";
type Atalho = "todos" | "abaixo" | "ficha" | "sem_concorrente" | "sem_foto";

const num = (v: unknown) => (v != null ? Number(v) : null);

function TabelaDePrecosPage() {
  const { hasRole } = useAuth();
  const podeEditarFoto = hasRole("admin") || hasRole("gestor");
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todas");
  const [atalho, setAtalho] = useState<Atalho>("todos");
  const [base, setBase] = useState<Base>("cadastro");
  const [ordem, setOrdem] = useState<Ordem>("categoria");
  const [vista, setVista] = useState<"cartoes" | "tabela">("cartoes");
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [comparar, setComparar] = useState<string[]>([]);
  const [comparando, setComparando] = useState(false);

  const produtos = useQuery({
    queryKey: ["tabela-precos", "produtos"],
    queryFn: async (): Promise<Produto[]> => {
      const { data, error } = await fromFinancialView("produtos", "financeiro")
        .select("id, nome, categoria, tipo, unidade, ativo, custo_medio, margem_minima, preco_base, preco_parceiro, imagem_url, tempo_producao_min, maquina_padrao_id")
        .order("ativo", { ascending: false })
        .order("categoria")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((p) => ({
        ...p,
        custo_medio: num(p.custo_medio),
        preco_base: num(p.preco_base),
        preco_parceiro: num(p.preco_parceiro),
        margem_minima: num(p.margem_minima),
        tempo_producao_min: num(p.tempo_producao_min),
      })) as Produto[];
    },
  });
  const niveis = useQuery({
    queryKey: ["tabela-precos", "nivel-de-entrada"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("parceiro_niveis").select("nome, desconto_pct, ordem").order("ordem");
      if (error) throw error;
      // O nível de entrada é o de menor ordem (são 4 linhas; não precisa de limit).
      return ((data ?? [])[0] ?? null) as { nome: string; desconto_pct: number } | null;
    },
  });
  // Promoções do programa de parceiros em vigor: o preço de oferta passa na frente do nosso preço de parceiro.
  const ofertas = useQuery({
    queryKey: ["tabela-precos", "ofertas"],
    queryFn: async () => {
      const agora = new Date().toISOString();
      const { data, error } = await (supabase as any)
        .from("parceiro_ofertas")
        .select("produto_id, titulo, preco_oferta")
        .eq("ativa", true)
        .not("produto_id", "is", null)
        .lte("inicio", agora)
        .gt("fim", agora);
      if (error) throw error;
      const mapa = new Map<string, { titulo: string; preco: number }>();
      for (const o of data ?? []) {
        const atual = mapa.get(o.produto_id);
        if (o.preco_oferta != null && (!atual || Number(o.preco_oferta) < atual.preco)) {
          mapa.set(o.produto_id, { titulo: o.titulo, preco: Number(o.preco_oferta) });
        }
      }
      return mapa;
    },
  });
  const concorrentes = useQuery({
    queryKey: ["tabela-precos", "concorrentes"],
    queryFn: async (): Promise<Concorrente[]> => {
      const { data, error } = await (supabase as any)
        .from("produto_concorrentes")
        .select("id, produto_id, concorrente, preco, tipo_preco, fonte, coletado_em")
        .order("concorrente");
      if (error) throw error;
      return (data ?? []).map((c: Concorrente) => ({ ...c, preco: Number(c.preco) }));
    },
  });
  // Família do produto: mora na tabela (as views financeiras não a trazem).
  const familias = useQuery({
    queryKey: ["tabela-precos", "familias"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("produtos").select("id, familia");
      if (error) throw error;
      return new Map<string, string>(((data ?? []) as Array<{ id: string; familia: string | null }>).filter((r) => r.familia).map((r) => [r.id, r.familia as string]));
    },
  });
  // Composição do custo (matéria-prima + máquina + mão de obra + indireto), mantida pelo banco.
  const composicoes = useQuery({
    queryKey: ["tabela-precos", "composicao"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_precificacao")
        .select("produto_id, custo_material, custo_maquina, custo_mao_obra, custo_indireto, updated_at");
      if (error) throw error;
      const recentes = composicaoMaisRecente((data ?? []) as Array<{ produto_id: string; updated_at: string } & Record<string, unknown>>);
      const mapa = new Map<string, Composicao>();
      for (const [id, l] of recentes) {
        mapa.set(id, {
          material: Number(l.custo_material ?? 0),
          maquina: Number(l.custo_maquina ?? 0),
          maoDeObra: Number(l.custo_mao_obra ?? 0),
          indireto: Number(l.custo_indireto ?? 0),
        });
      }
      return mapa;
    },
  });
  // Receita (matéria-prima por unidade vendida) de cada produto.
  const receitas = useQuery({
    queryKey: ["tabela-precos", "receitas"],
    queryFn: async () => {
      const [pm, mt] = await Promise.all([
        (supabase as any).from("produto_materiais").select("produto_id, material_id, quantidade_por_unidade"),
        fromFinancialView("materiais", "financeiro").select("id, nome, unidade, custo_medio, custo_unitario"),
      ]);
      if (pm.error) throw pm.error;
      if (mt.error) throw mt.error;
      const materiais = new Map<string, { nome: string; unidade: string; custo: number }>();
      for (const m of (mt.data ?? []) as any[]) {
        materiais.set(m.id, { nome: m.nome, unidade: m.unidade, custo: Number(m.custo_medio ?? m.custo_unitario ?? 0) });
      }
      const mapa = new Map<string, LinhaDaReceita[]>();
      for (const r of pm.data ?? []) {
        const m = materiais.get(r.material_id);
        if (!m) continue;
        const item: LinhaDaReceita = { material: m.nome, unidade: m.unidade, quantidade: Number(r.quantidade_por_unidade), custoUnitario: m.custo };
        mapa.set(r.produto_id, [...(mapa.get(r.produto_id) ?? []), item]);
      }
      return mapa;
    },
  });

  const descontoDoNivel = niveis.data ? Number(niveis.data.desconto_pct) : null;

  const todas = useMemo<Linha[]>(() => {
    const porProduto = new Map<string, Concorrente[]>();
    for (const c of concorrentes.data ?? []) porProduto.set(c.produto_id, [...(porProduto.get(c.produto_id) ?? []), c]);
    return (produtos.data ?? []).map((p) => {
      const composicao = composicoes.data?.get(p.id) ?? null;
      const cheio = custoCheio(composicao);
      const custo = p.custo_medio;
      return {
        produto: p,
        familia: familias.data?.get(p.id) ?? null,
        custo,
        cheio,
        composicao,
        custoBase: base === "cheio" ? (cheio ?? custo) : custo,
        receita: receitas.data?.get(p.id) ?? [],
        venda: p.preco_base,
        parceiro: precoDoParceiro({ precoParceiro: p.preco_parceiro, precoBase: p.preco_base, descontoDoNivelPct: descontoDoNivel }),
        promocao: ofertas.data?.get(p.id) ?? null,
        concorrentes: porProduto.get(p.id) ?? [],
      };
    });
  }, [produtos.data, familias.data, composicoes.data, receitas.data, concorrentes.data, ofertas.data, descontoDoNivel, base]);

  const abaixoDoMinimo = (l: Linha) => {
    const min = l.produto.margem_minima;
    if (min == null) return false;
    return [margemSobreVenda(l.venda, l.custoBase), margemSobreVenda(l.parceiro?.valor ?? null, l.custoBase)].some((m) => m != null && m < min);
  };

  const resumo = useMemo(
    () => ({
      total: todas.length,
      abaixo: todas.filter(abaixoDoMinimo).length,
      ficha: todas.filter((l) => fichaDaLinha(l).nivel !== "completa").length,
      semConcorrente: todas.filter((l) => l.concorrentes.length === 0).length,
      semFoto: todas.filter((l) => !l.produto.imagem_url).length,
    }),
    [todas], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const contagemPorCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of todas) m.set(l.produto.categoria ?? "outros", (m.get(l.produto.categoria ?? "outros") ?? 0) + 1);
    return m;
  }, [todas]);

  const termo = busca.trim().toLowerCase();
  const linhas = todas.filter((l) => {
    const p = l.produto;
    if (termo && !`${p.nome} ${l.familia ?? ""} ${p.categoria ?? ""} ${p.categoria ? categoriaLabel(p.categoria) : ""}`.toLowerCase().includes(termo)) return false;
    if (categoria !== "todas" && (p.categoria ?? "outros") !== categoria) return false;
    if (atalho === "abaixo" && !abaixoDoMinimo(l)) return false;
    if (atalho === "ficha" && fichaDaLinha(l).nivel === "completa") return false;
    if (atalho === "sem_concorrente" && l.concorrentes.length > 0) return false;
    if (atalho === "sem_foto" && p.imagem_url) return false;
    return true;
  });

  const ordenadas = useMemo(() => {
    if (ordem === "categoria") return linhas;
    const margem = (l: Linha) => margemSobreVenda(l.venda, l.custoBase) ?? Number.POSITIVE_INFINITY;
    const copia = [...linhas];
    if (ordem === "margem") copia.sort((a, b) => margem(a) - margem(b));
    if (ordem === "preco") copia.sort((a, b) => (b.venda ?? 0) - (a.venda ?? 0));
    if (ordem === "nome") copia.sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, "pt-BR"));
    return copia;
  }, [linhas, ordem]);

  const grupos = ordem === "categoria"
    ? agruparPorCategoria(ordenadas.map((l) => ({ ...l, categoria: l.produto.categoria })), CATEGORIAS.map((c) => c.value))
    : [{ categoria: "", itens: ordenadas.map((l) => ({ ...l, categoria: l.produto.categoria })) }];

  const erro = produtos.error ?? niveis.error ?? concorrentes.error ?? ofertas.error ?? composicoes.error ?? receitas.error;
  const carregando = produtos.isLoading;
  const linhaAberta = aberto ? todas.find((l) => l.produto.id === aberto) ?? null : null;
  const selecionadas = comparar.map((id) => todas.find((l) => l.produto.id === id)).filter((l): l is Linha => !!l);

  const alternar = (id: string, v: boolean) => setComparar((atual) => (v ? [...atual, id].slice(0, MAX_COMPARAR) : atual.filter((x) => x !== id)));
  const alternarGrupo = (c: string) =>
    setRecolhidas((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });

  const Atalhos: Array<{ id: Atalho; rotulo: string; n: number; alerta?: boolean }> = [
    { id: "todos", rotulo: "Todos os produtos", n: resumo.total },
    { id: "abaixo", rotulo: "Margem abaixo do mínimo", n: resumo.abaixo, alerta: true },
    { id: "ficha", rotulo: "Ficha técnica incompleta", n: resumo.ficha, alerta: true },
    { id: "sem_concorrente", rotulo: "Sem concorrente anotado", n: resumo.semConcorrente },
    { id: "sem_foto", rotulo: "Sem foto", n: resumo.semFoto },
  ];

  return (
    <div className={cn("space-y-5", comparar.length > 0 && "pb-24")}>
      <SectionHeader
        ajuda={dicaTela("/tabela-de-precos")}
        breadcrumb="Preço e custo"
        title="Tabela de preços"
        description="Cada produto com custo, venda final, preço de parceiro, margem e a posição frente aos concorrentes — numa régua só."
      />

      {/* resumo que também filtra */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {Atalhos.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={atalho === a.id}
            onClick={() => setAtalho(a.id)}
            className={cn(
              "rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50",
              atalho === a.id ? "border-primary ring-1 ring-primary" : "border-border",
            )}
          >
            <div className={cn("text-2xl font-semibold tabular-nums", a.alerta && a.n > 0 && "text-destructive")}>{carregando ? "…" : a.n}</div>
            <div className="text-xs text-muted-foreground">{a.rotulo}</div>
          </button>
        ))}
      </div>

      {/* barra de ferramentas */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto, família ou categoria" className="pl-9" aria-label="Buscar produto" />
          </div>
          <Select value={ordem} onValueChange={(v) => setOrdem(v as Ordem)}>
            <SelectTrigger className="w-48" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="categoria">Agrupar por categoria</SelectItem>
              <SelectItem value="margem">Menor margem primeiro</SelectItem>
              <SelectItem value="preco">Maior preço primeiro</SelectItem>
              <SelectItem value="nome">Nome (A–Z)</SelectItem>
            </SelectContent>
          </Select>
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Base do custo">
            {(["cadastro", "cheio"] as const).map((b) => (
              <Dica key={b} texto={b === "cheio" ? "Matéria-prima + máquina + mão de obra + indireto." : "O custo digitado no cadastro do produto (o que o orçamento usa)."}>
                <button
                  type="button"
                  aria-pressed={base === b}
                  onClick={() => setBase(b)}
                  className={cn("px-3 py-2 text-xs", base === b ? "bg-primary/15 font-semibold" : "text-muted-foreground hover:bg-muted")}
                >
                  Custo {b === "cheio" ? "cheio" : "do cadastro"}
                </button>
              </Dica>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Forma de exibição">
            <button type="button" aria-pressed={vista === "cartoes"} aria-label="Cartões" onClick={() => setVista("cartoes")} className={cn("px-2.5 py-2", vista === "cartoes" ? "bg-primary/15" : "text-muted-foreground hover:bg-muted")}>
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button type="button" aria-pressed={vista === "tabela"} aria-label="Tabela" onClick={() => setVista("tabela")} className={cn("px-2.5 py-2", vista === "tabela" ? "bg-primary/15" : "text-muted-foreground hover:bg-muted")}>
              <Rows3 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Categorias">
          <ChipDeCategoria ativo={categoria === "todas"} onClick={() => setCategoria("todas")} rotulo="Todas" n={todas.length} />
          {CATEGORIAS.filter((c) => contagemPorCategoria.has(c.value)).map((c) => (
            <ChipDeCategoria key={c.value} ativo={categoria === c.value} onClick={() => setCategoria(c.value)} rotulo={c.label} n={contagemPorCategoria.get(c.value) ?? 0} categoria={c.value} />
          ))}
        </div>
        <LegendaDaBarra />
      </div>

      {erro && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          Não consegui carregar a tabela: {mensagemErro(erro)}
        </p>
      )}
      {carregando && <Carregando linhas={6} />}
      {!carregando && !erro && ordenadas.length === 0 && (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">Nenhum produto encontrado com esses filtros.</p>
      )}

      {grupos.map((g) => {
        const fechado = g.categoria !== "" && recolhidas.has(g.categoria);
        return (
          <section key={g.categoria || "todos"} className="space-y-2">
            {g.categoria !== "" && (
              <button
                type="button"
                aria-expanded={!fechado}
                onClick={() => alternarGrupo(g.categoria)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted/50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <IconeDaCategoria categoria={g.categoria} className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">{categoriaLabel(g.categoria)}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{g.itens.length}</span>
                <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", fechado && "-rotate-90")} aria-hidden />
              </button>
            )}
            {!fechado &&
              (vista === "cartoes" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.itens.map((l) => (
                    <CartaoDoProduto
                      key={l.produto.id}
                      linha={l}
                      selecionado={comparar.includes(l.produto.id)}
                      podeSelecionar={comparar.length < MAX_COMPARAR}
                      aoSelecionar={(v) => alternar(l.produto.id, v)}
                      aoAbrir={() => setAberto(l.produto.id)}
                    />
                  ))}
                </div>
              ) : (
                <TabelaCompacta linhas={g.itens} aoAbrir={setAberto} />
              ))}
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Margem é sobre a venda (lucro ÷ preço). "Custo do cadastro" é o que o orçamento usa; "custo cheio" soma matéria-prima da receita, máquina, mão de obra e rateio indireto — é a margem de verdade.
        Concorrente de venda final só se compara com a nossa venda final; terceirizado com o nosso preço de parceiro. Produto vendido por faixa mostra "por faixa": o preço de cada faixa está em Produtos.
      </p>

      {comparar.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 shadow-lg backdrop-blur md:left-[var(--sidebar-width,0px)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{comparar.length} de {MAX_COMPARAR} para comparar</span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {selecionadas.map((l) => (
                <span key={l.produto.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                  {l.produto.nome}
                  <button type="button" aria-label={`Tirar ${l.produto.nome}`} onClick={() => alternar(l.produto.id, false)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setComparar([])}>Limpar</Button>
            <Button size="sm" disabled={comparar.length < 2} onClick={() => setComparando(true)}>
              <GitCompareArrows className="mr-1.5 h-4 w-4" /> Comparar
            </Button>
          </div>
        </div>
      )}

      <Dialog open={comparando} onOpenChange={setComparando}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Comparar produtos</DialogTitle>
            <DialogDescription>Lado a lado, com o custo {base === "cheio" ? "cheio" : "do cadastro"}. A régua usa a mesma escala dentro de cada produto.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36" />
                  {selecionadas.map((l) => (
                    <TableHead key={l.produto.id} className="min-w-44 align-top">
                      <div className="flex items-center gap-2">
                        <IconeDoProduto imagem={l.produto.imagem_url} categoria={l.produto.categoria} nome={l.produto.nome} tamanho="sm" />
                        <span className="line-clamp-2 text-foreground">{l.produto.nome}</span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["Unidade", (l: Linha) => l.produto.unidade],
                    ["Custo", (l: Linha) => brl(l.custoBase)],
                    ["Venda final", (l: Linha) => (l.venda != null ? brl(l.venda) : "por faixa")],
                    ["Margem final", (l: Linha) => <PilulaDeMargem margem={margemSobreVenda(l.venda, l.custoBase)} minimo={l.produto.margem_minima} rotulo="" />],
                    ["Parceiro", (l: Linha) => brl(l.parceiro?.valor ?? null)],
                    ["Margem parceiro", (l: Linha) => <PilulaDeMargem margem={margemSobreVenda(l.parceiro?.valor ?? null, l.custoBase)} minimo={l.produto.margem_minima} rotulo="" />],
                    ["Margem mínima", (l: Linha) => pct(l.produto.margem_minima)],
                    ["Menor concorrente", (l: Linha) => (l.concorrentes.length ? brl(Math.min(...l.concorrentes.map((c) => c.preco))) : "—")],
                    ["Ficha técnica", (l: Linha) => <SeloDaFicha nivel={fichaDaLinha(l).nivel} />],
                  ] as Array<[string, (l: Linha) => React.ReactNode]>
                ).map(([titulo, f]) => (
                  <TableRow key={titulo}>
                    <TableCell className="font-medium text-muted-foreground">{titulo}</TableCell>
                    {selecionadas.map((l) => (
                      <TableCell key={l.produto.id} className="font-mono text-sm">{f(l)}</TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Régua</TableCell>
                  {selecionadas.map((l) => (
                    <TableCell key={l.produto.id}>
                      <BarraDeComparacao marcadores={marcadoresDaLinha(l, pisoDaMargem(l.custoBase, l.produto.margem_minima))} />
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <FichaDoProduto linha={linhaAberta} nomeDoNivel={niveis.data?.nome ?? null} podeEditarFoto={podeEditarFoto} aoFechar={() => setAberto(null)} />
    </div>
  );
}

function ChipDeCategoria({ ativo, onClick, rotulo, n, categoria }: { ativo: boolean; onClick: () => void; rotulo: string; n: number; categoria?: string }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
        ativo ? "border-primary bg-primary/15 font-semibold" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {categoria && <IconeDaCategoria categoria={categoria} className="h-3.5 w-3.5" />}
      {rotulo}
      <span className="rounded-full bg-background/70 px-1.5 text-[10px]">{n}</span>
    </button>
  );
}

function TabelaCompacta({ linhas, aoAbrir }: { linhas: Linha[]; aoAbrir: (id: string) => void }) {
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Venda final</TableHead>
              <TableHead>Margem final</TableHead>
              <TableHead className="text-right">Parceiro</TableHead>
              <TableHead>Margem parceiro</TableHead>
              <TableHead className="min-w-52">Régua</TableHead>
              <TableHead>Ficha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.produto.id} className="cursor-pointer" onClick={() => aoAbrir(l.produto.id)}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <IconeDoProduto imagem={l.produto.imagem_url} categoria={l.produto.categoria} nome={l.produto.nome} tamanho="sm" />
                    <div className="min-w-0">
                      <div className="font-medium">{l.produto.nome}</div>
                      <div className="text-xs text-muted-foreground">por {l.produto.unidade}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{brl(l.custoBase)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{l.venda != null ? brl(l.venda) : <span className="text-xs text-muted-foreground">por faixa</span>}</TableCell>
                <TableCell><PilulaDeMargem margem={margemSobreVenda(l.venda, l.custoBase)} minimo={l.produto.margem_minima} rotulo="" /></TableCell>
                <TableCell className="text-right font-mono text-sm">{brl(l.parceiro?.valor ?? null)}</TableCell>
                <TableCell><PilulaDeMargem margem={margemSobreVenda(l.parceiro?.valor ?? null, l.custoBase)} minimo={l.produto.margem_minima} rotulo="" /></TableCell>
                <TableCell><BarraDeComparacao marcadores={marcadoresDaLinha(l, pisoDaMargem(l.custoBase, l.produto.margem_minima))} /></TableCell>
                <TableCell><SeloDaFicha nivel={fichaDaLinha(l).nivel} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
