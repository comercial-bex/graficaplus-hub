import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  Box,
  Gift,
  History,
  Image,
  PanelTop,
  Pencil,
  Printer,
  Repeat,
  Scissors,
  Search,
  Shapes,
  Star,
  Sticker,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { brl } from "@/domain/orcamentos/acordo";
import type { Produto } from "@/lib/produtos-catalogo";
import {
  agruparPorTipo,
  camposDaUnidade,
  tipoDoProduto,
  tipoPelaChave,
  tipoPeloRotulo,
  type ChaveDoTipo,
  type IconeDoTipo,
  type TipoDeProduto,
} from "@/domain/orcamentos/tipos-de-produto";

/**
 * Escolha visual do produto do orçamento, em dois passos: o TIPO (lona,
 * adesivo, placa…) em cartões com ícone e, dentro dele, o PRODUTO em cartões
 * com foto (quando o catálogo tiver), unidade e preço.
 *
 * Substitui a busca em lista: o vendedor não precisa saber o nome exato do
 * produto, só o que o cliente pediu. A busca por texto continua, para quem já
 * sabe o que quer, e os três atalhos antigos ficaram: o que já está neste
 * orçamento, o que o cliente já comprou e o que a gráfica mais vende.
 *
 * Depois da escolha o quadro encolhe para uma linha com "Trocar produto",
 * para o resto do formulário ficar à vista — e é assim que um item em edição
 * abre, já preenchido. Enquanto a pessoa explora outro tipo, nada muda no
 * item: só escolher um produto (ou "outro item deste tipo") confirma.
 */

/** O que a view do catálogo entrega; preço e custo dependem do nível de quem olha. */
export type ProdutoDaEscolha = Pick<
  Produto,
  "id" | "nome" | "sku" | "descricao" | "categoria" | "tipo" | "unidade"
> &
  Partial<
    Pick<
      Produto,
      | "preco_base"
      | "imagem_url"
      | "custo_medio"
      | "margem_minima"
      | "area_minima_cobrada"
      | "tempo_producao_min"
    >
  >;

export type AtalhoDeProdutos = {
  titulo: string;
  icone: "Repeat" | "History" | "Star";
  ids: string[];
};

const ICONES: Record<IconeDoTipo, LucideIcon> = {
  Image,
  Sticker,
  PanelTop,
  Printer,
  Gift,
  Scissors,
  Wrench,
  Box,
  Shapes,
};

const ICONES_DOS_ATALHOS: Record<AtalhoDeProdutos["icone"], LucideIcon> = {
  Repeat,
  History,
  Star,
};

export function IconeDoTipo({ icone, className }: { icone: IconeDoTipo; className?: string }) {
  const Icone = ICONES[icone] ?? Shapes;
  return <Icone className={className} aria-hidden="true" />;
}

/** Preço do catálogo como o vendedor fala: "R$ 70,00/m²". */
export function precoLegivel(p: Pick<ProdutoDaEscolha, "preco_base" | "unidade">): string | null {
  if (p.preco_base == null || Number(p.preco_base) <= 0) return null;
  return `${brl(Number(p.preco_base))}/${camposDaUnidade(p.unidade).unidadeLegivel}`;
}

/**
 * Setas movem o foco entre os cartões de uma grade (tabindex itinerante):
 * um Tab entra na grade, as setas andam dentro dela.
 */
function moverFocoNaGrade(e: KeyboardEvent<HTMLElement>) {
  const teclas = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
  if (!teclas.includes(e.key)) return;
  const grade = e.currentTarget;
  const itens = [...grade.querySelectorAll<HTMLButtonElement>("[data-cartao]")].filter(
    (b) => !b.disabled,
  );
  if (itens.length === 0) return;
  const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
  const colunas = Number(grade.dataset.colunas ?? 1) || 1;
  let proximo = atual < 0 ? 0 : atual;
  if (e.key === "ArrowRight") proximo = Math.min(itens.length - 1, atual + 1);
  if (e.key === "ArrowLeft") proximo = Math.max(0, atual - 1);
  if (e.key === "ArrowDown") proximo = Math.min(itens.length - 1, atual + colunas);
  if (e.key === "ArrowUp") proximo = Math.max(0, atual - colunas);
  if (e.key === "Home") proximo = 0;
  if (e.key === "End") proximo = itens.length - 1;
  e.preventDefault();
  itens[proximo]?.focus();
}

