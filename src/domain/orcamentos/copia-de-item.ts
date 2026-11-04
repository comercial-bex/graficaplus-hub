import { areaDaPeca, ehUnidadeDeArea, temDimensoes } from "@/domain/orcamentos/area";

/**
 * Copiar item do orçamento (Duplicar item e Repetir último pedido), 04/11/2026.
 *
 * A revisão adversarial do PR 425 achou que a cópia descartava o `preco_m2`, que nenhuma view
 * mostra (é coluna sem SELECT): a cópia de um item vendido por m² nascia como item "por peça".
 * Para quem não vê custo, o gatilho do banco só multiplica o custo do produto pela área quando
 * `preco_m2` existe, então a cópia custava o custo por m² como se fosse por peça (margem maior que
 * a real e alçada de desconto frouxa). E o "Refazer preço" tratava o preço do m² como preço da peça
 * (a cópia de R$ 90 por peça caía para R$ 45). A cobrança por área que o item gerou voltava com o
 * preço de tabela do catálogo, por cima do preço especial do cliente.
 *
 * A saída: reconstruir o preço por m² a partir do que a view mostra, o TOTAL da linha. Total e não
 * valor unitário, porque a coluna do unitário guarda centavos e em peça miúda ele já perdeu
 * precisão (R$ 0,075 vira R$ 0,08); o total é arredondado uma vez só, e o preço por m² que sai dele
 * devolve o mesmo total ao passar pelo gatilho `tg_item_precificar_por_area`.
 */

type Numeravel = number | string | null | undefined;

export type LinhaParaCopiar = {
  id?: string;
  descricao?: string | null;
  quantidade?: Numeravel;
  unidade?: string | null;
  largura?: Numeravel;
  altura?: Numeravel;
  acabamento?: string | null;
  tipo_produto?: string | null;
  especificacao?: string | null;
  respostas?: unknown;
  valor_unitario?: Numeravel;
  valor_total?: Numeravel;
  custo_unitario?: Numeravel;
  area_minima?: Numeravel;
  produto_id?: string | null;
  arquivo_id?: string | null;
};

const numero = (v: Numeravel): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * O preço por m² que a cópia grava, ou nulo quando o item não é vendido por área, quando quem copia
 * não vê preço (a cópia nasce com valor zero e o preço entra depois) ou quando a linha não tem valor.
 *
 * A conta espelha o gatilho: área exata da peça (6 casas, com o mínimo cobrado) vezes as peças, com
 * quantidade abaixo de 1 contando como 1 (`GREATEST(quantidade, 1)` no banco).
 */
export function precoM2DaCopia(linha: LinhaParaCopiar, podeVerPrecos: boolean): number | null {
  if (!podeVerPrecos) return null;
  const peca = { largura: numero(linha.largura), altura: numero(linha.altura), quantidade: numero(linha.quantidade) };
  if (!temDimensoes(peca) || !ehUnidadeDeArea(linha.unidade)) return null;
  const areaMinima = linha.area_minima != null && linha.area_minima !== "" ? numero(linha.area_minima) : null;
  const areaDaLinha = areaDaPeca(peca, areaMinima) * Math.max(peca.quantidade, 1);
  const total = numero(linha.valor_total);
  if (!(areaDaLinha > 0) || !(total > 0)) return null;
  return centavos(total / areaDaLinha);
}

/** Os campos de preço e medida que acompanham o preço por m² na cópia. */
function camposDaArea(linha: LinhaParaCopiar, podeVerPrecos: boolean): Record<string, unknown> {
  const precoM2 = precoM2DaCopia(linha, podeVerPrecos);
  if (precoM2 === null) return {};
  // O mínimo cobrado do original vai junto: se o cadastro mudou desde então, a cópia não muda de preço sozinha.
  const minimo = linha.area_minima != null && linha.area_minima !== "" ? { area_minima: numero(linha.area_minima) } : {};
  return { preco_m2: precoM2, ...minimo };
}

/**
 * O resultado de ler o material por fórmula dos itens que vão ser copiados. A leitura que volta sem
 * a linha de algum item (apagado por outra pessoa, ou o cache de 5 minutos do último pedido
 * apontando para item que mudou) NÃO vira lista vazia: a cópia custaria menos que o original e
 * ninguém seria avisado, a mesma classe de "falha que se lê como vazio".
 */
export function formulasParaCopiar(
  linhas: readonly { id: string; materiais_por_formula?: unknown }[] | null | undefined,
  ids: readonly string[],
): { ok: true; porItem: ReadonlyMap<string, unknown> } | { ok: false; faltam: string[] } {
  const porItem = new Map<string, unknown>();
  for (const l of linhas ?? []) porItem.set(l.id, l.materiais_por_formula ?? []);
  const faltam = ids.filter((id) => !porItem.has(id));
  return faltam.length > 0 ? { ok: false, faltam } : { ok: true, porItem };
}

export const AVISO_FORMULAS_FALTANDO =
  "Não consegui ler todos os itens para copiar (algum foi mudado ou apagado). Recarregue o orçamento e tente de novo.";

/** O item copiado: mesma descrição, medida, respostas e preço; o custo vai junto só para quem o vê. */
export function copiaDoItem(
  item: LinhaParaCopiar,
  o: {
    orcamentoId: string;
    ordem: number;
    podeVerPrecos: boolean;
    materiaisPorFormula: unknown;
    /** Duplicar leva a arte principal; Repetir último pedido não. */
    arquivoId?: string | null;
  },
): Record<string, unknown> {
  const copia: Record<string, unknown> = {
    orcamento_id: o.orcamentoId,
    descricao: item.descricao,
    quantidade: item.quantidade,
    unidade: item.unidade,
    largura: item.largura,
    altura: item.altura,
    acabamento: item.acabamento,
    tipo_produto: item.tipo_produto ?? null,
    especificacao: item.especificacao ?? null,
    respostas: item.respostas ?? [],
    valor_unitario: o.podeVerPrecos ? item.valor_unitario : 0,
    ordem: o.ordem,
    produto_id: item.produto_id,
    materiais_por_formula: o.materiaisPorFormula,
    ...camposDaArea(item, o.podeVerPrecos),
  };
  if (o.arquivoId !== undefined) copia.arquivo_id = o.arquivoId;
  // Custo só existe na view financeira; sem ele, o banco usa o custo do produto (e, com o preço por m², a área).
  if (item.custo_unitario != null) copia.custo_unitario = item.custo_unitario;
  return copia;
}

/** A cobrança que a peça gerou (acabamento, instalação), copiada junto e presa à cópia. */
export function copiaDaCobranca(
  linha: LinhaParaCopiar,
  o: { orcamentoId: string; ordem: number; paiId: string; podeVerPrecos: boolean; materiaisPorFormula: unknown },
): Record<string, unknown> {
  return {
    orcamento_id: o.orcamentoId,
    produto_id: linha.produto_id,
    descricao: linha.descricao,
    unidade: linha.unidade,
    quantidade: linha.quantidade,
    largura: linha.largura,
    altura: linha.altura,
    valor_unitario: o.podeVerPrecos ? linha.valor_unitario : 0,
    ordem: o.ordem,
    gerado_por_item_id: o.paiId,
    materiais_por_formula: o.materiaisPorFormula,
    ...camposDaArea(linha, o.podeVerPrecos),
  };
}
