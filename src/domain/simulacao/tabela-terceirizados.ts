/**
 * A tabela de preços para TERCEIRIZADOS que a Bex manda por WhatsApp aos
 * parceiros (texto de 25/10/2026), em forma de dado — para simular o balcão
 * contra ela e para, quando o dono decidir, virar cadastro.
 *
 * Preços por m². "Acima de 6 m²" é a única regra de volume da tabela. O texto
 * não diz se os 6 m² são por LINHA do pedido, por PRODUTO no pedido ou pelo
 * pedido todo; a simulação usa por linha (o mais barato para a casa) e mostra a
 * diferença quando o pedido muda de resultado — é uma pergunta ao dono.
 */

export type FamiliaDeProduto = "adesivo" | "lona" | "banner";

export type MaterialDaCasa =
  | "vinil_branco"
  | "vinil_perfurado"
  | "vinil_transparente"
  | "vinil_fosco"
  | "vinil_blackout"
  | "lona_280"
  | "lona_440"
  | "lona_fosca"
  | "lona_backlight";

export type ProdutoDaTabela = {
  chave: string;
  /** como está escrito na tabela */
  nome: string;
  familia: FamiliaDeProduto;
  precoM2: number;
  /** preço do m² quando a área da linha passa de LIMIAR_DO_DESCONTO_M2 */
  precoM2Acima?: number;
  /** "a partir de": o preço de verdade depende do que a tabela não diz */
  aPartirDe?: boolean;
  /** adesivo impresso + recorte: passa pela plotter de recorte e pela decapagem */
  recorte?: boolean;
  material: MaterialDaCasa;
  /** o produto que corresponde a este no catálogo do banco, ou nulo se não existe */
  noCatalogo: string | null;
  /**
   * Área mínima cobrada por peça. A tabela do WhatsApp não tem mínimo; este número
   * vem do CADASTRO do sistema (Banner com bastão e corda: 1 m²) e entra para a
   * simulação mostrar o que o sistema faria com um banner pequeno.
   */
  areaMinimaM2?: number;
};

export const LIMIAR_DO_DESCONTO_M2 = 6;

export const TABELA_DE_TERCEIRIZADOS: readonly ProdutoDaTabela[] = [
  {
    chave: "adesivo_promo",
    nome: "Adesivo PROMO",
    familia: "adesivo",
    precoM2: 23.9,
    material: "vinil_branco",
    noCatalogo: null,
  },
  {
    chave: "adesivo_top",
    nome: "Adesivo TOP",
    familia: "adesivo",
    precoM2: 29.9,
    precoM2Acima: 27.9,
    material: "vinil_branco",
    noCatalogo: "Adesivo vinil branco impresso",
  },
  {
    chave: "adesivo_recorte",
    nome: "Adesivo impresso + recorte",
    familia: "adesivo",
    precoM2: 44.9,
    precoM2Acima: 41.9,
    recorte: true,
    material: "vinil_branco",
    noCatalogo: "Adesivo vinil recortado",
  },
  {
    chave: "perfurado_top",
    nome: "Adesivo perfurado TOP",
    familia: "adesivo",
    precoM2: 54.9,
    precoM2Acima: 52.9,
    material: "vinil_perfurado",
    noCatalogo: "Adesivo perfurado (one way)",
  },
  {
    chave: "perfurado_promo",
    nome: "Perfurado PROMOCIONAL",
    familia: "adesivo",
    precoM2: 34.9,
    material: "vinil_perfurado",
    noCatalogo: null,
  },
  {
    chave: "adesivo_transparente",
    nome: "Adesivo transparente",
    familia: "adesivo",
    precoM2: 34.9,
    material: "vinil_transparente",
    noCatalogo: null,
  },
  {
    chave: "adesivo_fosco",
    nome: "Adesivo fosco",
    familia: "adesivo",
    precoM2: 34.9,
    material: "vinil_fosco",
    noCatalogo: null,
  },
  {
    chave: "adesivo_blackout",
    nome: "Adesivo blackout",
    familia: "adesivo",
    precoM2: 34.9,
    material: "vinil_blackout",
    noCatalogo: null,
  },
  {
    chave: "banner",
    nome: "Banner",
    familia: "banner",
    precoM2: 37.9,
    aPartirDe: true,
    material: "lona_280",
    noCatalogo: "Banner com bastão e corda",
    areaMinimaM2: 1,
  },
  {
    chave: "lona_promo",
    nome: "Lona PROMO",
    familia: "lona",
    precoM2: 26.9,
    material: "lona_280",
    noCatalogo: "Lona 280g impressa",
  },
  {
    chave: "lona_top",
    nome: "Lona TOP para fachada",
    familia: "lona",
    precoM2: 34.9,
    precoM2Acima: 29.9,
    material: "lona_440",
    noCatalogo: "Lona 440g reforçada impressa",
  },
  {
    chave: "lona_fosca",
    nome: "Lona fosca",
    familia: "lona",
    precoM2: 34.9,
    material: "lona_fosca",
    noCatalogo: null,
  },
  {
    chave: "lona_backlight",
    nome: "Lona Backlight",
    familia: "lona",
    precoM2: 54.9,
    material: "lona_backlight",
    noCatalogo: null,
  },
];

export function produtoDaTabela(chave: string): ProdutoDaTabela {
  const p = TABELA_DE_TERCEIRIZADOS.find((x) => x.chave === chave);
  if (!p) throw new Error(`Produto fora da tabela de terceirizados: ${chave}`);
  return p;
}

/** O preço do m² para uma área: "acima de 6 m²" é estritamente maior que 6. */
export function precoDoM2(p: ProdutoDaTabela, areaM2: number): number {
  return p.precoM2Acima !== undefined && areaM2 > LIMIAR_DO_DESCONTO_M2
    ? p.precoM2Acima
    : p.precoM2;
}

/**
 * O que o PARCEIRO paga hoje no sistema por produto equivalente (nível Bronze,
 * conferido no banco em 25/10/2026 com `parceiro_precos`). Serve para a
 * simulação apontar onde a tabela do WhatsApp e a do sistema discordam. O sistema
 * não tem a regra "acima de 6 m²".
 */
export const PRECO_DO_PARCEIRO_NO_SISTEMA: Record<string, number> = {
  // Desde a migração 20261025200000 o sistema cobra o preço da tabela (e a faixa acima de 6 m²).
  "Adesivo vinil branco impresso": 29.9,
  "Adesivo vinil recortado": 44.9,
  "Adesivo perfurado (one way)": 54.9,
  "Banner com bastão e corda": 37.9,
  "Lona 280g impressa": 26.9,
  "Lona 440g reforçada impressa": 34.9,
};
