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
 * A área do LOTE é arredondada em 3 casas (o padrão do documento: "22,050m²") e
 * valores em 2. A área da PEÇA fica com 6 casas (o mm²): até 29/10/2026 ela
 * também era arredondada em 3 casas, e 0,001 m² é um quadrado de 10 × 10 cm —
 * um adesivo de 5 × 5 cm (0,0025 m²) virava 0,003 e pagava 20% a mais; abaixo
 * de 2,2 × 2,2 cm a área virava zero e o preço também (auditoria orçamento a
 * orçamento, 29/10/2026: 120 adesivos de 5 × 5 a R$ 30/m² saíam por R$ 10,80 em
 * vez de R$ 9,00). O dinheiro da linha sai da área exata; o unitário, que a
 * coluna guarda em centavos, é o total da linha dividido pelas peças — a mesma
 * regra dos gatilhos do banco (`tg_item_precificar_por_area`).
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

/** Área de uma peça, em m², exata ao mm² (6 casas). 0 quando o item não é dimensionado. */
export function areaUnitaria(item: ItemDimensionado): number {
  if (!temDimensoes(item)) return 0;
  return round(numero(item.largura) * numero(item.altura), 6);
}

/**
 * A área como a pessoa lê: peça pequena em cm² ("25 cm²"), o resto em m² com
 * duas casas ("0,25 m²"). Com duas casas, o adesivo de 5 × 5 cm aparecia como
 * "0,00 m²" na tela de medidas — e ninguém desconfiava da conta.
 */
export function areaLegivel(m2: number): string {
  const v = Number.isFinite(m2) ? m2 : 0;
  if (v > 0 && v < 0.01) return `${Math.round(v * 10_000).toLocaleString("pt-BR")} cm²`;
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
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

/**
 * Preço por m² embutido num valor unitário já definido — para conferência e
 * para voltar um item gravado ao formulário.
 *
 * Divide pela área COBRADA da peça, com o mínimo (20/10/2026). Dividia pela
 * área real: um adesivo de 0,045 m² com mínimo de 0,25 m² a R$ 250/m² (R$ 62,50)
 * voltava como R$ 1.388,89/m², e o banco, ao salvar, cobrava 0,25 × 1.388,89 =
 * R$ 347,22 — editar o item multiplicava o preço por 5,5.
 */
export function precoM2Implicito(
  item: ItemDimensionado,
  valorUnitario: number,
  areaMinima?: number | null,
): number | null {
  const area = areaDaPeca(item, areaMinima);
  if (area <= 0) return null;
  return round(numero(valorUnitario) / area, 2);
}

/** Área de UMA peça que entra na conta: a real, ou o mínimo cobrado se for maior. */
export function areaDaPeca(item: ItemDimensionado, areaMinima?: number | null): number {
  if (!temDimensoes(item)) return 0;
  return Math.max(areaUnitaria(item), numero(areaMinima));
}

/**
 * Custo de UMA peça vendida por área (20/10/2026): custo/m² × a mesma área que
 * o preço cobra. O formulário copiava o custo do produto (por m²) direto no
 * custo da peça: uma placa de 0,30 × 0,15 a R$ 11,25 aparecia com custo de
 * R$ 78,00 e margem de −593%, e o custo do orçamento subia junto.
 */
export function custoDaPecaPorArea(
  item: ItemDimensionado,
  custoM2: number,
  areaMinima?: number | null,
): number {
  return round(areaDaPeca(item, areaMinima) * numero(custoM2), 2);
}

/**
 * Custo por m² embutido no custo de uma peça — para voltar ao formulário um
 * item gravado ou o resultado da calculadora. Quatro casas: a volta (× área,
 * duas casas) tem de dar o mesmo custo da peça.
 */
export function custoM2Implicito(
  item: ItemDimensionado,
  custoDaPeca: number,
  areaMinima?: number | null,
): number | null {
  const area = areaDaPeca(item, areaMinima);
  if (area <= 0) return null;
  return round(numero(custoDaPeca) / area, 4);
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

/**
 * O total da LINHA pelo preço por m²: área exata da peça (com o mínimo) × peças
 * × preço, arredondado uma vez, em centavos. É o número que o banco grava em
 * `valor_total` (`tg_item_precificar_por_area`) e o que o cliente paga.
 */
export function valorDaLinhaPorM2(
  item: ItemDimensionado,
  precoM2: number,
  areaMinima?: number | null,
): number {
  if (!temDimensoes(item)) return 0;
  const qtd = numero(item.quantidade) > 0 ? numero(item.quantidade) : 1;
  return round(areaDaPeca(item, areaMinima) * qtd * numero(precoM2), 2);
}

/**
 * Valor de UMA peça pelo preço por m², respeitando o mínimo cobrado: o total da
 * linha dividido pelas peças, em centavos — como a coluna `valor_unitario`
 * (numeric 12,2) consegue guardar. Em peça miúda ele não reproduz o total
 * (R$ 0,075 vira R$ 0,08): o total manda, e o PDF escreve o unitário com as
 * casas que faltam (`dinheiroDaUnidade`).
 */
export function valorUnitarioComMinimo(
  item: ItemDimensionado,
  precoM2: number,
  areaMinima?: number | null,
): number {
  if (!temDimensoes(item)) return 0;
  const qtd = numero(item.quantidade) > 0 ? numero(item.quantidade) : 1;
  return round(valorDaLinhaPorM2(item, precoM2, areaMinima) / qtd, 2);
}

/**
 * Quantas unidades de venda o item consome — a base que multiplica a ficha
 * técnica do produto.
 *
 * `produto_materiais.quantidade_por_unidade` é consumo por unidade DE VENDA, e a
 * unidade de venda de um produto medido em área é o m², não a peça. Um banner
 * 3 × 2 m em duas vias consome 12 m² de lona, não 2: usar a quantidade de peças
 * aqui erraria o custo do material por um fator igual à área da peça.
 *
 * Quando o item não é vendido por área, a base é a própria quantidade.
 */
export function baseDeConsumo(item: ItemDimensionado, areaMinima?: number | null): number {
  const qtd = numero(item.quantidade) > 0 ? numero(item.quantidade) : 1;
  if (!temDimensoes(item)) return qtd;
  return areaCobrada(item, areaMinima);
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
