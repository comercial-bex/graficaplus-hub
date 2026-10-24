import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Gift,
  ImageOff,
  LayoutGrid,
  Layers,
  List,
  Palette,
  PanelTop,
  Printer,
  Scissors,
  Search,
  Tags,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  carregarCatalogo,
  carregarExtrasDoCatalogo,
  carregarPainel,
  CHAVE_CATALOGO,
  CHAVE_EXTRAS,
  CHAVE_PAINEL,
} from "@/lib/parceiro-api";
import { brl, unidadeLegivel } from "@/domain/parceiros/preco";
import {
  categoriaLegivel,
  economiaEmPct,
  juntarExtras,
  ordenar,
  precoAPartirDe,
  tipoLegivel,
  type ItemDaVitrine,
  type OrdemDaVitrine,
} from "@/domain/parceiros/vitrine";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";

export const Route = createFileRoute("/parceiro/tabela")({
  component: TabelaDoParceiro,
});

/** O ícone que faz o papel da foto quando o produto ainda não tem uma. */
const ICONE_DA_CATEGORIA: Record<string, LucideIcon> = {
  impressao_grande_formato: Printer,
  adesivos: Scissors,
  comunicacao_visual: PanelTop,
  brindes: Gift,
  acabamento: Layers,
  instalacao: Wrench,
  servico: Palette,
};

/**
 * A tabela de parceiro: o que ele paga, ao lado do preço de balcão — agora como
 * vitrine (24/10/2026): foto do produto, tipo e categoria em português, quanto
 * ele economiza, cartões ou lista, ordem por nome/preço/economia.
 *
 * O preço de balcão fica visível de propósito. É o argumento de venda dele ("a
 * gráfica cobra R$ 70 o m²; eu faço por esse preço e ainda te atendo") e é a
 * medida do ganho — sem a referência, o desconto é um número solto.
 */
