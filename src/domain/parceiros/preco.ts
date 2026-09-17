/**
 * Preço do parceiro revendedor: quanto ele paga à gráfica e quanto cobra do
 * cliente dele.
 *
 * Duas contas moram no mesmo item e não podem se misturar:
 *
 *   CUSTO — o preço da tabela de parceiro (`parceiro_catalogo`). Quem decide o
 *   número é o banco, que recalcula tudo em `parceiro_enviar_pedido`; a tela só
 *   antecipa. Por isso as regras abaixo copiam as do banco, inclusive o
 *   arredondamento: `orcamento_itens` guarda preço do m², valor unitário e
 *   quantidade com 2 casas, e uma tela que mostrasse 4 prometeria centavos que
 *   o pedido não confirma.
 *
 *   VENDA — o preço que o parceiro digita para o cliente dele. É dele: sai no
 *   PDF com a marca dele e nunca chega à gráfica.
 *
 * Regras copiadas do banco:
 *   - faixa de quantidade: vale a maior quantidade mínima ≤ quantidade
 *     ARREDONDADA PARA CIMA; abaixo da primeira faixa não há preço;
 *   - m²: a peça é largura × altura (3 casas), nunca abaixo da área mínima do
 *     produto; a peça custa área × preço do m² (2 casas);
 *   - total = peça × quantidade, com quantidade mínima 1.
 */

import { areaUnitaria, ehUnidadeDeArea, temDimensoes } from "@/domain/orcamentos/area";

export type FaixaDoParceiro = {
  quantidade_minima: number;
  /** o preço de balcão da gráfica nesta faixa */
  preco_referencia: number;
  /** o que o parceiro paga nesta faixa */
  preco_parceiro: number;
};

export type TamanhoDoProduto = {
  nome: string;
  largura: number | null;
  altura: number | null;
  padrao?: boolean | null;
};

export type OrigemDoPreco = "faixa" | "oferta" | "piso" | "nivel";

export type ItemDoCatalogo = {
  produto_id: string;
  nome: string;
  categoria: string | null;
  unidade: string;
  por_area: boolean;
  area_minima: number | null;
  /** preço de balcão; nulo quando o produto é vendido por faixa */
  preco_referencia: number | null;
  /** preço do parceiro; nulo quando o produto é vendido por faixa */
  preco_parceiro: number | null;
  origem: OrigemDoPreco;
  oferta_id: string | null;
  oferta_titulo: string | null;
  faixas: FaixaDoParceiro[] | null;
  tamanhos: TamanhoDoProduto[];
};

/** Item do orçamento do parceiro, como está na tabela `parceiro_orcamento_itens`. */
export type ItemDoOrcamento = {
  produto_id: string | null;
  descricao: string;
  unidade: string;
  largura: number | null;
  altura: number | null;
  quantidade: number;
  /** preço do parceiro para o cliente dele, por unidade de venda (m² ou un) */
  preco_venda_unidade: number;
  acabamento?: string | null;
};

const arred = (valor: number, casas: number) => {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
};

const num = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normaliza a linha que vem da RPC. O PostgREST manda `numeric` como número,
 * mas o jsonb das faixas e tamanhos passa por dentro do Postgres e pode chegar
 * como texto — uma conta com "25.0000" concatenaria em vez de somar.
 */
export function normalizarCatalogo(linhas: unknown[]): ItemDoCatalogo[] {
  return (linhas ?? []).map((bruto) => {
    const l = bruto as Record<string, unknown>;
    const faixas = Array.isArray(l.faixas)
      ? (l.faixas as Record<string, unknown>[])
          .map((f) => ({
            quantidade_minima: num(f.quantidade_minima) ?? 0,
            preco_referencia: num(f.preco_referencia) ?? 0,
            preco_parceiro: num(f.preco_parceiro) ?? 0,
          }))
          .sort((a, b) => a.quantidade_minima - b.quantidade_minima)
      : null;
    return {
      produto_id: String(l.produto_id),
      nome: String(l.nome ?? ""),
      categoria: (l.categoria as string | null) ?? null,
      unidade: String(l.unidade ?? "un"),
      por_area: Boolean(l.por_area),
      area_minima: num(l.area_minima),
      preco_referencia: num(l.preco_referencia),
      preco_parceiro: num(l.preco_parceiro),
      origem: (l.origem as OrigemDoPreco) ?? "nivel",
      oferta_id: (l.oferta_id as string | null) ?? null,
      oferta_titulo: (l.oferta_titulo as string | null) ?? null,
      faixas: faixas && faixas.length > 0 ? faixas : null,
      tamanhos: Array.isArray(l.tamanhos)
        ? (l.tamanhos as Record<string, unknown>[]).map((t) => ({
            nome: String(t.nome ?? ""),
            largura: num(t.largura),
            altura: num(t.altura),
            padrao: Boolean(t.padrao),
          }))
        : [],
    };
  });
}

