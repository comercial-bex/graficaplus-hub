/**
 * As opções de preço de um item de catálogo de fornecedor e a unidade do preço.
 *
 * A tabela da LUGA traz, para o mesmo item, até três preços lado a lado:
 * "sem gravação", "gravada em silk 1 cor", "silk 1 cor + 1ª página em 4
 * cores"... Cada coluna é uma MODALIDADE — e cada modalidade tem o próprio
 * custo, mínimo e múltiplo. Quinze rótulos diferentes da tabela viraram as dez
 * chaves abaixo (o mesmo CHECK de `fornecedor_item_modalidades.modalidade`).
 *
 * Domínio puro: não fala com banco nem com rede.
 */

export const MODALIDADES = [
  "sem_gravacao",
  "valor_unico",
  "gravada_1_cor",
  "gravada_mais_pagina",
  "gravacao_laser",
  "baixo_relevo",
  "gravada_100_199",
  "gravada_acima_1000",
  "com_gravacao",
  "transfer_giro",
] as const;

export type Modalidade = (typeof MODALIDADES)[number];

/**
 * O rótulo que a equipe e o cliente leem. É o MESMO texto de
 * `fornecedor_rotulo_modalidade()` no banco — a vitrine do cliente é montada lá
 * e a tela da equipe, aqui; `tests/catalogo-dominio.test.ts` confere os dois.
 */
export const ROTULO_DA_MODALIDADE: Record<Modalidade, string> = {
  sem_gravacao: "Sem gravação",
  valor_unico: "Preço",
  gravada_1_cor: "Gravada em silk 1 cor",
  gravada_mais_pagina: "Silk 1 cor + 1ª página em 4 cores",
  gravacao_laser: "Gravação a laser",
  baixo_relevo: "Baixo relevo",
  gravada_100_199: "Com gravação",
  gravada_acima_1000: "Com gravação",
  com_gravacao: "Com gravação",
  transfer_giro: "Personalizada (transfer, 4 cores)",
};

/** O preço do item "puro": o mínimo e o múltiplo dele são os do item. */
export const MODALIDADES_BASE: ReadonlySet<Modalidade> = new Set(["sem_gravacao", "valor_unico"]);

export function ehModalidade(valor: unknown): valor is Modalidade {
  return typeof valor === "string" && (MODALIDADES as readonly string[]).includes(valor);
}

export const UNIDADES_DE_PRECO = [
  "unidade",
  "cento",
  "milheiro",
  "caixa",
  "rolo",
  "folha",
  "pacote",
] as const;

export type UnidadeDePreco = (typeof UNIDADES_DE_PRECO)[number];

export function ehUnidadeDePreco(valor: unknown): valor is UnidadeDePreco {
  return typeof valor === "string" && (UNIDADES_DE_PRECO as readonly string[]).includes(valor);
}

/**
 * Quantas peças o preço cobre. Igual a `fornecedor_fator_unidade()`: a folhinha
 * custa por CENTO, e o orçamento divide por 100 para chegar ao preço da peça.
 */
export function fatorDaUnidade(unidade: UnidadeDePreco): number {
  if (unidade === "cento") return 100;
  if (unidade === "milheiro") return 1000;
  return 1;
}

/** "R$ 12,50 a peça", "R$ 279,00 o cento (100 peças)". */
export const PRECO_POR: Record<UnidadeDePreco, string> = {
  unidade: "a peça",
  cento: "o cento (100 peças)",
  milheiro: "o milheiro (1.000 peças)",
  caixa: "a caixa",
  rolo: "o rolo",
  folha: "a folha",
  pacote: "o pacote",
};
