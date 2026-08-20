/**
 * Cálculo de área para itens vendidos por metro quadrado — a forma dominante de
 * venda em comunicação visual (adesivo, lona, vinil, ACM).
 *
 * Convenções, tiradas do modelo de orçamento que a operação usa hoje:
 *   - largura e altura em METROS;
 *   - área unitária = largura × altura (a peça);
 *   - área total    = área unitária × quantidade (o que entra na soma do orçamento);
 *   - valor unitário = área unitária × preço/m² (o preço de UMA peça, não do lote).
 *
 * Área é arredondada em 3 casas (o padrão do documento: "22,050m²") e valores em
 * 2. O arredondamento acontece uma vez, no fim de cada função, para o número
 * gravado ser exatamente o número exibido — sem divergência entre tela, PDF e
 * produção.
 */

export type ItemDimensionado = {
  /** metros */
  largura?: number | null;
  /** metros */
  altura?: number | null;
  quantidade?: number | null;
};

const round = (valor: number, casas: number) => {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
};

const numero = (valor: number | null | undefined) =>
  Number.isFinite(valor as number) ? (valor as number) : 0;

/** true quando o item é vendido por área (tem as duas dimensões preenchidas). */
export function temDimensoes(item: ItemDimensionado): boolean {
  return numero(item.largura) > 0 && numero(item.altura) > 0;
}

/**
 * Reconhece unidade de área na forma como ela realmente aparece no cadastro.
 * A unidade canônica do catálogo é "m2" (src/lib/produtos-catalogo.ts), mas
 * "m²" é digitado à mão com frequência — comparar só com uma das duas faria o
 * preço por m² deixar de ser sugerido justamente nos produtos vendidos por área.
 */
export function ehUnidadeDeArea(unidade?: string | null): boolean {
  if (!unidade) return false;
  const normalizada = unidade.trim().toLowerCase().replace("²", "2");
  return normalizada === "m2" || normalizada === "metro2" || normalizada === "metroquadrado";
}

/** Área de uma peça, em m². 0 quando o item não é dimensionado. */
export function areaUnitaria(item: ItemDimensionado): number {
  if (!temDimensoes(item)) return 0;
  return round(numero(item.largura) * numero(item.altura), 3);
}

/** Área do item inteiro (peça × quantidade), em m². */
export function areaTotal(item: ItemDimensionado): number {
  if (!temDimensoes(item)) return 0;
  const qtd = numero(item.quantidade) > 0 ? numero(item.quantidade) : 1;
  return round(numero(item.largura) * numero(item.altura) * qtd, 3);
}

/**
 * Preço de UMA peça a partir do preço por m².
 * O valor total do item continua sendo valorUnitario × quantidade, como em
 * qualquer outro item, então a mesma regra de total serve para os dois casos.
 */
export function valorUnitarioPorM2(item: ItemDimensionado, precoM2: number): number {
  if (!temDimensoes(item)) return 0;
  return round(areaUnitaria(item) * numero(precoM2), 2);
}

/** Preço por m² embutido num valor unitário já definido — para conferência. */
export function precoM2Implicito(item: ItemDimensionado, valorUnitario: number): number | null {
  const area = areaUnitaria(item);
  if (area <= 0) return null;
  return round(numero(valorUnitario) / area, 2);
}

/**
 * Área que entra na conta, já com o mínimo por peça aplicado.
 *
 * Peça pequena não paga o setup da máquina nem o refile: um adesivo de
 * 0,20 × 0,30 sai por 0,06 m². Cobrar uma área mínima é prática padrão do setor.
 * O mínimo vale POR PEÇA e depois multiplica pela quantidade — dez adesivos
 * pequenos consomem dez setups, não um.
 *
 * Sem mínimo definido, devolve a área real: nada muda até alguém decidir o valor.
 */
export function areaCobrada(item: ItemDimensionado, areaMinima?: number | null): number {
  if (!temDimensoes(item)) return 0;
  const qtd = numero(item.quantidade) > 0 ? numero(item.quantidade) : 1;
  const daPeca = Math.max(areaUnitaria(item), numero(areaMinima));
  return round(daPeca * qtd, 3);
}

/** Valor de UMA peça pelo preço por m², respeitando o mínimo cobrado. */
export function valorUnitarioComMinimo(
  item: ItemDimensionado,
  precoM2: number,
  areaMinima?: number | null,
): number {
  if (!temDimensoes(item)) return 0;
  const daPeca = Math.max(areaUnitaria(item), numero(areaMinima));
  return round(daPeca * numero(precoM2), 2);
}

/** Soma da área de todos os itens dimensionados, em m². */
export function somaAreaTotal(itens: ItemDimensionado[]): number {
  return round(
    itens.reduce((acumulado, item) => acumulado + areaTotal(item), 0),
    3,
  );
}

/** "3,000m × 2,450m = 22,050m²" — a metragem como aparece no documento. */
export function descreverMetragem(item: ItemDimensionado): string | null {
  if (!temDimensoes(item)) return null;
  const metros = (valor: number) => valor.toFixed(3).replace(".", ",");
  const m2 = (valor: number) => valor.toFixed(3).replace(".", ",");
  return `${metros(numero(item.largura))}m × ${metros(numero(item.altura))}m = ${m2(areaTotal(item))}m²`;
}
