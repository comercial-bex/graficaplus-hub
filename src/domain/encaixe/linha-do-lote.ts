/**
 * A linha viva sob a quantidade do item do orçamento (Bex Print, 10/11/2026):
 *
 *   40 peças de 4 × 4 cm = 0,064 m²
 *   Cobrado: 4,00 m², porque o mínimo do produto é 0,10 m² por peça.
 *
 * Responde à pergunta do dono ("40 adesivos de 4 × 4 cm dão quantos m²?") no instante em que a quantidade é
 * digitada, sem abrir simulador nenhum. É pura: recebe metros e peças (o que o formulário já guarda) e devolve
 * texto. Não chama o motor de encaixe e não lê preço, custo nem estoque; vale para qualquer item com medida,
 * tenha o produto material e máquina cadastrados ou não.
 *
 * Três decisões que não são óbvias:
 *
 *  1. A área do lote é EXATA (área da peça com 6 casas vezes as peças), e não `areaTotal` nem `areaCobrada` de
 *     `orcamentos/area.ts`. Aquelas arredondam o LOTE em 3 casas, que é a precisão que o banco guarda, e em lote
 *     miúdo isso mostra número errado: 1 adesivo de 4 × 4 cm (16 cm²) viraria 0,002 m² e sairia "20 cm²"; 3
 *     adesivos (48 cm²) sairiam "50 cm²". De 0,01 m² em diante quase sempre mostram o mesmo número; a sobra é de
 *     0,001 m² nos meios exatos acima de 2 m², onde o arredondamento daquele arquivo cai um fio abaixo (811 peças de
 *     0,0025 m² são 2,0275: `areaCobrada` diz 2,027; esta conta diz 2,028, que é o que o numeric do banco faz com
 *     um meio exato).
 *  2. Quantidade vazia ou zero vale 1 peça. É a mesma convenção de `areaTotal`, `areaCobrada` e `fraseDoResumo`:
 *     a linha mostra o que o orçamento vai gravar e não some enquanto a pessoa apaga o campo para digitar outro
 *     número. Só chega a esse ponto o item que já tem as duas medidas: sem largura ou sem altura não há linha.
 *  3. A linha do mínimo só aparece quando o mínimo MUDA a conta, isto é, quando o mínimo por peça é maior que a
 *     área real da peça. Mínimo menor, igual ou ausente não diz nada.
 */

import {
  areaDaPeca,
  areaLegivel,
  areaUnitaria,
  ehUnidadeDeArea,
  temDimensoes,
  type ItemDimensionado,
} from "@/domain/orcamentos/area";
import {
  deMetros,
  ehUnidadeDeMedida,
  type UnidadeDeMedida,
} from "@/domain/orcamentos/unidade-de-medida";

/** Largura e altura em METROS, como o resto do sistema guarda. */
export type MedidaEmMetros = { largura: number; altura: number };

export type EntradaDaLinhaDoLote = {
  /** Metros. Vazio, zero ou inválido: não há linha. */
  largura?: number | null;
  altura?: number | null;
  /** Peças. Vazio ou zero valem 1 (decisão 2 no alto do arquivo). */
  quantidade?: number | null;
  /** A unidade de VENDA do item ("m2", "un", "peca"...), não a unidade em que a medida foi digitada. */
  unidade?: string | null;
  /** Mínimo cobrado por peça, em m² (`produtos.area_minima_cobrada`). */
  areaMinima?: number | null;
  /**
   * A unidade em que a pessoa digitou a medida (`useUnidadeDeMedida`). Escolhe como a medida é escrita: a mesma
   * peça sai "40 × 40 mm", "4 × 4 cm" ou "0,04 × 0,04 m". Sem ela, metros, como a tela era antes de lembrar
   * a escolha.
   */
  unidadeDeMedida?: UnidadeDeMedida;
};

export type LinhaDoLote = {
  /** "40 peças de 4 × 4 cm = 0,064 m²" */
  texto: string;
  /** "Cobrado: 4,00 m², porque o mínimo do produto é 0,10 m² por peça." Só quando o mínimo muda a conta. */
  cobrado?: string;
};

