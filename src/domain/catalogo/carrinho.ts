import { ehCategoria, type Categoria } from "@/domain/catalogo/categorias-da-loja";
import type { FotoDoItem } from "@/domain/catalogo/fotos";
import type { ItemDaLoja, OpcaoDaLoja, RefDoItemDaLoja } from "@/domain/catalogo/loja";
import {
  ehModalidade,
  ehUnidadeDePreco,
  type Modalidade,
  type UnidadeDePreco,
} from "@/domain/catalogo/modalidades";
import { arredondar, precoDaPeca } from "@/domain/catalogo/preco-de-venda";
import {
  conferirQuantidade,
  quantidadeInicial,
  type RegraDeQuantidade,
} from "@/domain/catalogo/quantidade";

/**
 * O carrinho da loja: o que a pessoa separou para orçar, com quantidade e
 * opção de gravação por item.
 *
 * Mora no APARELHO (localStorage) — o iPad da loja, o celular do cliente — e
 * não no banco: é rascunho de pedido, não pedido. Vira coisa de verdade de dois
 * jeitos: a equipe gera UM orçamento com tudo (`catalogo_gerar_orcamento`), ou
 * o cliente pede cotação pelo link (`catalogo_link_pedir_cotacao`) e abre o
 * WhatsApp com a lista pronta.
 *
 * A conta é a mesma da tela de orçamento: o preço do cento vira preço da peça
 * (`precoDaPeca`) e o total da linha é peça × quantidade. Linha sem preço entra
 * no carrinho como "sob consulta" e NÃO entra no subtotal — o subtotal diz
 * quantas ficaram de fora, em vez de somar zero e mentir.
 *
 * Domínio puro.
 */

export type LinhaDoCarrinho = {
  /** `${codigo}|${modalidade}`: o mesmo item com gravação diferente é outra linha. */
  chave: string;
  codigo: string;
  nome: string;
  categoria: Categoria;
  modalidade: Modalidade;
  rotulo: string;
  quantidade: number;
  /** Na unidade do preço do item. `null` = sob consulta. */
  preco: number | null;
  unidade_preco: UnidadeDePreco;
  foto: FotoDoItem | null;
  regra: RegraDeQuantidade;
  ref: RefDoItemDaLoja | null;
};

export type Carrinho = LinhaDoCarrinho[];

export const LIMITE_DE_LINHAS_DO_CARRINHO = 50;

export function chaveDaLinha(codigo: string, modalidade: Modalidade): string {
  return `${codigo}|${modalidade}`;
}

export function linhaDoCarrinho(
  item: ItemDaLoja,
  opcao: OpcaoDaLoja,
  quantidade: number,
): LinhaDoCarrinho {
  return {
    chave: chaveDaLinha(item.codigo, opcao.modalidade),
    codigo: item.codigo,
    nome: item.nome,
    categoria: item.categoria,
    modalidade: opcao.modalidade,
    rotulo: opcao.rotulo,
    quantidade,
    preco: opcao.preco,
    unidade_preco: item.unidade_preco,
    foto: item.foto,
    regra: {
      quantidadeMinima: opcao.quantidade_minima,
      multiplo: opcao.multiplo,
      faixa: opcao.faixa,
      faixaMax: opcao.faixa_max,
    },
    ref: item.ref,
  };
}

/** A mesma linha de novo soma a quantidade (como no e-commerce); linha nova entra no fim. */
export function adicionarAoCarrinho(carrinho: Carrinho, linha: LinhaDoCarrinho): Carrinho {
  const existente = carrinho.find((l) => l.chave === linha.chave);
  if (existente) {
    return carrinho.map((l) =>
      l.chave === linha.chave ? { ...linha, quantidade: l.quantidade + linha.quantidade } : l,
    );
  }
  if (carrinho.length >= LIMITE_DE_LINHAS_DO_CARRINHO) return carrinho;
  return [...carrinho, linha];
}

export function alterarQuantidade(carrinho: Carrinho, chave: string, quantidade: number): Carrinho {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return removerDoCarrinho(carrinho, chave);
  return carrinho.map((l) =>
    l.chave === chave ? { ...l, quantidade: Math.trunc(quantidade) } : l,
  );
}

export function removerDoCarrinho(carrinho: Carrinho, chave: string): Carrinho {
  return carrinho.filter((l) => l.chave !== chave);
}

/** O total da linha em reais, ou `null` quando é sob consulta. */
export function totalDaLinha(
  linha: Pick<LinhaDoCarrinho, "preco" | "unidade_preco" | "quantidade">,
): number | null {
  if (linha.preco == null) return null;
  return arredondar(precoDaPeca(linha.preco, linha.unidade_preco) * linha.quantidade, 2);
}

export type ResumoDoCarrinho = {
  linhas: number;
  pecas: number;
  comPreco: number;
  semPreco: number;
  /** Soma das linhas com preço; `null` quando nenhuma tem. */
  subtotal: number | null;
};

export function resumoDoCarrinho(carrinho: Carrinho): ResumoDoCarrinho {
  let pecas = 0;
  let comPreco = 0;
  let subtotal = 0;
  for (const l of carrinho) {
    pecas += l.quantidade;
    const t = totalDaLinha(l);
    if (t != null) {
      comPreco++;
      subtotal = arredondar(subtotal + t, 2);
    }
  }
  return {
    linhas: carrinho.length,
    pecas,
    comPreco,
    semPreco: carrinho.length - comPreco,
    subtotal: comPreco > 0 ? subtotal : null,
  };
}

