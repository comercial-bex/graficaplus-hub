import { useMemo, useState, type ReactNode } from "react";
import { ImageOff, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  resumoDoCarrinho,
  totalDaLinha,
  type Carrinho,
  type LinhaDoCarrinho,
} from "@/domain/catalogo/carrinho";
import { sugestoesDoCarrinho, type ItemDaLoja } from "@/domain/catalogo/loja";
import { PRECO_POR } from "@/domain/catalogo/modalidades";
import { precoEmReais } from "@/domain/catalogo/preco-de-venda";
import { enderecoDaFoto } from "@/lib/catalogo-publico";
import { StepperQuantidade } from "@/components/catalogo/loja/stepper-quantidade";
import { MiniaturaDaLoja } from "@/components/catalogo/loja/cartao-da-loja";
import { Faixa } from "@/components/catalogo/loja/produto-da-loja";

/**
 * O carrinho: as linhas com quantidade e opção, o subtotal do que tem preço
 * (e quantas linhas estão sob consulta), "Quem leva isso também costuma
 * pedir", e o botão principal — que quem chama decide: "Gerar orçamento" para
 * a equipe, "Pedir cotação" para o cliente.
 */
export function CarrinhoDrawer({
  aberto,
  onOpenChange,
  carrinho,
  itens,
  onMudarQuantidade,
  onRemover,
  onLimpar,
  onAbrirProduto,
  acao,
  rodape,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  carrinho: Carrinho;
  itens: ItemDaLoja[];
  onMudarQuantidade: (chave: string, quantidade: number) => void;
  onRemover: (chave: string) => void;
  onLimpar: () => void;
  onAbrirProduto: (item: ItemDaLoja) => void;
  /** O botão principal do carrinho. */
  acao: ReactNode;
  rodape?: ReactNode;
}) {
  const resumo = useMemo(() => resumoDoCarrinho(carrinho), [carrinho]);
  const sugestoes = useMemo(() => sugestoesDoCarrinho(carrinho, itens), [carrinho, itens]);

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" /> Carrinho
          </SheetTitle>
          <SheetDescription>
            {resumo.linhas === 0
              ? "Nada aqui ainda. Escolha a quantidade de um produto e toque em Adicionar."
              : `${resumo.linhas === 1 ? "1 item" : `${resumo.linhas} itens`} · ${resumo.pecas.toLocaleString("pt-BR")} peças`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {carrinho.length > 0 && (
            <ul className="divide-y divide-border">
              {carrinho.map((l) => (
                <LinhaDoCarrinhoView
                  key={l.chave}
                  linha={l}
                  onMudarQuantidade={(q) => onMudarQuantidade(l.chave, q)}
                  onRemover={() => onRemover(l.chave)}
                />
              ))}
            </ul>
          )}
          {sugestoes.length > 0 && (
            <div className="border-t border-border p-4">
              <Faixa
                titulo="Quem leva isso também costuma pedir"
                icone={<Sparkles className="h-4 w-4" />}
              >
                {sugestoes.map((s) => (
                  <MiniaturaDaLoja key={s.codigo} item={s} onAbrir={() => onAbrirProduto(s)} />
                ))}
              </Faixa>
            </div>
          )}
        </div>

        {carrinho.length > 0 && (
          <div className="space-y-3 border-t border-border bg-background p-4">
            <div className="space-y-0.5 text-sm">
              {resumo.subtotal != null ? (
                <p className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">
                    Subtotal
                    {resumo.semPreco > 0
                      ? ` (${resumo.comPreco} ${resumo.comPreco === 1 ? "item" : "itens"} com preço)`
                      : ""}
                  </span>
                  <span className="text-lg font-bold">{precoEmReais(resumo.subtotal)}</span>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Todos os itens estão sob consulta: o valor sai na cotação.
                </p>
              )}
              {resumo.semPreco > 0 && resumo.subtotal != null && (
                <p className="text-xs text-muted-foreground">
                  {resumo.semPreco === 1
                    ? "1 item sob consulta"
                    : `${resumo.semPreco} itens sob consulta`}
                  , fora do subtotal.
                </p>
              )}
            </div>
            {acao}
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" className="h-10" onClick={onLimpar}>
                <Trash2 className="mr-1 h-4 w-4" /> Esvaziar
              </Button>
              {rodape}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LinhaDoCarrinhoView({
  linha,
  onMudarQuantidade,
  onRemover,
}: {
  linha: LinhaDoCarrinho;
  onMudarQuantidade: (quantidade: number) => void;
  onRemover: () => void;
}) {
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const url = enderecoDaFoto(linha.foto);
  const total = totalDaLinha(linha);
  return (
    <li className="flex gap-3 p-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-white">
        {url && !fotoFalhou ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFotoFalhou(true)}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{linha.nome}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{linha.codigo}</span>
              {linha.modalidade !== "valor_unico" ? ` · ${linha.rotulo}` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label={`Tirar ${linha.codigo} do carrinho`}
            onClick={onRemover}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <StepperQuantidade
            valor={linha.quantidade}
            regra={linha.regra}
            rotulo={linha.rotulo}
            onChange={onMudarQuantidade}
          />
          <div className="text-right text-sm">
            {total != null && linha.preco != null ? (
              <>
                <p className="font-semibold">{precoEmReais(total)}</p>
                <p className="text-xs text-muted-foreground">
                  {precoEmReais(linha.preco)} {PRECO_POR[linha.unidade_preco]}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Sob consulta</p>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
