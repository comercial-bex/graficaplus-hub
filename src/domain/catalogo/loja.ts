import {
  COMBINA_COM,
  CATEGORIAS,
  categoriaDaSecao,
  type Categoria,
} from "@/domain/catalogo/categorias-da-loja";
import type { FotoDoItem } from "@/domain/catalogo/fotos";
import type { ItemDoCatalogo, PrecoDaOpcao, SecaoDoCatalogo } from "@/domain/catalogo/itens";
import {
  ROTULO_DA_MODALIDADE,
  type Modalidade,
  type UnidadeDePreco,
} from "@/domain/catalogo/modalidades";
import type { ItemDaVitrine } from "@/domain/catalogo/vitrine";

/**
 * A LOJA: o catálogo como mini e-commerce, só para orçar.
 *
 * O DONO (06/10/2026): "o catálogo tem de ser estruturado como um mini
 * e-commerce, só para orçamento. É o que a gente mostra no iPad, no computador
 * ou no celular. Para cada produto que eu selecionar, escolho a quantidade;
 * vai para o orçamento; dá para fazer orçamento prévio a partir do catálogo.
 * Tem de trazer alternativas e sugestões, como o e-commerce faz."
 *
 * Um tipo só de item (`ItemDaLoja`) serve às duas vitrines — a da equipe,
 * logada, e a do cliente, pelo link — e por isso ele só carrega o que o
 * CLIENTE pode ver: código BX, nome, especificação, foto, categoria e preço de
 * venda (ou "sob consulta"). O que identifica o item para o orçamento viaja em
 * `ref`, que o cliente não tem (ele pede pelo código).
 *
 * A COSTURA PARA OS PRODUTOS DA GRÁFICA: `ref.origem` é "catalogo" hoje; o
 * desenho já aceita "produto" (tabela `produtos`), para a loja um dia mostrar
 * o que a Bex Print mesma produz. Não está implementado — ver o relatório.
 *
 * Domínio puro.
 */

export type RefDoItemDaLoja =
  | { origem: "catalogo"; item_id: string; catalogo_id: string }
  | { origem: "produto"; produto_id: string };

export type OpcaoDaLoja = {
  modalidade: Modalidade;
  rotulo: string;
  /** Na unidade do preço do item. `null` = sob consulta. Nunca zero. */
  preco: number | null;
  quantidade_minima: number | null;
  multiplo: number | null;
  faixa: string | null;
  faixa_max: number | null;
};

export type ItemDaLoja = {
  codigo: string;
  nome: string;
  especificacao: string | null;
  dimensoes: string | null;
  secao: string | null;
  categoria: Categoria;
  unidade_preco: UnidadeDePreco;
  foto: FotoDoItem | null;
  opcoes: OpcaoDaLoja[];
  /** Quem é o item para o orçamento. O cliente não tem (pede pelo código). */
  ref: RefDoItemDaLoja | null;
  ordem: number;
};

/**
 * O item da tela da equipe vira item da loja — só se tem foto e está na
 * tabela: a loja é o que se mostra ao cliente, e item sem foto não se mostra.
 * O preço vem de `catalogo_precos` no nível de quem pede; sem a lista de
 * preços (quem não vê preço), tudo é "sob consulta".
 */
export function itemDaLojaDoCatalogo(
  item: ItemDoCatalogo,
  foto: FotoDoItem | null,
  secao: SecaoDoCatalogo | null,
  precos: PrecoDaOpcao[] | null,
): ItemDaLoja | null {
  if (!item.tem_foto || !foto || item.situacao !== "ativo") return null;
  return {
    codigo: item.codigo_bex,
    nome: item.nome,
    especificacao: item.especificacao ?? secao?.especificacao ?? null,
    dimensoes: item.dimensoes,
    secao: secao?.titulo ?? null,
    categoria: categoriaDaSecao(secao),
    unidade_preco: item.unidade_preco,
    foto,
    opcoes: item.modalidades.map((m) => {
      const p = precos?.find((x) => x.modalidade === m.modalidade)?.preco ?? null;
      return {
        modalidade: m.modalidade,
        rotulo: ROTULO_DA_MODALIDADE[m.modalidade],
        preco: p != null && p > 0 ? p : null,
        quantidade_minima: m.quantidade_minima,
        multiplo: m.multiplo,
        faixa: m.faixa,
        faixa_max: m.faixa_max,
      };
    }),
    ref: { origem: "catalogo", item_id: item.id, catalogo_id: item.catalogo_id },
    ordem: item.ordem,
  };
}