/** Confere cada linha com a regra de quantidade do fornecedor (as mesmas frases do banco). */
export function conferirCarrinho(
  carrinho: Carrinho,
): { chave: string; mensagem: string; sugestao: number | null }[] {
  const problemas: { chave: string; mensagem: string; sugestao: number | null }[] = [];
  for (const l of carrinho) {
    const c = conferirQuantidade(l.quantidade, l.regra, l.rotulo);
    if (!c.ok) problemas.push({ chave: l.chave, mensagem: c.mensagem, sugestao: c.sugestao });
  }
  return problemas;
}

/** Quantidade que o passo "−" ou "+" leva, respeitando mínimo e múltiplo. */
export function passoDeQuantidade(
  regra: Pick<RegraDeQuantidade, "quantidadeMinima" | "multiplo">,
): number {
  return regra.multiplo && regra.multiplo > 0 ? regra.multiplo : 1;
}

export function somarPasso(
  quantidade: number,
  regra: Pick<RegraDeQuantidade, "quantidadeMinima" | "multiplo">,
  sentido: 1 | -1,
): number {
  const passo = passoDeQuantidade(regra);
  const minimo = quantidadeInicial(regra);
  const proxima =
    sentido > 0
      ? Math.floor(quantidade / passo) * passo + passo
      : Math.ceil(quantidade / passo) * passo - passo;
  return Math.max(minimo, Math.min(1_000_000, proxima));
}

/** Onde o carrinho fica no aparelho. Um por escopo: a equipe tem o seu; cada link do cliente, o seu. */
export function chaveDeArmazenamento(escopo: string): string {
  return `bexprint:carrinho:${escopo.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "loja"}`;
}

export function serializarCarrinho(carrinho: Carrinho): string {
  return JSON.stringify({ v: 1, linhas: carrinho });
}

function numero(valor: unknown): number | null {
  if (valor == null) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/**
 * Lê o carrinho guardado. Linha que não tem a forma esperada é descartada,
 * texto ilegível vira carrinho vazio: o que estava no aparelho nunca derruba a
 * loja.
 */
export function lerCarrinho(guardado: string | null | undefined): Carrinho {
  if (!guardado) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(guardado);
  } catch {
    return [];
  }
  const linhas =
    bruto && typeof bruto === "object" && Array.isArray((bruto as { linhas?: unknown }).linhas)
      ? (bruto as { linhas: unknown[] }).linhas
      : [];
  const saida: Carrinho = [];
  for (const v of linhas) {
    if (!v || typeof v !== "object") continue;
    const l = v as Record<string, unknown>;
    const codigo = texto(l.codigo);
    const quantidade = numero(l.quantidade);
    const foto = l.foto && typeof l.foto === "object" ? (l.foto as Record<string, unknown>) : null;
    const regra =
      l.regra && typeof l.regra === "object" ? (l.regra as Record<string, unknown>) : {};
    const ref = l.ref && typeof l.ref === "object" ? (l.ref as Record<string, unknown>) : null;
    if (
      !codigo ||
      !/^BX-[0-9]{4,7}$/.test(codigo) ||
      !ehModalidade(l.modalidade) ||
      quantidade == null ||
      quantidade <= 0 ||
      !Number.isInteger(quantidade)
    ) {
      continue;
    }
    const preco = numero(l.preco);
    saida.push({
      chave: chaveDaLinha(codigo, l.modalidade),
      codigo,
      nome: texto(l.nome) ?? codigo,
      categoria: ehCategoria(l.categoria) ? l.categoria : "outros",
      modalidade: l.modalidade,
      rotulo: texto(l.rotulo) ?? "Preço",
      quantidade,
      preco: preco != null && preco > 0 ? preco : null,
      unidade_preco: ehUnidadeDePreco(l.unidade_preco) ? l.unidade_preco : "unidade",
      foto:
        foto && (foto.origem === "repositorio" || foto.origem === "storage") && texto(foto.caminho)
          ? { origem: foto.origem, caminho: String(foto.caminho) }
          : null,
      regra: {
        quantidadeMinima: numero(regra.quantidadeMinima),
        multiplo: numero(regra.multiplo),
        faixa: texto(regra.faixa),
        faixaMax: numero(regra.faixaMax),
      },
      ref:
        ref?.origem === "catalogo" && texto(ref.item_id) && texto(ref.catalogo_id)
          ? {
              origem: "catalogo",
              item_id: String(ref.item_id),
              catalogo_id: String(ref.catalogo_id),
            }
          : ref?.origem === "produto" && texto(ref.produto_id)
            ? { origem: "produto", produto_id: String(ref.produto_id) }
            : null,
    });
    if (saida.length >= LIMITE_DE_LINHAS_DO_CARRINHO) break;
  }
  return saida;
}

/** O que vai a `catalogo_gerar_orcamento`: só o que o banco precisa, por linha. */
export type ItemParaOrcar = { item_id: string; modalidade: Modalidade; quantidade: number };

/**
 * As linhas que podem virar orçamento: com preço e com `ref` de catálogo. Linha
 * sem preço fica de fora (o banco recusaria "sob consulta"), e item de
 * `produtos` ainda não entra por aqui — a costura está no tipo, não na função.
 */
export function itensParaOrcar(carrinho: Carrinho): {
  prontos: ItemParaOrcar[];
  semPreco: LinhaDoCarrinho[];
  semRef: LinhaDoCarrinho[];
} {
  const prontos: ItemParaOrcar[] = [];
  const semPreco: LinhaDoCarrinho[] = [];
  const semRef: LinhaDoCarrinho[] = [];
  for (const l of carrinho) {
    if (l.preco == null) semPreco.push(l);
    else if (l.ref?.origem !== "catalogo") semRef.push(l);
    else
      prontos.push({ item_id: l.ref.item_id, modalidade: l.modalidade, quantidade: l.quantidade });
  }
  return { prontos, semPreco, semRef };
}
