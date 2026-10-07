import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, Inbox, RefreshCw, Settings2 } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Dica } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { dicaAcao, dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { itensParaOrcar } from "@/domain/catalogo/carrinho";
import { lerCotacoes, lerLoja } from "@/components/catalogo/consultas";
import { Loja } from "@/components/catalogo/loja/loja";
import { CarrinhoDrawer } from "@/components/catalogo/loja/carrinho-drawer";
import { useCarrinho } from "@/components/catalogo/loja/use-carrinho";
import { GerarOrcamentoDialog } from "@/components/catalogo/gerar-orcamento-dialog";

export const Route = createFileRoute("/_authenticated/catalogos/")({
  head: () => ({ meta: [{ title: "Loja de brindes — BEX PRINT OS" }] }),
  component: LojaDaEquipePage,
});

/**
 * /catalogos é a LOJA: o catálogo de brindes como mini e-commerce, só para
 * orçar — o que a equipe mostra ao cliente no iPad, no computador ou no
 * celular. Categorias → produtos com foto, código BX e preço de venda →
 * ficha com as opções de gravação → carrinho → "Gerar orçamento" (um
 * orçamento em rascunho com tudo, com ou sem cliente).
 *
 * A gestão do catálogo (planilha, fotos, regra de venda, links) continua
 * inteira em /catalogos/gerenciar, pelo botão "Gerenciar" (catalogo.manage).
 * Os pedidos de cotação que os clientes fazem pelos links ficam em
 * /catalogos/pedidos.
 *
 * O que aparece aqui é só o que o CLIENTE pode ver: custo e margem ficam na
 * gestão. Item sem foto ou fora da tabela não entra na loja.
 */
function LojaDaEquipePage() {
  const { hasPermission, canSeePrices } = useAuth();
  const podeGerenciar = hasPermission("catalogo.manage");
  const podeOrcar = canSeePrices && hasPermission("orcamentos.create");
  const loja = useQuery({
    queryKey: ["catalogo-loja", canSeePrices],
    queryFn: () => lerLoja(canSeePrices),
  });
  const cotacoes = useQuery({ queryKey: ["catalogo-cotacoes"], queryFn: lerCotacoes });
  const { carrinho, adicionar, mudarQuantidade, remover, limpar } = useCarrinho("equipe");
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [gerando, setGerando] = useState(false);
  const prontos = itensParaOrcar(carrinho).prontos.length;

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/catalogos")}
        breadcrumb="Print OS · Comercial"
        title="Loja de brindes"
        description="O catálogo para mostrar ao cliente: foto, código Bex Print e preço de venda. Escolha a quantidade, monte o carrinho e gere o orçamento."
        actions={
          <>
            <Dica texto={dicaAcao("/catalogos", "pedidos")}>
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link to="/catalogos/pedidos">
                  <Inbox className="mr-1 h-4 w-4" /> Pedidos de cotação
                  {cotacoes.isSuccess && cotacoes.data.abertos > 0
                    ? ` (${cotacoes.data.abertos})`
                    : ""}
                </Link>
              </Button>
            </Dica>
            {podeGerenciar && (
              <Dica texto={dicaAcao("/catalogos", "gerenciar")}>
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link to="/catalogos/gerenciar">
                    <Settings2 className="mr-1 h-4 w-4" /> Gerenciar
                  </Link>
                </Button>
              </Dica>
            )}
          </>
        }
      />

      {loja.isPending ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Montando a loja…</CardContent>
        </Card>
      ) : loja.isError ? (
        <Card>
          <CardContent role="alert" className="space-y-2 p-6 text-sm">
            <p className="font-medium">Não deu para montar a loja.</p>
            <p className="text-muted-foreground">{mensagemErro(loja.error)}</p>
            <p className="text-muted-foreground">
              Isto é uma falha de consulta, não uma loja vazia.
            </p>
            <Button variant="outline" className="h-11 md:h-9" onClick={() => void loja.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : loja.data.catalogos.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nenhum catálogo ativo ainda.{" "}
            {podeGerenciar ? (
              <Link to="/catalogos/gerenciar" className="underline underline-offset-2">
                Cadastre o fornecedor e carregue a planilha.
              </Link>
            ) : (
              "Quem cadastra é a gestão."
            )}
          </CardContent>
        </Card>
      ) : (
        <Loja
          itens={loja.data.itens}
          carrinho={carrinho}
          onAdicionar={adicionar}
          onAbrirCarrinho={() => setCarrinhoAberto(true)}
          acima={
            loja.data.foraDaLoja > 0 ? (
              <p className="text-xs text-muted-foreground">
                {loja.data.itens.length} produtos na loja · {loja.data.foraDaLoja} itens do catálogo
                ficam de fora por não ter foto ou por estar fora da tabela
                {podeGerenciar ? " (Gerenciar → Fotos)" : ""}.
              </p>
            ) : null
          }
        />
      )}

      <CarrinhoDrawer
        aberto={carrinhoAberto}
        onOpenChange={setCarrinhoAberto}
        carrinho={carrinho}
        itens={loja.data?.itens ?? []}
        onMudarQuantidade={mudarQuantidade}
        onRemover={remover}
        onLimpar={limpar}
        onAbrirProduto={() => setCarrinhoAberto(false)}
        acao={
          podeOrcar ? (
            <Dica
              texto={
                prontos === 0
                  ? "Só item com preço de venda entra no orçamento."
                  : dicaAcao("/catalogos", "gerar_orcamento")
              }
            >
              <Button
                type="button"
                className="h-12 w-full text-base"
                disabled={prontos === 0}
                onClick={() => setGerando(true)}
              >
                <FileText className="mr-2 h-5 w-5" /> Gerar orçamento
                {prontos > 0 && prontos < carrinho.length
                  ? ` (${prontos} de ${carrinho.length})`
                  : ""}
              </Button>
            </Dica>
          ) : (
            <p className="text-sm text-muted-foreground">
              Gerar orçamento é de quem vê preço e cria orçamento. Anote os códigos BX e passe ao
              vendedor.
            </p>
          )
        }
      />

      <GerarOrcamentoDialog
        aberto={gerando}
        carrinho={carrinho}
        onOpenChange={setGerando}
        onGerado={(chaves) => {
          remover(chaves);
          setCarrinhoAberto(false);
        }}
      />
    </div>
  );
}