/**
 * Quantas colunas a grade tem agora — as setas para cima/baixo dependem
 * disso. Ref de função porque a grade de produtos entra e sai da tela.
 */
function useColunas() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [colunas, setColunas] = useState(1);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const medir = () => {
      const estilo = getComputedStyle(el).gridTemplateColumns;
      setColunas(estilo.split(" ").filter(Boolean).length || 1);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [el]);
  return { ref: setEl, colunas };
}

export function EscolhaDeProduto({
  produtos,
  carregando = false,
  erro,
  onTentarDeNovo,
  verPreco,
  produtoId,
  itemLivre,
  tipo,
  descricaoAtual,
  onEscolherProduto,
  onItemLivre,
  atalhos = [],
  desabilitado = false,
}: {
  produtos: ProdutoDaEscolha[];
  carregando?: boolean;
  erro?: unknown;
  onTentarDeNovo?: () => void;
  verPreco: boolean;
  /** Produto do item (null = fora do catálogo ou nada escolhido ainda). */
  produtoId: string | null;
  /** O item é fora do catálogo e já foi confirmado como tal. */
  itemLivre: boolean;
  /** Tipo confirmado do item — o rótulo dele é o `tipo_produto` gravado. */
  tipo: ChaveDoTipo | null;
  /** Descrição já digitada, para a linha encolhida. */
  descricaoAtual: string;
  onEscolherProduto: (p: ProdutoDaEscolha) => void;
  onItemLivre: (tipo: TipoDeProduto) => void;
  atalhos?: AtalhoDeProdutos[];
  desabilitado?: boolean;
}) {
  const [busca, setBusca] = useState("");
  // "Trocar produto" reabre a grade por cima de um item já escolhido.
  const [trocando, setTrocando] = useState(false);
  // O tipo que a pessoa está olhando. Só vira o tipo do item ao confirmar.
  const [tipoExplorado, setTipoExplorado] = useState<ChaveDoTipo | null>(tipo);
  const gradeDeTipos = useColunas();
  const gradeDeProdutos = useColunas();

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const grupos = useMemo(() => agruparPorTipo(produtos), [produtos]);
  const produtoAtual = produtoId ? (porId.get(produtoId) ?? null) : null;
  // O tipo confirmado do item: o marcado; sem marca, o do produto.
  const tipoConfirmado: TipoDeProduto | null = tipo
    ? tipoPelaChave(tipo)
    : produtoAtual
      ? tipoDoProduto(produtoAtual)
      : null;

  const escolhido = !!produtoId || itemLivre;
  const aberto = !escolhido || trocando;

  // Escolheu ou limpou: a grade fecha/abre e a exploração volta ao confirmado.
  useEffect(() => {
    setTrocando(false);
    setBusca("");
  }, [produtoId, itemLivre]);
  useEffect(() => {
    setTipoExplorado(tipoConfirmado?.chave ?? null);
  }, [tipoConfirmado?.chave, aberto]);

  const tipoAtual = tipoExplorado ? tipoPelaChave(tipoExplorado) : null;
  const termo = busca.trim().toLowerCase();
  const resultadosDaBusca = useMemo(() => {
    if (!termo) return [];
    return produtos
      .filter((p) =>
        `${p.nome} ${p.sku ?? ""} ${p.descricao ?? ""} ${tipoDoProduto(p).rotulo}`
          .toLowerCase()
          .includes(termo),
      )
      .slice(0, 30);
  }, [produtos, termo]);

  const grupoAtual = tipoAtual ? (grupos.find((g) => g.tipo.chave === tipoAtual.chave) ?? null) : null;

  const escolher = (p: ProdutoDaEscolha) => {
    onEscolherProduto(p);
    setBusca("");
    setTrocando(false);
  };

  if (!aberto) {
    const Icone = tipoConfirmado ? ICONES[tipoConfirmado.icone] : Pencil;
    const preco = produtoAtual && verPreco ? precoLegivel(produtoAtual) : null;
    return (
      <div
        className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-2 pl-3"
        data-testid="produto-escolhido"
      >
        {produtoAtual?.imagem_url ? (
          <img
            src={produtoAtual.imagem_url}
            alt=""
            className="h-11 w-11 shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Icone className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {produtoAtual?.nome ?? (descricaoAtual.trim() || "Item fora do catálogo")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              tipoConfirmado?.rotulo ?? "Sem tipo",
              produtoAtual ? `por ${camposDaUnidade(produtoAtual.unidade).unidadeLegivel}` : null,
              preco,
              !produtoAtual ? "fora do catálogo" : null,
              produtoId && !produtoAtual && carregando ? "carregando o catálogo…" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 shrink-0 sm:h-9"
          disabled={desabilitado}
          onClick={() => setTrocando(true)}
        >
          Trocar produto
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="escolha-de-produto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          1. Que tipo de produto é?
          <DicaIcone texto={dicaCampo("/orcamentos", "tipo_de_produto")} rotulo="Tipo de produto" className="h-5 w-5" />
        </h3>
        {escolhido && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setTrocando(false)}>
            <X className="mr-1 h-4 w-4" /> Manter o atual
          </Button>
        )}
      </div>

      {erro ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-2">
            <p>O catálogo não carregou. Isto é falha de consulta, não catálogo vazio.</p>
            {onTentarDeNovo && (
              <Button size="sm" variant="outline" onClick={onTentarDeNovo}>
                Tentar de novo
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {/* Cartões de tipo. radiogroup: um só marcado; setas andam entre eles. */}
      <div
        ref={gradeDeTipos.ref}
        role="radiogroup"
        aria-label="Tipo de produto"
        data-colunas={gradeDeTipos.colunas}
        onKeyDown={moverFocoNaGrade}
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
      >
        {carregando && grupos.length === 0
          ? Array.from({ length: 5 }).map((_, n) => (
              <div key={n} className="h-20 animate-pulse rounded-lg border bg-muted/40" />
            ))
          : grupos.map(({ tipo: t, produtos: lista }, indice) => {
              const marcado = tipoAtual?.chave === t.chave;
              const Icone = ICONES[t.icone];
              return (
                <button
                  key={t.chave}
                  type="button"
                  role="radio"
                  aria-checked={marcado}
                  data-cartao
                  tabIndex={marcado || (!tipoAtual && indice === 0) ? 0 : -1}
                  disabled={desabilitado}
                  title={t.descricao}
                  onClick={() => {
                    setBusca("");
                    setTipoExplorado(t.chave);
                  }}
                  className={cn(
                    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    marcado
                      ? "border-primary bg-primary/10 text-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  <Icone className={cn("h-6 w-6", marcado ? "text-primary" : "")} aria-hidden="true" />
                  <span className="text-xs font-medium leading-tight">{t.rotulo}</span>
                  <span className="text-[10px] leading-none text-muted-foreground">
                    {lista.length === 1 ? "1 produto" : `${lista.length} produtos`}
                  </span>
                </button>
              );
            })}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar produto"
          placeholder="Ou busque pelo nome, código ou descrição…"
          className="h-11 pl-9 sm:h-9"
          value={busca}
          disabled={desabilitado}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {/* Atalhos: só antes de escolher tipo ou digitar. */}
      {!termo && !tipoAtual && atalhos.some((a) => a.ids.some((id) => porId.has(id))) && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {atalhos.map((a) => {
            const lista = a.ids.map((id) => porId.get(id)).filter((p): p is ProdutoDaEscolha => !!p);
            if (lista.length === 0) return null;
            const Icone = ICONES_DOS_ATALHOS[a.icone];
            return (
              <div key={a.titulo} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Icone className="h-3 w-3" aria-hidden="true" /> {a.titulo}:
                </span>
                {lista.map((p) => (
                  <button
                    key={`${a.titulo}-${p.id}`}
                    type="button"
                    disabled={desabilitado}
                    onClick={() => escolher(p)}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-card px-3 text-xs font-medium hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                  >
                    <IconeDoTipo icone={tipoDoProduto(p).icone} className="h-3.5 w-3.5 text-primary" />
                    {p.nome}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Resultado da busca (em todos os tipos) ou os produtos do tipo marcado. */}
      {(termo || grupoAtual) && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            {termo
              ? resultadosDaBusca.length === 0
                ? "Nenhum produto com esse nome — escolha um tipo e use “Outro item deste tipo”."
                : `Encontrados (${resultadosDaBusca.length})`
              : `2. Qual ${grupoAtual!.tipo.rotulo.toLowerCase()}?`}
          </h3>
          <div
            ref={gradeDeProdutos.ref}
            role="group"
            aria-label={termo ? "Produtos encontrados" : `Produtos de ${grupoAtual!.tipo.rotulo}`}
            data-colunas={gradeDeProdutos.colunas}
            onKeyDown={moverFocoNaGrade}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
          >
            {(termo ? resultadosDaBusca : grupoAtual!.produtos).map((p, indice) => {
              const t = tipoDoProduto(p);
              const marcado = p.id === produtoId;
              const preco = verPreco ? precoLegivel(p) : null;
              const campos = camposDaUnidade(p.unidade);
              return (
                <button
                  key={p.id}
                  type="button"
                  data-cartao
                  aria-pressed={marcado}
                  tabIndex={marcado || (!produtoId && indice === 0) ? 0 : -1}
                  disabled={desabilitado}
                  onClick={() => escolher(p)}
                  className={cn(
                    "flex min-h-[4.5rem] items-center gap-3 rounded-lg border p-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    marcado
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-card hover:border-primary/50",
                  )}
                >
                  {p.imagem_url ? (
                    <img src={p.imagem_url} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                      <IconeDoTipo icone={t.icone} className="h-7 w-7" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.nome}</span>
                    {p.descricao && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">{p.descricao}</span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="rounded border px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                        {campos.medidas ? "por m²" : `por ${campos.unidadeLegivel}`}
                      </span>
                      {termo && <span className="text-muted-foreground">{t.rotulo}</span>}
                      {preco ? (
                        <span className="font-mono font-medium tabular-nums">{preco}</span>
                      ) : verPreco ? (
                        <span className="text-muted-foreground">preço no item</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}

            {/* Fora do catálogo: a descrição, a unidade e o preço são digitados. */}
            {!termo && (
              <button
                type="button"
                data-cartao
                tabIndex={-1}
                disabled={desabilitado}
                title={dicaCampo("/orcamentos", "item_fora_do_catalogo")}
                onClick={() => {
                  onItemLivre(grupoAtual!.tipo);
                  setTrocando(false);
                }}
                className="flex min-h-[4.5rem] items-center gap-3 rounded-lg border border-dashed p-2 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-muted">
                  <Pencil className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Outro item deste tipo</span>
                  <span className="block text-xs">Fora do catálogo: você escreve a descrição e o preço.</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {!termo && !tipoAtual && !carregando && grupos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Toque num tipo para ver os produtos dele, ou busque pelo nome.
        </p>
      )}
    </div>
  );
}

/** O tipo que um item gravado tem, para reabrir a escolha preenchida. */
export function tipoDoItemGravado(
  item: { produto_id?: string | null; tipo_produto?: string | null },
  produtos: ProdutoDaEscolha[],
): ChaveDoTipo | null {
  const produto = item.produto_id ? produtos.find((p) => p.id === item.produto_id) : null;
  if (produto) return tipoDoProduto(produto).chave;
  return tipoPeloRotulo(item.tipo_produto)?.chave ?? null;
}
