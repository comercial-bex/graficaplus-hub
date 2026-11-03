import type { ProdutoDaEscolha } from "@/components/orcamento/escolha-de-produto";
import type { TipoDeProduto } from "@/domain/orcamentos/tipos-de-produto";
import type { ItemDoCatalogo } from "@/domain/parceiros/preco";
import { precoAPartirDe, type ExtrasDoProduto } from "@/domain/parceiros/vitrine";

/**
 * A tabela do parceiro no formato que a escolha em cartões da equipe lê
 * (tipo → produto com foto, unidade e preço). Decisão do dono (02/11/2026): o
 * parceiro adiciona item do mesmo jeito que a equipe; só o preço mostrado é o
 * dele, não o de balcão.
 *
 * Sem rede e sem React, para o mapeamento poder ser conferido em teste.
 */

/** O preço que o cartão mostra é o que o parceiro paga (a faixa mais barata, quando há faixas). */
export function produtoDaEscolhaDoParceiro(
  item: ItemDoCatalogo,
  extra?: ExtrasDoProduto | null,
): ProdutoDaEscolha {
  const preco = precoAPartirDe(item);
  return {
    id: item.produto_id,
    nome: item.nome,
    sku: null,
    descricao: extra?.descricao ?? null,
    // A regra de tipo (lona, adesivo, placa…) lê a categoria do catálogo; sem ela, "outros".
    categoria: item.categoria ?? "outros",
    tipo: extra?.tipo === "servico" ? "servico" : "produto",
    // Produto por área pede largura × altura: a unidade "m2" é o que liga esse pedido.
    unidade: item.por_area ? "m2" : item.unidade,
    preco_base: preco,
    preco_parceiro: preco,
    imagem_url: extra?.imagem_url ?? null,
  };
}

export function produtosDaEscolhaDoParceiro(
  catalogo: readonly ItemDoCatalogo[],
  extras: readonly ExtrasDoProduto[] = [],
): ProdutoDaEscolha[] {
  const porId = new Map(extras.map((e) => [e.produto_id, e]));
  return catalogo.map((item) => produtoDaEscolhaDoParceiro(item, porId.get(item.produto_id)));
}

/**
 * O parceiro vende por unidade ou por m² — são as duas opções do campo
 * "Vendido por". Um item fora da tabela nasce com a unidade do tipo escolhido
 * (lona e adesivo em m², o resto por unidade), reduzida a essas duas.
 */
export function unidadeDoParceiroParaOTipo(tipo: Pick<TipoDeProduto, "unidadePadrao">): "un" | "m²" {
  const u = tipo.unidadePadrao.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace("²", "2");
  return u === "m2" ? "m²" : "un";
}
