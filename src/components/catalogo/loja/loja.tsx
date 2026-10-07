import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronLeft, ImageOff, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Carrinho } from "@/domain/catalogo/carrinho";
import { ROTULO_DA_CATEGORIA, type Categoria } from "@/domain/catalogo/categorias-da-loja";
import {
  azulejosDeCategorias,
  buscarNaLoja,
  type AzulejoDeCategoria,
  type ItemDaLoja,
  type OpcaoDaLoja,
} from "@/domain/catalogo/loja";
import { enderecoDaFoto } from "@/lib/catalogo-publico";
import { CartaoDaLoja } from "@/components/catalogo/loja/cartao-da-loja";
import { ProdutoDaLoja } from "@/components/catalogo/loja/produto-da-loja";

const PASSO = 48;

/**
 * A loja em si — a mesma para a equipe (logada, /catalogos) e para o cliente
 * (pelo link, /catalogo/$token):
 *
 *   entrada      azulejos de categoria com a foto de um item de cada uma
 *   categoria    a grade de produtos, com busca e o seletor de quantidade
 *   produto      a ficha, com as opções de gravação e as sugestões
 *
 * Quem chama entrega os itens, o carrinho e o que fazer ao adicionar; a loja
 * não sabe se quem olha é vendedor ou cliente — e por isso nunca mostra nada
 * que o cliente não possa ver.
 */
export function Loja({
  itens,
  carrinho,
  onAdicionar,
  onAbrirCarrinho,
  acima,
}: {
  itens: ItemDaLoja[];
  carrinho: Carrinho;
  onAdicionar: (item: ItemDaLoja, opcao: OpcaoDaLoja, quantidade: number) => void;
  onAbrirCarrinho: () => void;
  /** O que vai acima da busca (o cabeçalho da vitrine, por exemplo). */
  acima?: ReactNode;
}) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<Categoria | null>(null);
  const [produto, setProduto] = useState<ItemDaLoja | null>(null);
  const [limite, setLimite] = useState(PASSO);

  useEffect(() => setLimite(PASSO), [busca, categoria]);

  const azulejos = useMemo(() => azulejosDeCategorias(itens), [itens]);
  const visiveis = useMemo(
    () => buscarNaLoja(itens, { busca, categoria }),
    [itens, busca, categoria],
  );
  const noCarrinho = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of carrinho) m.set(l.codigo, (m.get(l.codigo) ?? 0) + l.quantidade);
    return m;
  }, [carrinho]);
  const pecasNoCarrinho = carrinho.reduce((s, l) => s + l.quantidade, 0);
  const naEntrada = busca.trim() === "" && categoria === null;

  function adicionar(item: ItemDaLoja, opcao: OpcaoDaLoja, quantidade: number) {
    onAdicionar(item, opcao, quantidade);
    setProduto(null);
    toast.success(`${item.codigo} no carrinho: ${quantidade.toLocaleString("pt-BR")} peças.`, {
      action: { label: "Ver carrinho", onClick: onAbrirCarrinho },
    });
  }

  return (
    <div className="space-y-4">
      {acima}

      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código BX"
              className="h-11 pl-9"
              aria-label="Buscar na loja"
            />
          </div>
          <Button
            type="button"
            variant={carrinho.length > 0 ? "default" : "outline"}
            className="relative h-11 shrink-0"
            onClick={onAbrirCarrinho}
          >
            <ShoppingCart className="h-5 w-5" />
            <span className="ml-2 hidden sm:inline">Carrinho</span>
            {carrinho.length > 0 && (
              <span className="ml-2 rounded-full bg-background/20 px-1.5 text-xs font-semibold">
                {carrinho.length}
              </span>
            )}
            <span className="sr-only">{pecasNoCarrinho} peças no carrinho</span>
          </Button>
        </div>
        {!naEntrada && (
          <div
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label="Categorias"
          >
            <Chip ativo={categoria === null} onClick={() => setCategoria(null)}>
              Tudo ({itens.length})
            </Chip>
            {azulejos.map((a) => (
              <Chip
                key={a.categoria}
                ativo={categoria === a.categoria}
                onClick={() => setCategoria(categoria === a.categoria ? null : a.categoria)}
              >
                {a.rotulo} ({a.quantidade})
              </Chip>
            ))}
          </div>
        )}
      </div>

      {itens.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          A loja está sem produtos com foto agora.
        </p>
      ) : naEntrada ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">O que você procura?</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {azulejos.map((a) => (
              <Azulejo key={a.categoria} azulejo={a} onClick={() => setCategoria(a.categoria)} />
            ))}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 px-2"
              onClick={() => {
                setCategoria(null);
                setBusca("");
              }}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Categorias
            </Button>
            <p className="text-sm text-muted-foreground">
              {categoria ? ROTULO_DA_CATEGORIA[categoria] : "Todos"} ·{" "}
              {visiveis.length === 1 ? "1 produto" : `${visiveis.length} produtos`}
              {busca.trim() ? ` com "${busca.trim()}"` : ""}
            </p>
          </div>
          {visiveis.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nada encontrado com essa busca. Tente outra palavra ou o código BX.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visiveis.slice(0, limite).map((item) => (
                  <CartaoDaLoja
                    key={item.codigo}
                    item={item}
                    noCarrinho={noCarrinho.get(item.codigo) ?? 0}
                    onAbrir={() => setProduto(item)}
                    onAdicionar={(opcao, quantidade) => adicionar(item, opcao, quantidade)}
                  />
                ))}
              </div>
              {visiveis.length > limite && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setLimite((l) => l + PASSO)}
                  >
                    Mostrar mais ({visiveis.length - limite} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <ProdutoDaLoja
        item={produto}
        itens={itens}
        onOpenChange={(v) => !v && setProduto(null)}
        onAbrirOutro={setProduto}
        onAdicionar={adicionar}
      />
    </div>
  );
}

function Azulejo({ azulejo, onClick }: { azulejo: AzulejoDeCategoria; onClick: () => void }) {
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const url = enderecoDaFoto(azulejo.foto);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFotoFalhou(true)}
            className="absolute inset-0 h-full w-full object-contain p-3 transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="space-y-0.5 p-3">
        <p className="text-sm font-semibold leading-snug">{azulejo.rotulo}</p>
        <p className="text-xs text-muted-foreground">
          {azulejo.quantidade === 1 ? "1 produto" : `${azulejo.quantidade} produtos`}
        </p>
      </div>
    </button>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "h-10 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium",
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
