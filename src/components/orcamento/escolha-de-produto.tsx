import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { useAuth } from "@/lib/auth-context";
import { brl } from "@/domain/orcamentos/acordo";
import type { Produto } from "@/lib/produtos-catalogo";
import { IlustracaoDoTipo } from "@/components/orcamento/ilustracoes-de-tipo";
import {
  alternarFavorito,
  chaveDosFavoritosDeProduto,
  gravarFavoritosDeProduto,
  lerFavoritosDeProduto,
} from "@/domain/orcamentos/favoritos-de-produto";
import {
  familiasDoGrupo,
  filtrarPorFamilia,
  mostrarFiltroDeFamilia,
} from "@/domain/orcamentos/familias-na-escolha";
import {
  agruparPorTipo,
  camposDaUnidade,
  tipoDoProduto,
  tipoPelaChave,
  tipoPeloRotulo,
  type ChaveDoTipo,
  type IconeDoTipo as NomeDoIcone,
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
  > & {
    /** Preço de parceiro (terceirizado); nulo = o produto não tem. */
    preco_parceiro?: number | null;
    /** Família do catálogo ("Adesivos de carroceria"): vira filtro dentro do tipo. */
    familia?: string | null;
  };

export type AtalhoDeProdutos = {
  titulo: string;
  icone: "Repeat" | "History" | "Star";
  ids: string[];
};

const ICONES: Record<NomeDoIcone, LucideIcon> = {
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

export function IconeDoTipo({ icone, className }: { icone: NomeDoIcone; className?: string }) {
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
  onCalcularPeca3d,
  atalhos = [],
  desabilitado = false,
  reabrir,
  onPasso,
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
  /** Peça 3D (27/10/2026): abre a calculadora em vez de um produto do catálogo. */
  onCalcularPeca3d?: () => void;
  atalhos?: AtalhoDeProdutos[];
  desabilitado?: boolean;
  /** Pedido de fora (linha de passos): reabre no tipo, no produto, ou fecha mantendo o atual. */
  reabrir?: { para: "tipo" | "produto" | "fechar"; n: number } | null;
  /** Avisa em que passo a escolha está: 1 tipo, 2 produto, null = fechada (produto escolhido). */
  onPasso?: (passo: 1 | 2 | null) => void;
}) {
  const [busca, setBusca] = useState("");
  // "Trocar produto" reabre a grade por cima de um item já escolhido.
  const [trocando, setTrocando] = useState(false);
  // O tipo que a pessoa está olhando. Só vira o tipo do item ao confirmar.
  const [tipoExplorado, setTipoExplorado] = useState<ChaveDoTipo | null>(tipo);
  // Família marcada dentro do tipo (só filtro; some ao trocar de tipo).
  const [familiaFiltro, setFamiliaFiltro] = useState<string | null>(null);
  useEffect(() => setFamiliaFiltro(null), [tipoExplorado]);
  const gradeDeTipos = useColunas();
  const gradeDeProdutos = useColunas();

  // Favoritos de quem está vendendo: lidos do aparelho depois de montar (nada no servidor).
  const { user } = useAuth();
  const chaveDosFavoritos = chaveDosFavoritosDeProduto(user?.email);
  const [favoritos, setFavoritos] = useState<string[]>([]);
  useEffect(() => {
    setFavoritos(lerFavoritosDeProduto(chaveDosFavoritos, typeof window === "undefined" ? null : window.localStorage));
  }, [chaveDosFavoritos]);
  const alternarEstrela = (id: string) =>
    setFavoritos((atual) => {
      const nova = alternarFavorito(atual, id);
      gravarFavoritosDeProduto(chaveDosFavoritos, nova, typeof window === "undefined" ? null : window.localStorage);
      return nova;
    });

  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  // O "Impressão 3D (serviço)" do catálogo é só a prateleira do tipo: com a calculadora ligada,
  // escolher o produto a seco daria um item de R$ 0. Ele some dos atalhos, da busca e da lista;
  // o tipo continua na grade para abrir a calculadora.
  const ocultar = (p: ProdutoDaEscolha) => !!onCalcularPeca3d && tipoDoProduto(p).chave === "impressao_3d";
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
  const pediuTipo = useRef(false);
  useEffect(() => {
    if (pediuTipo.current) {
      pediuTipo.current = false;
      setTipoExplorado(null);
      return;
    }
    setTipoExplorado(tipoConfirmado?.chave ?? null);
  }, [tipoConfirmado?.chave, aberto]);

  const tipoAtual = tipoExplorado ? tipoPelaChave(tipoExplorado) : null;
  useEffect(() => {
    if (!reabrir) return;
    if (reabrir.para === "fechar") {
      setTrocando(false);
      return;
    }
    setTrocando(true);
    setBusca("");
    if (reabrir.para === "tipo") {
      pediuTipo.current = !aberto;
      setTipoExplorado(null);
    }
    else setTipoExplorado(tipoConfirmado?.chave ?? tipoExplorado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reabrir?.n]);
  useEffect(() => {
    onPasso?.(aberto ? (tipoAtual ? 2 : 1) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, tipoAtual?.chave]);
  const termo = busca.trim().toLowerCase();
  const resultadosDaBusca = useMemo(() => {
    if (!termo) return [];
    return produtos
      .filter((p) =>
        `${p.nome} ${p.sku ?? ""} ${p.descricao ?? ""} ${tipoDoProduto(p).rotulo}`
          .toLowerCase()
          .includes(termo),
      )
      .filter((p) => !ocultar(p))
      .slice(0, 30);
  }, [produtos, termo]);

  const grupoAtual = tipoAtual ? (grupos.find((g) => g.tipo.chave === tipoAtual.chave) ?? null) : null;
  const produtosDoGrupo = grupoAtual ? grupoAtual.produtos.filter((p) => !ocultar(p)) : [];
  const familias = mostrarFiltroDeFamilia(produtosDoGrupo) ? familiasDoGrupo(produtosDoGrupo) : [];
  const produtosNaGrade = termo ? resultadosDaBusca : filtrarPorFamilia(produtosDoGrupo, familiaFiltro);
  // Os favoritos entram como o primeiro atalho, antes dos que o orçamento manda.
  const atalhosComFavoritos: AtalhoDeProdutos[] =
    favoritos.length > 0 ? [{ titulo: "Favoritos", icone: "Star", ids: favoritos }, ...atalhos] : atalhos;

  const escolher = (p: ProdutoDaEscolha) => {
    onEscolherProduto(p);
    setBusca("");
    setTrocando(false);
  };

  if (!aberto) {
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
        ) : tipoConfirmado ? (
          <IlustracaoDoTipo chave={tipoConfirmado.chave} tamanho={44} marcado />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-link">
            <Pencil className="h-6 w-6" aria-hidden="true" />
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

      {/* Passo 1 concluído: o tipo vira uma linha curta e a grade fecha. */}
      {tipoAtual && !termo ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm" data-testid="tipo-escolhido">
          <IlustracaoDoTipo chave={tipoAtual.chave} tamanho={32} marcado />
          <span className="min-w-0 flex-1 truncate font-medium">{tipoAtual.rotulo}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={desabilitado} onClick={() => setTipoExplorado(null)}>
            Trocar tipo
          </Button>
        </div>
      ) : (
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
              return (
                <button
                  key={t.chave}
                  type="button"
                  role="radio"
                  aria-checked={marcado}
                  data-cartao
                  tabIndex={marcado || (!tipoAtual && indice === 0) ? 0 : -1}
                  disabled={desabilitado}
                  onClick={() => {
                    setBusca("");
                    setTipoExplorado(t.chave);
                    // Impressão 3D não é um produto de prateleira: o preço sai da calculadora.
                    if (t.chave === "impressao_3d" && onCalcularPeca3d) onCalcularPeca3d();
                  }}
                  className={cn(
                    "flex min-h-32 flex-col items-center justify-start gap-1.5 rounded-xl border px-2 pb-2 pt-3 text-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    marcado
                      ? "border-primary bg-primary/10 text-foreground shadow-sm"
                      : "border-border bg-card text-foreground hover:border-primary/50",
                  )}
                >
                  <IlustracaoDoTipo chave={t.chave} tamanho={56} marcado={marcado} />
                  <span className="text-sm font-semibold leading-tight">{t.rotulo}</span>
                  <span className="text-xs leading-none text-muted-foreground">
                    {t.chave === "impressao_3d" && onCalcularPeca3d
                      ? "calculadora"
                      : lista.length === 1
                        ? "1 produto"
                        : `${lista.length} produtos`}
                  </span>
                </button>
              );
            })}
      </div>
      )}

      {!tipoAtual && <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar produto"
          placeholder="Ou busque pelo nome, código ou descrição…"
          className="h-11 pl-9 sm:h-9"
          value={busca}
          disabled={desabilitado}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>}

      {/* Atalhos: só antes de escolher tipo ou digitar. */}
      {!termo && !tipoAtual && atalhosComFavoritos.some((a) => a.ids.some((id) => porId.has(id))) && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {atalhosComFavoritos.map((a) => {
            const lista = a.ids.map((id) => porId.get(id)).filter((p): p is ProdutoDaEscolha => !!p && !ocultar(p));
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
                    <IconeDoTipo icone={tipoDoProduto(p).icone} className="h-3.5 w-3.5 text-link" />
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
          {/* Famílias do tipo como filtro (só quando o tipo é grande): corta a grade sem passo a mais. */}
          {!termo && familias.length > 0 && (
            <div role="group" aria-label="Família" className="flex flex-wrap gap-1.5" data-testid="filtro-de-familia">
              {[{ familia: null as string | null, rotulo: `Todas (${produtosDoGrupo.length})` }, ...familias.map((f) => ({ familia: f.familia as string | null, rotulo: `${f.familia} (${f.quantidade})` }))].map((f) => {
                const ativo = familiaFiltro === f.familia;
                return (
                  <button
                    key={f.familia ?? "todas"}
                    type="button"
                    aria-pressed={ativo}
                    disabled={desabilitado}
                    onClick={() => setFamiliaFiltro(f.familia)}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors sm:min-h-9",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      ativo ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-foreground hover:border-primary/50",
                    )}
                  >
                    {f.rotulo}
                  </button>
                );
              })}
            </div>
          )}
          <div
            ref={gradeDeProdutos.ref}
            role="group"
            aria-label={termo ? "Produtos encontrados" : `Produtos de ${grupoAtual!.tipo.rotulo}`}
            data-colunas={gradeDeProdutos.colunas}
            onKeyDown={moverFocoNaGrade}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          >
            {produtosNaGrade.map((p, indice) => {
              const t = tipoDoProduto(p);
              const marcado = p.id === produtoId;
              const favorito = favoritos.includes(p.id);
              const preco = verPreco ? precoLegivel(p) : null;
              const campos = camposDaUnidade(p.unidade);
              return (
                <div key={p.id} className="relative">
                  <button
                    type="button"
                    data-cartao
                    aria-pressed={marcado}
                    tabIndex={marcado || (!produtoId && indice === 0) ? 0 : -1}
                    disabled={desabilitado}
                    onClick={() => escolher(p)}
                    className={cn(
                      "flex h-full w-full flex-col gap-2 rounded-xl border p-2 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      marcado
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border bg-card hover:border-primary/50",
                    )}
                  >
                    {/* Foto do catálogo em cima, como vitrine; sem foto, o desenho do tipo no lugar. */}
                    {p.imagem_url ? (
                      <img src={p.imagem_url} alt="" className="aspect-square w-full rounded-lg object-cover" />
                    ) : (
                      <span className="grid aspect-square w-full place-items-center rounded-lg bg-muted/40" data-testid="sem-foto">
                        <IlustracaoDoTipo chave={t.chave} tamanho={56} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.nome}</span>
                      {p.descricao && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">{p.descricao}</span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span className="rounded border px-1.5 py-px font-mono text-xs text-muted-foreground">
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
                  {/* Estrela fora do cartão (botão dentro de botão não vale): favorito de quem vende. */}
                  <button
                    type="button"
                    aria-pressed={favorito}
                    aria-label={favorito ? `Tirar ${p.nome} dos favoritos` : `Pôr ${p.nome} nos favoritos`}
                    disabled={desabilitado}
                    onClick={() => alternarEstrela(p.id)}
                    className={cn(
                      "absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border bg-card/95 shadow-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      favorito ? "border-amber-500 text-amber-600" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Star className={cn("h-4 w-4", favorito && "fill-amber-400")} aria-hidden="true" />
                  </button>
                </div>
              );
            })}

            {/* Peça 3D: o produto, o material e o preço saem da calculadora (fatiador, filamento, foto). */}
            {!termo && grupoAtual!.tipo.chave === "impressao_3d" && onCalcularPeca3d && (
              <button
                type="button"
                data-cartao
                data-testid="calcular-peca-3d"
                tabIndex={-1}
                disabled={desabilitado}
                onClick={onCalcularPeca3d}
                className="col-span-full flex min-h-[4.5rem] items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 p-2 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-primary/10 text-link">
                  <Box className="h-7 w-7" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Calcular a peça 3D</span>
                  <span className="block text-xs text-muted-foreground">
                    Print do fatiador, impressora, filamento, peso, tempo e foto do modelo. A peça entra como item deste orçamento.
                  </span>
                </span>
              </button>
            )}

            {/* Fora do catálogo: a descrição, a unidade e o preço são digitados. */}
            {!termo && (
              <button
                type="button"
                data-cartao
                tabIndex={-1}
                disabled={desabilitado}
                onClick={() => {
                  onItemLivre(grupoAtual!.tipo);
                  setTrocando(false);
                }}
                className="col-span-full flex min-h-[4.5rem] items-center gap-3 rounded-lg border border-dashed p-2 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