/** O item da vitrine do cliente vira item da loja. Sem `ref`: o cliente pede pelo código. */
export function itemDaLojaDaVitrine(item: ItemDaVitrine, ordem: number): ItemDaLoja {
  return {
    codigo: item.codigo,
    nome: item.nome,
    especificacao: item.especificacao,
    dimensoes: item.dimensoes,
    secao: item.secao,
    categoria: categoriaDaSecao({ categoria: item.categoria, titulo: item.secao }),
    unidade_preco: item.unidade_preco,
    foto: item.foto,
    opcoes: item.opcoes.map((o) => ({
      modalidade: o.modalidade,
      rotulo: o.rotulo,
      preco: o.preco,
      quantidade_minima: o.quantidade_minima,
      multiplo: o.multiplo,
      faixa: o.faixa,
      faixa_max: null,
    })),
    ref: null,
    ordem,
  };
}

/** O menor preço do item ("a partir de"), ou `null` quando tudo é sob consulta. */
export function aPartirDe(item: Pick<ItemDaLoja, "opcoes">): number | null {
  const precos = item.opcoes.map((o) => o.preco).filter((p): p is number => p != null);
  return precos.length > 0 ? Math.min(...precos) : null;
}

function chaveDeBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca por nome, código BX ("bx12" acha BX-0012), especificação e seção; filtro por categoria. */
export function buscarNaLoja(
  itens: ItemDaLoja[],
  criterio: { busca: string; categoria: Categoria | null },
): ItemDaLoja[] {
  const termos = chaveDeBusca(criterio.busca).split(/\s+/).filter(Boolean);
  return itens.filter((item) => {
    if (criterio.categoria && item.categoria !== criterio.categoria) return false;
    if (termos.length === 0) return true;
    const alvo = chaveDeBusca(
      `${item.nome} ${item.codigo} ${item.especificacao ?? ""} ${item.secao ?? ""}`,
    );
    const codigo = item.codigo.toLowerCase().replace(/[^a-z0-9]/g, "");
    return termos.every((t) => {
      if (alvo.includes(t)) return true;
      const compacto = t.replace(/[^a-z0-9]/g, "");
      if (!compacto) return false;
      return (
        codigo.includes(compacto) ||
        codigo.replace(/^bx0*/, "bx").includes(compacto.replace(/^bx0*/, "bx"))
      );
    });
  });
}

/** A opção que a loja oferece de cara: a primeira com preço; sem preço nenhum, a primeira. */
export function opcaoPadrao(item: Pick<ItemDaLoja, "opcoes">): OpcaoDaLoja | null {
  return item.opcoes.find((o) => o.preco != null) ?? item.opcoes[0] ?? null;
}

export type AzulejoDeCategoria = {
  categoria: Categoria;
  rotulo: string;
  descricao: string;
  quantidade: number;
  /** A foto de um item da categoria, para o azulejo. */
  foto: FotoDoItem | null;
};