export type PrecoDaGrafica =
  | {
      tipo: "ok";
      /** por unidade de venda: m² ou peça */
      preco: number;
      /** preço de balcão na mesma quantidade — a sugestão de venda */
      referencia: number | null;
      faixa: FaixaDoParceiro | null;
      /** o próximo degrau, quando baixa o preço ("a partir de 250 un…") */
      proxima: FaixaDoParceiro | null;
    }
  | { tipo: "minimo"; minimo: number }
  | { tipo: "sem_preco" };

/** Quanto a gráfica cobra do parceiro por unidade de venda, nesta quantidade. */
export function precoDaGrafica(produto: ItemDoCatalogo, quantidade: number): PrecoDaGrafica {
  if (produto.faixas && produto.faixas.length > 0) {
    const q = Math.ceil(Number(quantidade) || 0);
    let aplicada: FaixaDoParceiro | null = null;
    for (const f of produto.faixas) if (f.quantidade_minima <= q) aplicada = f;
    if (!aplicada) return { tipo: "minimo", minimo: produto.faixas[0].quantidade_minima };
    const proxima =
      produto.faixas.find(
        (f) => f.quantidade_minima > q && f.preco_parceiro < (aplicada as FaixaDoParceiro).preco_parceiro,
      ) ?? null;
    return {
      tipo: "ok",
      preco: aplicada.preco_parceiro,
      referencia: aplicada.preco_referencia,
      faixa: aplicada,
      proxima,
    };
  }
  if (produto.preco_parceiro === null) return { tipo: "sem_preco" };
  return {
    tipo: "ok",
    preco: produto.preco_parceiro,
    referencia: produto.preco_referencia,
    faixa: null,
    proxima: null,
  };
}

/**
 * Preço de venda sugerido ao escolher um produto: o preço de balcão da gráfica.
 *
 * Vender pelo mesmo preço que a gráfica vende no balcão deixa o ganho do
 * parceiro igual ao desconto do nível dele, e evita que o canal de revenda
 * concorra por preço com o atendimento direto. É só a sugestão: o campo é dele.
 */
export function precoSugerido(produto: ItemDoCatalogo, quantidade: number): number | null {
  const preco = precoDaGrafica(produto, quantidade);
  if (preco.tipo === "ok") return preco.referencia ?? preco.preco;
  if (preco.tipo === "minimo" && produto.faixas) return produto.faixas[0].preco_referencia;
  return null;
}

/** Área de UMA peça em m², já com a área mínima do produto. Nulo sem medidas. */
export function areaDaPeca(
  item: Pick<ItemDoOrcamento, "largura" | "altura">,
  areaMinima?: number | null,
): number | null {
  if (!temDimensoes(item)) return null;
  return Math.max(areaUnitaria(item), Number(areaMinima) || 0);
}

/** Quantidade como o banco guarda: 2 casas e nunca menos que 1 na conta. */
const quantidadeDaConta = (q: number) => Math.max(arred(Number(q) || 0, 2), 1);

export type ValorDoItem = { unitario: number; total: number };

export type CustoDoItem =
  | ({ tipo: "ok"; precoUnidade: number; faixa: FaixaDoParceiro | null; proxima: FaixaDoParceiro | null } & ValorDoItem)
  /** serviço do próprio parceiro: vai no PDF dele e não vira pedido */
  | { tipo: "livre" }
  | { tipo: "pendente"; motivo: string };

