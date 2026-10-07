import { useState } from "react";
import { ImageOff, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRECO_POR } from "@/domain/catalogo/modalidades";
import { precoEmReais } from "@/domain/catalogo/preco-de-venda";
import { quantidadeInicial, quantidadeParaCliente } from "@/domain/catalogo/quantidade";
import { aPartirDe, opcaoPadrao, type ItemDaLoja, type OpcaoDaLoja } from "@/domain/catalogo/loja";
import { enderecoDaFoto } from "@/lib/catalogo-publico";
import { StepperQuantidade } from "@/components/catalogo/loja/stepper-quantidade";

/**
 * Um produto na grade da loja: foto, nome, código BX, preço ("a partir de")
 * ou "sob consulta", o seletor de quantidade e "Adicionar". Tocar na foto ou
 * no nome abre a ficha, com todas as opções de gravação e as sugestões.
 */
export function CartaoDaLoja({
  item,
  noCarrinho,
  onAbrir,
  onAdicionar,
}: {
  item: ItemDaLoja;
  /** Peças deste item já no carrinho (todas as opções somadas). */
  noCarrinho: number;
  onAbrir: () => void;
  onAdicionar: (opcao: OpcaoDaLoja, quantidade: number) => void;
}) {
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const opcao = opcaoPadrao(item);
  const [quantidade, setQuantidade] = useState(() =>
    opcao
      ? quantidadeInicial({ quantidadeMinima: opcao.quantidade_minima, multiplo: opcao.multiplo })
      : 1,
  );
  const url = enderecoDaFoto(item.foto);
  const menor = aPartirDe(item);
  const regra = opcao
    ? quantidadeParaCliente({
        quantidadeMinima: opcao.quantidade_minima,
        multiplo: opcao.multiplo,
        faixa: opcao.faixa,
      })
    : null;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-card",
        noCarrinho > 0 ? "border-primary/60" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="relative aspect-square w-full overflow-hidden bg-white text-left"
        aria-label={`Abrir ${item.nome}`}
      >
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt={item.nome}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFotoFalhou(true)}
            className="absolute inset-0 h-full w-full object-contain p-3"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImageOff className="h-6 w-6" /> A foto não carregou
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide">
          {item.codigo}
        </span>
        {noCarrinho > 0 && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            <ShoppingCart className="h-3 w-3" /> {noCarrinho}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <button type="button" onClick={onAbrir} className="text-left">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{item.nome}</h3>
        </button>
        <div className="min-h-10">
          {menor != null ? (
            <p className="text-sm">
              <span className="text-xs text-muted-foreground">
                {item.opcoes.length > 1 ? "a partir de " : ""}
              </span>
              <span className="font-bold">{precoEmReais(menor)}</span>{" "}
              <span className="text-xs text-muted-foreground">{PRECO_POR[item.unidade_preco]}</span>
            </p>
          ) : (
            <p className="text-sm font-medium text-muted-foreground">Preço sob consulta</p>
          )}
          {opcao && item.opcoes.length > 1 && (
            <p className="text-xs text-muted-foreground">
              {opcao.rotulo} ·{" "}
              {item.opcoes.length - 1 === 1
                ? "mais 1 opção"
                : `mais ${item.opcoes.length - 1} opções`}
            </p>
          )}
          {regra && <p className="text-xs text-muted-foreground">{regra}</p>}
        </div>

        {opcao && (
          <div className="mt-auto flex flex-wrap items-start gap-2 pt-1">
            <StepperQuantidade
              valor={quantidade}
              regra={{
                quantidadeMinima: opcao.quantidade_minima,
                multiplo: opcao.multiplo,
                faixa: opcao.faixa,
                faixaMax: opcao.faixa_max,
              }}
              rotulo={opcao.rotulo}
              onChange={setQuantidade}
            />
            <Button
              type="button"
              className="h-11 flex-1"
              onClick={() => onAdicionar(opcao, quantidade)}
            >
              <ShoppingCart className="mr-1 h-4 w-4" /> Adicionar
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

/** Um produto em miniatura, para as faixas de "alternativas" e "combina com". */
export function MiniaturaDaLoja({ item, onAbrir }: { item: ItemDaLoja; onAbrir: () => void }) {
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const url = enderecoDaFoto(item.foto);
  const menor = aPartirDe(item);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-36 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-muted"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt={item.nome}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFotoFalhou(true)}
            className="absolute inset-0 h-full w-full object-contain p-2"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <p className="line-clamp-2 text-xs font-medium leading-snug">{item.nome}</p>
        <p className="text-[11px] text-muted-foreground">
          {menor != null ? precoEmReais(menor) : "Sob consulta"} ·{" "}
          <span className="font-mono">{item.codigo}</span>
        </p>
      </div>
    </button>
  );
}