/** Os azulejos da entrada da loja: só as categorias que têm item, na ordem da lista. */
export function azulejosDeCategorias(itens: ItemDaLoja[]): AzulejoDeCategoria[] {
  const saida: AzulejoDeCategoria[] = [];
  for (const c of CATEGORIAS) {
    const da = itens.filter((i) => i.categoria === c.chave);
    if (da.length === 0) continue;
    // O item com preço vem primeiro: o azulejo mostra o que dá para orçar.
    const capa = da.find((i) => aPartirDe(i) != null && i.foto) ?? da.find((i) => i.foto) ?? null;
    saida.push({
      categoria: c.chave,
      rotulo: c.rotulo,
      descricao: c.descricao,
      quantidade: da.length,
      foto: capa?.foto ?? null,
    });
  }
  return saida;
}

export const LIMITE_DE_SUGESTOES = 6;

/**
 * "Alternativas": itens da MESMA categoria com preço até 30% acima ou abaixo
 * do deste, os mais próximos primeiro. Sem preço (sob consulta) de um lado ou
 * do outro, vale a mesma SEÇÃO da tabela — que é a prateleira do fornecedor.
 * Regra fixa, sem IA.
 */
export function alternativas(
  item: ItemDaLoja,
  itens: ItemDaLoja[],
  limite = LIMITE_DE_SUGESTOES,
): ItemDaLoja[] {
  const preco = aPartirDe(item);
  const outros = itens.filter((i) => i.codigo !== item.codigo);
  if (preco != null) {
    const comPreco = outros
      .map((i) => ({ i, p: aPartirDe(i) }))
      .filter(
        (x): x is { i: ItemDaLoja; p: number } => x.i.categoria === item.categoria && x.p != null,
      )
      .filter((x) => Math.abs(x.p - preco) <= preco * 0.3)
      .sort((a, b) => Math.abs(a.p - preco) - Math.abs(b.p - preco) || a.i.ordem - b.i.ordem)
      .map((x) => x.i);
    if (comPreco.length > 0) return comPreco.slice(0, limite);
  }
  return outros
    .filter((i) => item.secao != null && i.secao === item.secao)
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, limite);
}

/**
 * "Combina com": itens das categorias complementares (`COMBINA_COM`), uma
 * rodada por categoria para variar a vitrine, os com preço primeiro.
 */
export function combinaCom(
  item: ItemDaLoja,
  itens: ItemDaLoja[],
  limite = LIMITE_DE_SUGESTOES,
): ItemDaLoja[] {
  return deCategoriasComplementares([item.categoria], new Set([item.codigo]), itens, limite);
}

/**
 * "Quem leva isso também costuma pedir": o mesmo mapa, a partir de TUDO que
 * está no carrinho, sem repetir o que já está nele.
 */
export function sugestoesDoCarrinho(
  carrinho: { categoria: Categoria; codigo: string }[],
  itens: ItemDaLoja[],
  limite = LIMITE_DE_SUGESTOES,
): ItemDaLoja[] {
  if (carrinho.length === 0) return [];
  const categorias = [...new Set(carrinho.map((l) => l.categoria))];
  return deCategoriasComplementares(
    categorias,
    new Set(carrinho.map((l) => l.codigo)),
    itens,
    limite,
  );
}

function deCategoriasComplementares(
  origem: Categoria[],
  excluir: Set<string>,
  itens: ItemDaLoja[],
  limite: number,
): ItemDaLoja[] {
  const alvo: Categoria[] = [];
  for (const c of origem) {
    for (const d of COMBINA_COM[c]) {
      if (!origem.includes(d) && !alvo.includes(d)) alvo.push(d);
    }
  }
  const porCategoria = alvo.map((c) =>
    itens
      .filter((i) => i.categoria === c && !excluir.has(i.codigo))
      .sort(
        (a, b) => Number(aPartirDe(b) != null) - Number(aPartirDe(a) != null) || a.ordem - b.ordem,
      ),
  );
  const saida: ItemDaLoja[] = [];
  for (let rodada = 0; saida.length < limite; rodada++) {
    let pegou = false;
    for (const lista of porCategoria) {
      const i = lista[rodada];
      if (i && saida.length < limite) {
        saida.push(i);
        pegou = true;
      }
    }
    if (!pegou) break;
  }
  return saida;
}