/** O que o item custa ao parceiro quando vira pedido à gráfica. */
export function custoDoItem(item: ItemDoOrcamento, produto: ItemDoCatalogo | undefined): CustoDoItem {
  if (!item.produto_id) return { tipo: "livre" };
  if (!produto) return { tipo: "pendente", motivo: "Produto fora da tabela de parceiro" };
  if (produto.por_area && !temDimensoes(item)) {
    return { tipo: "pendente", motivo: "Informe largura e altura" };
  }

  const preco = precoDaGrafica(produto, item.quantidade);
  if (preco.tipo === "minimo") {
    return { tipo: "pendente", motivo: `Pedido mínimo de ${preco.minimo} ${produto.unidade}` };
  }
  if (preco.tipo === "sem_preco") return { tipo: "pendente", motivo: "Produto sem preço na tabela" };

  const precoUnidade = arred(preco.preco, 2);
  const unitario = produto.por_area
    ? arred((areaDaPeca(item, produto.area_minima) ?? 0) * precoUnidade, 2)
    : precoUnidade;
  return {
    tipo: "ok",
    precoUnidade,
    faixa: preco.faixa,
    proxima: preco.proxima,
    unitario,
    total: arred(unitario * quantidadeDaConta(item.quantidade), 2),
  };
}

/** Se o item é cobrado por área: pelo produto quando há, pela unidade quando é livre. */
export function vendidoPorArea(item: ItemDoOrcamento, produto: ItemDoCatalogo | undefined): boolean {
  if (item.produto_id && produto) return produto.por_area;
  return ehUnidadeDeArea(item.unidade) && temDimensoes(item);
}

/** O que o parceiro cobra do cliente dele por este item. */
export function vendaDoItem(item: ItemDoOrcamento, produto: ItemDoCatalogo | undefined): ValorDoItem {
  const preco = arred(Number(item.preco_venda_unidade) || 0, 2);
  const unitario = vendidoPorArea(item, produto)
    ? arred((areaDaPeca(item, item.produto_id ? produto?.area_minima : null) ?? 0) * preco, 2)
    : preco;
  return { unitario, total: arred(unitario * quantidadeDaConta(item.quantidade), 2) };
}

export type ResumoDoOrcamento = {
  venda: number;
  /** o que vai para a gráfica, só dos itens com preço conhecido */
  custo: number;
  /** venda − custo nos itens da gráfica com preço conhecido; nulo sem nenhum */
  lucro: number | null;
  margemPct: number | null;
  /** algum item da gráfica ficou sem custo: o lucro não é o do orçamento inteiro */
  lucroParcial: boolean;
  itensDaGrafica: number;
  itensLivres: number;
  pendencias: { indice: number; descricao: string; motivo: string }[];
  /** m² somados de todos os itens com medida */
  area: number;
};

export function resumoDoOrcamento(
  itens: ItemDoOrcamento[],
  catalogo: Map<string, ItemDoCatalogo>,
): ResumoDoOrcamento {
  let venda = 0;
  let custo = 0;
  let vendaComCusto = 0;
  let itensDaGrafica = 0;
  let itensLivres = 0;
  let area = 0;
  let algumComCusto = false;
  const pendencias: ResumoDoOrcamento["pendencias"] = [];

  itens.forEach((item, indice) => {
    const produto = item.produto_id ? catalogo.get(item.produto_id) : undefined;
    const v = vendaDoItem(item, produto);
    venda += v.total;
    if (temDimensoes(item)) {
      area += arred(Number(item.largura) * Number(item.altura) * quantidadeDaConta(item.quantidade), 3);
    }

    const c = custoDoItem(item, produto);
    if (c.tipo === "livre") {
      itensLivres += 1;
      return;
    }
    itensDaGrafica += 1;
    if (c.tipo === "pendente") {
      pendencias.push({ indice, descricao: item.descricao, motivo: c.motivo });
      return;
    }
    algumComCusto = true;
    custo += c.total;
    vendaComCusto += v.total;
  });

  const lucro = algumComCusto ? arred(vendaComCusto - custo, 2) : null;
  return {
    venda: arred(venda, 2),
    custo: arred(custo, 2),
    lucro,
    margemPct: lucro !== null && vendaComCusto > 0 ? arred((lucro / vendaComCusto) * 100, 1) : null,
    lucroParcial: pendencias.length > 0 && algumComCusto,
    itensDaGrafica,
    itensLivres,
    pendencias,
    area: arred(area, 3),
  };
}

/** "R$ 1.234,56" */
export function brl(valor: number | null | undefined): string {
  return Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Rótulo da unidade de venda para a tela: "m²" em vez de "m2". */
export function unidadeLegivel(unidade: string | null | undefined): string {
  return ehUnidadeDeArea(unidade) ? "m²" : (unidade || "un");
}
