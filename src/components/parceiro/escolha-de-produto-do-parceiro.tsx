import { useMemo } from "react";
import { PenLine, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EscolhaDeProduto,
  precoLegivel,
  type ProdutoDaEscolha,
} from "@/components/orcamento/escolha-de-produto";
import { IlustracaoDoTipo } from "@/components/orcamento/ilustracoes-de-tipo";
import {
  camposDaUnidade,
  tipoDoProduto,
  tipoPelaChave,
  type ChaveDoTipo,
  type TipoDeProduto,
} from "@/domain/orcamentos/tipos-de-produto";
import type { ItemDoCatalogo } from "@/domain/parceiros/preco";
import type { ExtrasDoProduto } from "@/domain/parceiros/vitrine";
import { produtoDaEscolhaDoParceiro, produtosDaEscolhaDoParceiro } from "@/domain/parceiros/escolha";

/**
 * O parceiro escolhe o produto como a equipe (02/11/2026, pedido do dono): num
 * diálogo, primeiro o TIPO em cartões com desenho, depois o PRODUTO em cartões
 * com foto, unidade e o preço dele. A busca por nome continua para quem já sabe.
 *
 * O que é só do parceiro fica no rodapé: o item livre (serviço dele, que sai
 * no PDF e não vira pedido na gráfica).
 */
export function DialogoDeEscolhaDoProduto({
  aberto,
  titulo,
  catalogo,
  extras = [],
  carregando = false,
  tipoInicial = null,
  onFechar,
  onEscolherProduto,
  onItemLivre,
}: {
  aberto: boolean;
  titulo: string;
  catalogo: ItemDoCatalogo[];
  extras?: ExtrasDoProduto[];
  carregando?: boolean;
  /** Trocando o produto de um item: abre já nos produtos do tipo dele. */
  tipoInicial?: ChaveDoTipo | null;
  onFechar: () => void;
  onEscolherProduto: (produto: ItemDoCatalogo) => void;
  onItemLivre: (tipo: TipoDeProduto) => void;
}) {
  const produtos = useMemo(() => produtosDaEscolhaDoParceiro(catalogo, extras), [catalogo, extras]);
  const porId = useMemo(() => new Map(catalogo.map((p) => [p.produto_id, p])), [catalogo]);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="dialogo-escolha-do-produto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Toque no tipo, depois no produto. O preço mostrado é o que você paga à Bex Print.
          </DialogDescription>
        </DialogHeader>
        <EscolhaDeProduto
          produtos={produtos}
          carregando={carregando}
          verPreco
          produtoId={null}
          itemLivre={false}
          tipo={tipoInicial}
          descricaoAtual=""
          onEscolherProduto={(p: ProdutoDaEscolha) => {
            const item = porId.get(p.id);
            if (item) onEscolherProduto(item);
          }}
          onItemLivre={onItemLivre}
        />
        {/* Só do parceiro: o serviço dele, fora da tabela, que não vira pedido na gráfica. */}
        <button
          type="button"
          onClick={() => onItemLivre(tipoPelaChave("servico"))}
          className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-lg border border-dashed p-2 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="item-livre-do-parceiro"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-muted">
            <PenLine className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Item livre (serviço seu)</span>
            <span className="block text-xs">Instalação, arte, frete: sai no seu PDF e não vira pedido na gráfica.</span>
          </span>
        </button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A linha encolhida do produto no cartão do item, igual à da equipe depois da
 * escolha: foto (ou o desenho do tipo), nome, "tipo · por m² · preço" e o
 * botão "Trocar produto".
 */
export function LinhaDoProduto({
  produto,
  produtoId,
  extra,
  descricao,
  desabilitado = false,
  onTrocar,
}: {
  produto: ItemDoCatalogo | undefined;
  produtoId: string | null;
  extra?: ExtrasDoProduto | null;
  /** Descrição digitada, para o item livre. */
  descricao: string;
  desabilitado?: boolean;
  onTrocar: () => void;
}) {
  const adaptado = produto ? produtoDaEscolhaDoParceiro(produto, extra) : null;
  const tipo = adaptado ? tipoDoProduto(adaptado) : null;
  const preco = adaptado ? precoLegivel(adaptado) : null;
  const unidade = adaptado ? `por ${camposDaUnidade(adaptado.unidade).unidadeLegivel}` : null;

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-2 pl-3"
      data-testid="produto-escolhido"
    >
      {adaptado?.imagem_url ? (
        <img src={adaptado.imagem_url} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />
      ) : tipo ? (
        <IlustracaoDoTipo chave={tipo.chave} tamanho={44} marcado />
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-link">
          <Pencil className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {adaptado?.nome ?? (produtoId ? "Produto fora da tabela" : descricao.trim() || "Item livre (serviço seu)")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[tipo?.rotulo ?? (produtoId ? "Sem tipo" : "Serviço seu"), unidade, preco, !produtoId ? "não vira pedido" : null]
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
        onClick={onTrocar}
      >
        Trocar produto
      </Button>
    </div>
  );
}