/* ------------------------------------------------------------------------------------------------------------- */
/* Área do lote                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------- */

/** Quantas peças a conta considera: vazio, zero, negativo ou inválido valem 1. */
function pecasDoLote(quantidade: number | null | undefined): number {
  return typeof quantidade === "number" && Number.isFinite(quantidade) && quantidade > 0
    ? quantidade
    : 1;
}

/**
 * Arredonda ao milímetro quadrado (6 casas). A área da peça já vem assim; o produto por um número de peças pode
 * carregar ruído de ponto flutuante (0,0105 virar 0,010499999999999999) e esse ruído, em cima de um meio exato,
 * mudaria a terceira casa que a tela mostra.
 */
const aoMilimetroQuadrado = (m2: number) => Math.round(m2 * 1_000_000) / 1_000_000;

/** Área do lote em m², exata ao mm² (ver decisão 1). Zero quando o item não tem as duas medidas. */
export function areaExataDoLote(item: ItemDimensionado): number {
  if (!temDimensoes(item)) return 0;
  return aoMilimetroQuadrado(areaUnitaria(item) * pecasDoLote(item.quantidade));
}

/** Área do lote com o mínimo por peça já aplicado, exata ao mm². Sem mínimo, é a área do lote. */
export function areaExataCobradaDoLote(item: ItemDimensionado, areaMinima?: number | null): number {
  if (!temDimensoes(item)) return 0;
  return aoMilimetroQuadrado(areaDaPeca(item, areaMinima) * pecasDoLote(item.quantidade));
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Como a medida é escrita                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * Um número da medida na unidade escolhida: sem zero sobrando, vírgula decimal, sem separador de milhar (é o texto
 * que o próprio campo mostra). A precisão é a do sistema: mm 0 casas, cm 1, m 3, ou seja, 1 mm.
 */
function numeroDaMedida(metros: number, unidade: UnidadeDeMedida): string {
  const texto = deMetros(metros, unidade);
  return texto === "" ? "0" : texto.replace(".", ",");
}

function escreverPar(largura: number, altura: number, unidade: UnidadeDeMedida): string {
  return `${numeroDaMedida(largura, unidade)} × ${numeroDaMedida(altura, unidade)} ${unidade}`;
}

/** A unidade pedida, ou metros quando o que veio não é mm, cm nem m (quem chama de fora do TypeScript). */
const unidadeValida = (unidade: unknown): UnidadeDeMedida =>
  ehUnidadeDeMedida(unidade) ? unidade : "m";

/**
 * A medida da peça na unidade em que foi digitada: "4 × 4 cm", "1,5 × 1,5 m", "40 × 60 mm".
 *
 * Aceita a medida como objeto (`{ largura, altura }`; serve uma `PecaDoEncaixe` inteira, que já traz as duas)
 * ou como dois números soltos, conforme o que quem chama tem na mão.
 */
export function medidaEscrita(medida: MedidaEmMetros, unidade: UnidadeDeMedida): string;
export function medidaEscrita(largura: number, altura: number, unidade: UnidadeDeMedida): string;
export function medidaEscrita(
  primeiro: MedidaEmMetros | number,
  segundo: UnidadeDeMedida | number,
  terceiro?: UnidadeDeMedida,
): string {
  if (typeof primeiro === "number") {
    return escreverPar(
      primeiro,
      typeof segundo === "number" ? segundo : 0,
      unidadeValida(terceiro),
    );
  }
  return escreverPar(primeiro.largura, primeiro.altura, unidadeValida(segundo));
}

/**
 * true quando o número é um múltiplo exato do passo. Tolera o ruído do ponto flutuante (0,07 ÷ 0,01 dá
 * 7,000000000000001), que é menor que 1 milionésimo do passo.
 */
function ehMultiploDe(valor: number, passo: number): boolean {
  const vezes = valor / passo;
  return Math.abs(vezes - Math.round(vezes)) < 1e-6;
}

/**
 * Formatadores criados uma vez. Montar um `Intl.NumberFormat` a cada chamada é o que custa, e estes textos são
 * refeitos a cada tecla digitada.
 */
const DUAS_CASAS = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DE_DUAS_A_TRES_CASAS = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});
const CONTAGEM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/**
 * A medida de uma peça escrita sem perder precisão, para os textos que não sabem em que unidade a pessoa digitou
 * (o resumo antes de adicionar e a linha da ordem de serviço no quadro).
 *
 *  - Medida em centímetros inteiros fica em metros com 2 casas, como sempre foi: "3,00 × 2,00 m".
 *  - Peça pequena (menos de 1 m) com milímetro nela sai em centímetros: "4,5 × 4,5 cm". Em metros com 2 casas, o
 *    adesivo de 4,5 cm aparecia como "0,05 × 0,05 m" (a tela dizia 5 cm para um adesivo de 4,5 cm).
 *  - Peça grande com milímetro nela fica em metros com 3 casas: "1,125 × 0,50 m".
 */