function TabelaDoParceiro() {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [modo, setModo] = useState<"cartoes" | "lista">("cartoes");
  const [ordem, setOrdem] = useState<OrdemDaVitrine>("nome");
  const { data: painel } = useQuery({ queryKey: CHAVE_PAINEL, queryFn: carregarPainel, staleTime: 60_000 });
  const { data: catalogo = [], isLoading } = useQuery({
    queryKey: CHAVE_CATALOGO,
    queryFn: carregarCatalogo,
    staleTime: 5 * 60_000,
  });
  // Sem foto/tipo (a consulta falhou?) a tabela continua: só perde o enfeite.
  const { data: extras = [] } = useQuery({
    queryKey: CHAVE_EXTRAS,
    queryFn: carregarExtrasDoCatalogo,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const itens = useMemo(() => juntarExtras(catalogo, extras), [catalogo, extras]);

  const categorias = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const p of itens) contagem.set(p.categoria || "outros", (contagem.get(p.categoria || "outros") ?? 0) + 1);
    return [...contagem.entries()]
      .map(([valor, n]) => ({ valor, n, rotulo: categoriaLegivel(valor) }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }, [itens]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = itens.filter(
      (p) =>
        (!categoria || (p.categoria || "outros") === categoria) &&
        (!termo || `${p.nome} ${categoriaLegivel(p.categoria)} ${tipoLegivel(p.tipo)}`.toLowerCase().includes(termo)),
    );
    return ordenar(filtrados, ordem);
  }, [itens, busca, categoria, ordem]);

  const emOferta = itens.filter((p) => p.origem === "oferta" || (!!p.oferta_id && !!p.faixas));
  const comEconomia = itens.map(economiaEmPct).filter((e): e is number => e != null);
  const economiaMedia = comEconomia.length ? Math.round(comEconomia.reduce((s, e) => s + e, 0) / comEconomia.length) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Tags className="h-6 w-6 text-[color:var(--bex-cyan)]" />
            Tabela de preços
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Preços de parceiro {painel?.nivel.nome ? `${painel.nivel.nome} ` : ""}para pedidos feitos à gráfica. Ofertas
            ativas já estão aplicadas.
          </p>
        </div>
        {economiaMedia != null && (
          <div className="rounded-xl border border-[color:var(--bex-lime)]/40 bg-[color:var(--bex-lime)]/10 px-4 py-2 text-sm">
            Você paga em média <strong className="tabular-nums">{economiaMedia}%</strong> abaixo do balcão
          </div>
        )}
      </div>

      {emOferta.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-[color:var(--bex-amber)]/50 bg-[color:var(--bex-amber)]/10 p-4 text-sm">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bex-amber)]" />
          <p>Em oferta agora: {emOferta.map((p) => p.nome).join(", ")}.</p>
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produto, categoria ou tipo"
              className="pl-9"
              aria-label="Buscar produto"
            />
          </div>
          <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemDaVitrine)}>
            <SelectTrigger className="w-48" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nome">Ordem alfabética</SelectItem>
              <SelectItem value="menor_preco">Menor preço</SelectItem>
              <SelectItem value="maior_economia">Maior economia</SelectItem>
            </SelectContent>
          </Select>
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Forma de exibir">
            {(
              [
                ["cartoes", LayoutGrid, "Cartões"],
                ["lista", List, "Lista"],
              ] as const
            ).map(([valor, Icone, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={modo === valor}
                aria-label={rotulo}
                onClick={() => setModo(valor)}
                className={cn(
                  "flex h-9 w-10 items-center justify-center transition-colors",
                  modo === valor ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icone className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Filtro ativo={categoria === null} onClick={() => setCategoria(null)}>
            Todos <span className="ml-1 text-xs opacity-70">{itens.length}</span>
          </Filtro>
          {categorias.map((c) => (
            <Filtro key={c.valor} ativo={categoria === c.valor} onClick={() => setCategoria(c.valor)}>
              {c.rotulo} <span className="ml-1 text-xs opacity-70">{c.n}</span>
            </Filtro>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, n) => (
            <Skeleton key={n} className="h-64" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhum produto encontrado.
        </p>
      ) : modo === "cartoes" ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((p) => (
            <li key={p.produto_id}>
              <Cartao produto={p} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {visiveis.map((p) => (
            <li key={p.produto_id}>
              <Linha produto={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Foto do produto; sem foto, o ícone da categoria sobre um fundo de cor — nunca um buraco cinza. */
function Foto({ produto: p, className }: { produto: ItemDaVitrine; className?: string }) {
  const [quebrou, setQuebrou] = useState(false);
  const Icone = ICONE_DA_CATEGORIA[p.categoria || ""] ?? ImageOff;
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-[color:var(--bex-cyan)]/15 via-muted to-[color:var(--bex-magenta)]/15", className)}>
      {p.imagem_url && !quebrou ? (
        <img
          src={p.imagem_url}
          alt={p.nome}
          loading="lazy"
          draggable={false}
          onError={() => setQuebrou(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground/70">
          <Icone className="h-1/3 w-1/3 max-h-12 max-w-12" aria-hidden />
        </div>
      )}
    </div>
  );
}

function Selos({ produto: p }: { produto: ItemDaVitrine }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[11px] font-medium">
        {tipoLegivel(p.tipo)}
      </span>
      <span className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
        {categoriaLegivel(p.categoria)}
      </span>
      {p.oferta_id && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--bex-amber)]/20 px-2 py-0.5 text-[11px] font-medium text-[color:var(--bex-amber)]">
          <Zap className="h-3 w-3" /> {p.oferta_titulo ?? "Oferta"}
        </span>
      )}
    </div>
  );
}

function Preco({ produto: p }: { produto: ItemDaVitrine }) {
  const un = unidadeLegivel(p.unidade);
  const economia = economiaEmPct(p);
  if (p.faixas) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          A partir de{" "}
          <strong className="text-base text-foreground tabular-nums">{brl(precoAPartirDe(p) ?? 0)}</strong>/{un}
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    Quantidade
                    <DicaIcone texto={dicaCampo("/parceiro", "faixa")} rotulo="Faixa de quantidade" />
                  </span>
                </th>
                <th className="px-2 py-1 text-right font-medium">Você paga</th>
                <th className="px-2 py-1 text-right font-medium">Balcão</th>
              </tr>
            </thead>
            <tbody>
              {p.faixas.map((f) => (
                <tr key={f.quantidade_minima} className="border-t border-border">
                  <td className="px-2 py-1 tabular-nums">
                    {f.quantidade_minima}+ {un}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{brl(f.preco_parceiro)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{brl(f.preco_referencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-2xl font-bold tabular-nums">
        {p.preco_parceiro === null ? "—" : brl(p.preco_parceiro)}
        <span className="text-sm font-normal text-muted-foreground">/{un}</span>
      </span>
      {p.preco_referencia !== null && p.preco_parceiro !== null && p.preco_referencia > p.preco_parceiro && (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          balcão <span className="line-through">{brl(p.preco_referencia)}</span>
          <DicaIcone texto={dicaCampo("/parceiro", "balcao")} rotulo="Preço de balcão" />
        </span>
      )}
      {economia != null && (
        <span className="rounded-full bg-[color:var(--bex-lime)]/20 px-2 py-0.5 text-xs font-semibold text-[color:var(--bex-lime)]">
          −{economia}%
        </span>
      )}
    </div>
  );
}

function PecaMinima({ produto: p }: { produto: ItemDaVitrine }) {
  if (!p.por_area || !p.area_minima) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      Peça mínima cobrada {Number(p.area_minima).toLocaleString("pt-BR")} m²
      <DicaIcone texto={dicaCampo("/parceiro", "peca minima")} rotulo="Peça mínima" />
    </p>
  );
}

function Cartao({ produto: p }: { produto: ItemDaVitrine }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-[color:var(--bex-cyan)]/50 hover:shadow-md">
      {/* Sem foto o bloco encolhe: um quadro vazio enorme só empurra o preço para baixo. */}
      <Foto produto={p} className={cn("w-full", p.imagem_url ? "aspect-[16/10]" : "aspect-[3/1]")} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Selos produto={p} />
        <div>
          <h2 className="font-semibold leading-snug">{p.nome}</h2>
          {p.descricao && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.descricao}</p>}
        </div>
        <div className="mt-auto space-y-2">
          <Preco produto={p} />
          <PecaMinima produto={p} />
        </div>
      </div>
    </article>
  );
}

function Linha({ produto: p }: { produto: ItemDaVitrine }) {
  return (
    <div className="grid items-center gap-3 p-3 md:grid-cols-[4rem_minmax(0,1fr)_auto] md:gap-4 md:p-4">
      <Foto produto={p} className="hidden h-16 w-16 rounded-lg md:block" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium">{p.nome}</p>
        <Selos produto={p} />
        <PecaMinima produto={p} />
      </div>
      <div className="md:min-w-64 md:text-right">
        <Preco produto={p} />
      </div>
    </div>
  );
}

function Filtro({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors",
        ativo
          ? "border-[color:var(--bex-cyan)] bg-[color:var(--bex-cyan)]/15 font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