export function medidaNaUnidadeCerta(largura: number, altura: number): string {
  if (ehMultiploDe(largura, 0.01) && ehMultiploDe(altura, 0.01)) {
    return `${DUAS_CASAS.format(largura)} × ${DUAS_CASAS.format(altura)} m`;
  }
  if (Math.max(largura, altura) < 1) return escreverPar(largura, altura, "cm");
  return `${DE_DUAS_A_TRES_CASAS.format(largura)} × ${DE_DUAS_A_TRES_CASAS.format(altura)} m`;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* A linha                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

/** Unidades de venda que contam peças além da área (a de área é tratada por `ehUnidadeDeArea`). */
const UNIDADES_DE_CONTAGEM = new Set(["un", "unidade", "unidades", "peca", "pecas"]);

/**
 * A linha só faz sentido para unidade que conta peça ou área: m², un, peça. Milheiro, hora, quilômetro, quilo,
 * metro linear e lote não têm "40 peças de 4 × 4 cm". Item sem unidade é contado em unidades, como
 * `camposDaUnidade` já faz. Unidade desconhecida não ganha linha: escrever "peças" para o que pode ser par ou
 * caixa seria dizer o que ninguém confirmou.
 */
function contaPecas(unidade: string | null | undefined): boolean {
  if (ehUnidadeDeArea(unidade)) return true;
  const chave = (unidade ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return chave === "" || UNIDADES_DE_CONTAGEM.has(chave);
}

/** Diferença abaixo disto é ruído de ponto flutuante: a área da peça tem 6 casas, o menor passo real é 0,000001. */
const FOLGA_DA_AREA = 1e-9;

/**
 * A linha sob a quantidade, ou null quando não há o que dizer (sem as duas medidas, ou unidade de venda que não
 * conta peça nem área).
 */
export function linhaDoLote(entrada: EntradaDaLinhaDoLote): LinhaDoLote | null {
  const largura = entrada.largura ?? 0;
  const altura = entrada.altura ?? 0;
  const item: ItemDimensionado = { largura, altura, quantidade: entrada.quantidade };
  if (!temDimensoes(item) || !contaPecas(entrada.unidade)) return null;

  const pecas = pecasDoLote(entrada.quantidade);
  const medida = medidaEscrita({ largura, altura }, unidadeValida(entrada.unidadeDeMedida));
  const quantas = CONTAGEM.format(pecas);
  const texto = `${quantas} ${pecas === 1 ? "peça" : "peças"} de ${medida} = ${areaLegivel(areaExataDoLote(item))}`;

  const minimo = entrada.areaMinima;
  if (
    typeof minimo === "number" &&
    Number.isFinite(minimo) &&
    minimo > areaUnitaria(item) + FOLGA_DA_AREA
  ) {
    const cobrada = areaLegivel(areaExataCobradaDoLote(item, minimo));
    return {
      texto,
      cobrado: `Cobrado: ${cobrada}, porque o mínimo do produto é ${areaLegivel(minimo)} por peça.`,
    };
  }
  return { texto };
}
