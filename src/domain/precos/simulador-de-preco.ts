/**
 * Simulador de preço da tela "Preços por produto". Funções puras, sem React, sem banco e sem gravar nada.
 *
 * Tudo em CENTAVOS INTEIROS: o controle de arrastar, as fatias e os limites. Reais só aparecem na borda, no texto.
 * Isso evita somar ponto flutuante (70,30000000000001) e garante que as fatias somem exatamente o preço.
 *
 * Para um preço P simulado, por unidade de venda:
 *   fatias de custo (não dependem de P): material, máquina, mão de obra, rateio e ocupação, perdas
 *   fatias que dependem de P: imposto = P x imposto%, cartão = P x metade da taxa do cartão (mesma conta do piso)
 *   lucro = o que sobra, por diferença, então a soma das fatias é SEMPRE o preço, nos centavos.
 *   Abaixo do custo o lucro fica negativo e a fatia vira prejuízo.
 *
 * Perdas é o RESÍDUO: custo de produção menos material, máquina, mão de obra, rateio e ocupação. Em dado fresco são a
 * perda, a falha e o consumo extra da plotter. Se a composição guardada estiver velha e o resíduo der negativo, as
 * outras fatias são escaladas para fechar no custo de produção e o aviso diz isso.
 *
 * Lucro percentual é lucro sobre o PREÇO. A margem líquida da lista divide pelo preço sem imposto e cartão, por isso
 * mostra um número um pouco maior. O texto do simulador explica a diferença.
 */
import { leituraReal, type CustoRealDoProduto } from "./custo-real";
import { fraseDoMaterialPorPeca, lerReais, type LinhaDePreco } from "./painel-de-precos";
import { leituraDoMinimo, taxaSobreAVenda, TOLERANCIA_DO_MINIMO } from "./preco-minimo";

/** Passo do controle: R$ 0,10. PageUp e PageDown andam 10 passos, R$ 1,00. */
export const PASSO_EM_CENTAVOS = 10;
export const PASSO_GRANDE_EM_CENTAVOS = 100;
/** Dentro desta folga acima do mínimo recomendado a faixa é "no mínimo". Mesma folga de faixaDoMinimo. */
const FOLGA_NO_MINIMO = TOLERANCIA_DO_MINIMO / 100;

export type ComposicaoDoCusto = {
  material: number;
  maquina: number;
  maoDeObra: number;
  indireto: number;
};

export type FaixaDoSimulador = "abaixo_do_custo" | "abaixo_do_minimo" | "no_minimo" | "acima";

export const ROTULO_DA_FAIXA_DO_SIMULADOR: Record<FaixaDoSimulador, string> = {
  abaixo_do_custo: "Abaixo do custo, cada venda dá prejuízo",
  abaixo_do_minimo: "Abaixo do mínimo recomendado",
  no_minimo: "No mínimo recomendado, com pouca folga",
  acima: "Acima do mínimo recomendado",
};

export type CodigoDaFatia =
  | "material"
  | "maquina"
  | "mao_de_obra"
  | "rateio"
  | "perdas"
  | "imposto"
  | "cartao"
  | "imposto_e_cartao"
  | "lucro"
  | "prejuizo";

export const ROTULO_DA_FATIA: Record<CodigoDaFatia, string> = {
  material: "Material",
  maquina: "Máquina",
  mao_de_obra: "Mão de obra",
  rateio: "Rateio e horas paradas pela ocupação",
  perdas: "Perdas, falha e extras da plotter",
  imposto: "Imposto",
  cartao: "Cartão, metade da taxa",
  imposto_e_cartao: "Imposto e cartão",
  lucro: "Lucro",
  prejuizo: "Prejuízo",
};

export type Fatia = {
  codigo: CodigoDaFatia;
  rotulo: string;
  /** Valor da fatia em centavos. Só a fatia de prejuízo é negativa. */
  centavos: number;
  /** Fatia sobre o preço, em por cento. Pode passar de 100 nas de custo quando há prejuízo. */
  pctDoPreco: number;
  /** Largura na barra empilhada, em por cento de 0 a 100. Prejuízo tem largura zero. */
  larguraNaBarra: number;
};

export type CodigoDoAviso =
  | "composicao_desatualizada"
  | "sem_ocupacao"
  | "sem_taxas"
  | "sem_minimo"
  | "sem_preco_de_balcao"
  | "material_por_peca";

export type AvisoDoSimulador = { codigo: CodigoDoAviso; frase: string };

export type MotivoSemDado =
  | "sem_custo_real"
  | "sem_custo_de_producao"
  | "sem_composicao"
  | "preco_invalido";

export type SemDado = { estado: "sem_dado"; motivo: MotivoSemDado; frase: string };

export type CodigoDaMarca = "minimo" | "regra_de_tres" | "hoje" | "parceiro" | "concorrente";

export type Marca = {
  codigo: CodigoDaMarca;
  rotulo: string;
  centavos: number;
  /** Posição na régua, em por cento. Fora de 0 a 100 quando a marca não cabe. */
  pos: number;
  dentro: boolean;
};

export type Limites = { minCentavos: number; maxCentavos: number; passo: number };

/** O que não muda ao arrastar. Calculado uma vez por produto. */
export type SimuladorPronto = {
  estado: "pronto";
  custoRealCentavos: number;
  /**
   * Menor preço, em centavos, em que o lucro calculado não é negativo. Com dado em ordem fica a poucos centavos do
   * custo real, que vem arredondado a 2 casas na visão. É daqui que o vermelho acaba, para a cor e a frase de lucro nunca se contradizerem.
   */
  equilibrioCentavos: number;
  custoDeProducaoCentavos: number;
  minimoCentavos: number | null;
  /** Taxa sobre a venda, de 0 a 0,99. Vem das taxas lidas ou, sem elas, da razão entre custo de produção e custo real. */
  taxa: number;
  taxasLidas: boolean;
  impostoPct: number;
  cartaoPct: number;
  /** As cinco fatias de custo, em centavos, na ordem da barra. */
  custos: Array<{ codigo: CodigoDaFatia; centavos: number }>;
  avisos: AvisoDoSimulador[];
  limites: Limites;
  marcas: Marca[];
  precoDeHojeCentavos: number | null;
};

export type Simulacao = {
  estado: "ok";
  precoCentavos: number;
  fatias: Fatia[];
  lucroCentavos: number;
  /** Lucro sobre o preço, em por cento. Negativo quando há prejuízo. */
  lucroPct: number;
  /** Preço dividido pelo custo real. */
  vezesOCusto: number;
  /** Reais de lucro a cada R$ 1 a mais no preço: 1 menos a taxa sobre a venda. */
  ganhoPorReal: number;
  faixa: FaixaDoSimulador;
  /** Posição do preço na barra, em por cento, quando há prejuízo e as fatias passam do preço. Senão 100. */
  posicaoDoPrecoNaBarra: number;
};

const centavosDe = (n: number) => Math.round(n * 100);
const numeroOk = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positivo = (n: unknown): n is number => numeroOk(n) && n > 0;

export const reaisPorExtenso = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const pctTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** 7045 vira "70,45", o mesmo formato do campo de preço da linha. */
export function centavosParaTexto(c: number): string {
  const inteiro = Math.max(0, Math.round(numeroOk(c) ? c : 0));
  return (inteiro / 100).toFixed(2).replace(".", ",");
}

/** "70,45" vira 7045. Texto vazio ou sem sentido vira nulo, nunca NaN. */
export function textoParaCentavos(t: string): number | null {
  const n = lerReais(t);
  return n == null ? null : Math.round(n * 100);
}

const abaixoDe10 = (c: number) => Math.floor(c / PASSO_EM_CENTAVOS) * PASSO_EM_CENTAVOS;
const acimaDe10 = (c: number) => Math.ceil(c / PASSO_EM_CENTAVOS) * PASSO_EM_CENTAVOS;

/** Prende o valor na régua e no passo, para o controle nunca receber número fora dela. */
export function prenderNaReguas(centavos: number, l: Limites): number {
  const v = numeroOk(centavos) ? centavos : l.minCentavos;
  const preso = Math.min(l.maxCentavos, Math.max(l.minCentavos, v));
  const passos = Math.round((preso - l.minCentavos) / l.passo);
  return Math.min(l.maxCentavos, l.minCentavos + passos * l.passo);
}

/**
 * Limites do controle: do custo real, arredondado para BAIXO ao múltiplo de R$ 0,10, até o dobro do preço de balcão,
 * arredondado para CIMA. Sem balcão, o dobro do maior entre o mínimo recomendado e a regra de três. A régua tem
 * sempre pelo menos R$ 1,00 de largura.
 */
export function limitesDaReguas(linha: LinhaDePreco): Limites | null {
  const custoReal = linha.real?.custo_real;
  if (!positivo(custoReal)) return null;
  const minimo = leituraDoMinimo(linha, linha.preco).minimo;
  const regra = leituraReal(linha, linha.preco).regra;
  const minCentavos = abaixoDe10(centavosDe(custoReal));
  const base = positivo(linha.preco)
    ? linha.preco
    : Math.max(positivo(minimo) ? minimo : 0, positivo(regra) ? regra : 0);
  const maxBruto = base > 0 ? acimaDe10(centavosDe(base * 2)) : 0;
  const maxCentavos = Math.max(maxBruto, minCentavos + PASSO_GRANDE_EM_CENTAVOS);
  return { minCentavos, maxCentavos, passo: PASSO_EM_CENTAVOS };
}

/** Os motivos pelos quais o custo ainda está incompleto, em frases. Vazio quando está tudo certo. */
export function motivosDoCustoIncompleto(real: CustoRealDoProduto | null | undefined): string[] {
  if (real == null) return [];
  const m: string[] = [];
  if (real.sem_tinta) m.push("A tinta ainda não entrou no custo.");
  if (real.material_sem_custo) m.push("Há material da ficha sem custo cadastrado.");
  if (real.sem_mao_de_obra) m.push("A mão de obra ainda não entrou no custo.");
  if (real.custo_incompleto && m.length === 0)
    m.push("Falta informar a manutenção, a limpeza ou o cabeçote da plotter, por isso o custo real é um piso otimista.");
  return m;
}

const SEM_DADO: Record<MotivoSemDado, string> = {
  sem_custo_real: "Sem custo real, não dá para simular. Complete a receita, o tempo e a máquina no cadastro do produto e os custos fixos em Custos fixos e mão de obra.",
  sem_custo_de_producao: "Sem custo de produção calculado, não dá para mostrar a barra.",
  sem_composicao:
    "A composição do custo não está disponível para este produto ou para o seu perfil, por isso a barra não aparece.",
  preco_invalido: "O preço simulado não vale. Escolha um valor maior que zero.",
};
const semDado = (motivo: MotivoSemDado): SemDado => ({
  estado: "sem_dado",
  motivo,
  frase: SEM_DADO[motivo],
});

/** Divide o custo em fatias de centavos que somam exatamente o custo, arredondando pela soma acumulada. */
function fatiasPorAcumulado(valoresEmReais: number[]): number[] {
  let acumulado = 0;
  let anterior = 0;
  return valoresEmReais.map((v) => {
    acumulado += v;
    const ate = centavosDe(acumulado);
    const fatia = ate - anterior;
    anterior = ate;
    return fatia;
  });
}

/** As cinco fatias de custo e os avisos que a composição pede. */
function custosDaComposicao(
  cp: number,
  c: ComposicaoDoCusto,
  ocupacao: number | null,
): { custos: SimuladorPronto["custos"]; avisos: AvisoDoSimulador[] } | null {
  const avisos: AvisoDoSimulador[] = [];
  if (ocupacao == null)
    avisos.push({
      codigo: "sem_ocupacao",
      frase:
        "A ocupação da máquina não foi lida, por isso ela aparece dentro de perdas, falha e extras da plotter.",
    });
  const oc = ocupacao ?? 0;
  let material = c.material;
  let maquina = c.maquina;
  let mao = c.maoDeObra;
  let rateio = c.indireto + oc;
  const soma4 = material + maquina + mao + rateio;
  let perdas = cp - soma4;
  if (perdas < -0.01) {
    if (!(soma4 > 0)) return null;
    const f = cp / soma4;
    material *= f;
    maquina *= f;
    mao *= f;
    rateio *= f;
    perdas = 0;
    avisos.push({
      codigo: "composicao_desatualizada",
      frase:
        "A composição guardada está desatualizada e passa do custo de produção de hoje. As fatias foram ajustadas para fechar no custo de hoje.",
    });
  } else if (perdas < 0) {
    perdas = 0;
  }
  const [m, q, o, r, p] = fatiasPorAcumulado([material, maquina, mao, rateio, perdas]);
  return {
    custos: [
      { codigo: "material", centavos: m },
      { codigo: "maquina", centavos: q },
      { codigo: "mao_de_obra", centavos: o },
      { codigo: "rateio", centavos: r },
      { codigo: "perdas", centavos: p },
    ],
    avisos,
  };
}

/**
 * Prepara o simulador de um produto: custos em centavos, taxas, limites do controle e marcas da régua.
 * Devolve "sem_dado" com o motivo quando falta custo real, custo de produção ou composição. Nunca inventa número.
 */
export function prepararSimulador(linha: LinhaDePreco): SimuladorPronto | SemDado {
  const real = linha.real ?? null;
  if (!positivo(real?.custo_real)) return semDado("sem_custo_real");
  if (!positivo(real?.custo_producao)) return semDado("sem_custo_de_producao");
  const comp = linha.composicao ?? null;
  if (
    comp == null ||
    ![comp.material, comp.maquina, comp.maoDeObra, comp.indireto].every(numeroOk) ||
    [comp.material, comp.maquina, comp.maoDeObra, comp.indireto].some((v) => v < 0)
  )
    return semDado("sem_composicao");
  const limites = limitesDaReguas(linha);
  if (limites == null) return semDado("sem_custo_real");

  const custoReal = real.custo_real;
  const cp = real.custo_producao;
  const dosCustos = custosDaComposicao(cp, comp, real.custo_ocupacao);
  if (dosCustos == null) return semDado("sem_composicao");
  const avisos = [...dosCustos.avisos];

  const taxaLida = taxaSobreAVenda(linha.taxas ?? null);
  const taxasLidas = taxaLida != null && linha.taxas != null;
  let taxa: number;
  let impostoPct = 0;
  let cartaoPct = 0;
  if (taxasLidas && linha.taxas) {
    taxa = taxaLida as number;
    impostoPct = linha.taxas.impostoVendaPct;
    cartaoPct = linha.taxas.taxaCartaoPct / 2;
  } else {
    taxa = Math.min(Math.max(1 - cp / custoReal, 0), 0.99);
    avisos.push({
      codigo: "sem_taxas",
      frase:
        "As taxas de imposto e cartão não foram lidas. Imposto e cartão aparecem juntos, pela diferença entre o custo de produção e o custo real.",
    });
  }

  const minimo = leituraDoMinimo(linha, linha.preco).minimo;
  const minimoCentavos = positivo(minimo) ? centavosDe(minimo) : null;
  if (minimoCentavos == null)
    avisos.push({
      codigo: "sem_minimo",
      frase:
        "Sem preço mínimo recomendado calculado. A faixa amarela não existe para este produto.",
    });
  if (!positivo(linha.preco))
    avisos.push({
      codigo: "sem_preco_de_balcao",
      frase:
        "Este produto não tem preço de balcão. A régua usa o dobro do mínimo ou da regra de três.",
    });

  const porPeca = fraseDoMaterialPorPeca(linha);
  if (porPeca != null) avisos.push({ codigo: "material_por_peca", frase: porPeca });

  const regra = leituraReal(linha, linha.preco).regra;
  const largura = limites.maxCentavos - limites.minCentavos;
  const marca = (codigo: CodigoDaMarca, rotulo: string, valor: number | null | undefined) => {
    if (!positivo(valor)) return null;
    const centavos = centavosDe(valor);
    const pos = ((centavos - limites.minCentavos) / largura) * 100;
    return {
      codigo,
      rotulo,
      centavos,
      pos,
      dentro: centavos >= limites.minCentavos && centavos <= limites.maxCentavos,
    } satisfies Marca;
  };
  const marcas = [
    marca("minimo", "Mínimo recomendado", minimo),
    marca("regra_de_tres", "Regra de três", regra),
    marca("hoje", "Preço de hoje", linha.preco),
    marca("parceiro", "Parceiro", linha.preco_parceiro),
    marca("concorrente", "Menor concorrente", linha.menor_concorrente),
  ].filter((m): m is Marca => m != null);

  return {
    estado: "pronto",
    custoRealCentavos: centavosDe(custoReal),
    equilibrioCentavos: acharEquilibrio(
      { taxasLidas, impostoPct, cartaoPct, taxa },
      dosCustos.custos.reduce((soma, c) => soma + c.centavos, 0),
      centavosDe(custoReal),
    ),
    custoDeProducaoCentavos: centavosDe(cp),
    minimoCentavos,
    taxa,
    taxasLidas,
    impostoPct,
    cartaoPct,
    custos: dosCustos.custos,
    avisos,
    limites,
    marcas,
    precoDeHojeCentavos: positivo(linha.preco) ? centavosDe(linha.preco) : null,
  };
}

/** Zona do preço. Abaixo do custo real o lucro é negativo; abaixo do mínimo recomendado a margem fica menor que a aceita. */
export function zonaDoPreco(
  precoCentavos: number,
  custoRealCentavos: number,
  minimoCentavos: number | null,
): FaixaDoSimulador {
  if (precoCentavos < custoRealCentavos) return "abaixo_do_custo";
  if (minimoCentavos == null || minimoCentavos <= custoRealCentavos) return "acima";
  if (precoCentavos < minimoCentavos) return "abaixo_do_minimo";
  if (precoCentavos <= minimoCentavos * (1 + FOLGA_NO_MINIMO)) return "no_minimo";
  return "acima";
}

/** Imposto e cartão em centavos, e o lucro, para um preço inteiro em centavos. Mesma conta da simulação. */
function contaDoPreco(
  p: Pick<SimuladorPronto, "taxasLidas" | "impostoPct" | "cartaoPct" | "taxa">,
  somaCustos: number,
  preco: number,
) {
  let imposto: number;
  let cartao: number;
  if (p.taxasLidas) {
    imposto = Math.round((preco * p.impostoPct) / 100);
    cartao = Math.round((preco * p.cartaoPct) / 100);
  } else {
    imposto = Math.round(preco * p.taxa);
    cartao = 0;
  }
  return { imposto, cartao, lucro: preco - somaCustos - imposto - cartao };
}

/**
 * O menor preço, em centavos, em que o lucro não é negativo. O lucro só cresce com o preço, então a busca é binária.
 * Com dado em ordem cai a poucos centavos do custo real; se a composição e o custo real divergirem, vale o lucro.
 */
function acharEquilibrio(
  p: Pick<SimuladorPronto, "taxasLidas" | "impostoPct" | "cartaoPct" | "taxa">,
  somaCustos: number,
  custoRealCentavos: number,
): number {
  let baixo = 1;
  let alto = Math.max(1, (custoRealCentavos + somaCustos) * 10 + 100);
  while (baixo < alto) {
    const meio = Math.floor((baixo + alto) / 2);
    if (contaDoPreco(p, somaCustos, meio).lucro >= 0) alto = meio;
    else baixo = meio + 1;
  }
  return baixo;
}

/** Simula o preço dado. Preço inválido vira "sem_dado", nunca NaN. */
export function simularNoPreco(p: SimuladorPronto, precoCentavos: number): Simulacao | SemDado {
  if (!numeroOk(precoCentavos) || precoCentavos <= 0) return semDado("preco_invalido");
  const preco = Math.round(precoCentavos);
  const somaCustos = p.custos.reduce((s, c) => s + c.centavos, 0);

  const { imposto, cartao, lucro } = contaDoPreco(p, somaCustos, preco);
  const taxas: Array<{ codigo: CodigoDaFatia; centavos: number }> = p.taxasLidas
    ? [
        { codigo: "imposto", centavos: imposto },
        { codigo: "cartao", centavos: cartao },
      ]
    : [{ codigo: "imposto_e_cartao", centavos: imposto }];
  const saidas = somaCustos + imposto + cartao;
  // Com lucro, a barra é o preço. Com prejuízo, a barra é tudo o que sai, e o preço fica marcado dentro dela.
  const total = Math.max(preco, saidas);

  const itens = [
    ...p.custos,
    ...taxas,
    { codigo: (lucro < 0 ? "prejuizo" : "lucro") as CodigoDaFatia, centavos: lucro },
  ];
  const fatias: Fatia[] = itens.map((i) => ({
    codigo: i.codigo,
    rotulo: ROTULO_DA_FATIA[i.codigo],
    centavos: i.centavos,
    pctDoPreco: (i.centavos / preco) * 100,
    larguraNaBarra: i.centavos > 0 ? (i.centavos / total) * 100 : 0,
  }));

  return {
    estado: "ok",
    precoCentavos: preco,
    fatias,
    lucroCentavos: lucro,
    lucroPct: (lucro / preco) * 100,
    vezesOCusto: preco / p.custoRealCentavos,
    ganhoPorReal: 1 - p.taxa,
    // O vermelho vai até o equilíbrio e, por garantia, vale sempre que o lucro é negativo.
    faixa:
      lucro < 0 ? "abaixo_do_custo" : zonaDoPreco(preco, p.equilibrioCentavos, p.minimoCentavos),
    posicaoDoPrecoNaBarra: (preco / total) * 100,
  };
}

/** Frase viva: o ganho a cada R$ 1 a mais, e o lucro contra o preço de hoje. Sem parênteses, sem travessão, sem seta. */
export function fraseViva(p: SimuladorPronto, s: Simulacao): string {
  const ganho = reaisPorExtenso(Math.round(s.ganhoPorReal * 100));
  let f = `A cada R$ 1,00 a mais no preço sobram ${ganho} de lucro.`;
  if (!p.taxasLidas) f += " Não deu para separar imposto e cartão.";
  const hoje = p.precoDeHojeCentavos;
  if (hoje != null && hoje !== s.precoCentavos) {
    const h = simularNoPreco(p, hoje);
    if (h.estado === "ok") {
      const de = h.lucroCentavos;
      const para = s.lucroCentavos;
      const dif = Math.abs(para - de);
      f += ` Contra o preço de hoje, o lucro por unidade vai de ${lucroEmPalavras(de)} para ${lucroEmPalavras(para)}, ${para > de ? "ganhando" : "perdendo"} ${reaisPorExtenso(dif)}.`;
    }
  }
  return f;
}

/** Lucro em palavras. Negativo vira prejuízo, sem sinal solto. */
export function lucroEmPalavras(centavos: number): string {
  return centavos < 0
    ? `prejuízo de ${reaisPorExtenso(-centavos)}`
    : `lucro de ${reaisPorExtenso(centavos)}`;
}

/** O lucro em reais e em por cento, numa frase. */
export function fraseDoLucro(s: Simulacao): string {
  return s.lucroCentavos < 0
    ? `Prejuízo de ${reaisPorExtenso(-s.lucroCentavos)} por unidade, ${pctTexto(-s.lucroPct)} por cento do preço.`
    : `Lucro de ${reaisPorExtenso(s.lucroCentavos)} por unidade, ${pctTexto(s.lucroPct)} por cento do preço.`;
}

export const TEXTO_DO_LUCRO_SOBRE_O_PRECO =
  "Lucro sobre o preço divide o lucro pelo preço inteiro. A margem líquida da lista divide pelo preço sem imposto e cartão, por isso mostra um número um pouco maior.";

/** Valor lido pelo leitor de tela ao mexer no controle. */
export function textoDeValorDoControle(precoCentavos: number, faixa: FaixaDoSimulador): string {
  return `${reaisPorExtenso(precoCentavos)}, ${ROTULO_DA_FAIXA_DO_SIMULADOR[faixa].toLowerCase()}`;
}

/** Resumo da barra empilhada para o leitor de tela: cada fatia com valor e por cento. */
export function resumoDaBarra(s: Simulacao): string {
  const partes = s.fatias.map(
    (f) =>
      `${f.rotulo} ${reaisPorExtenso(Math.abs(f.centavos))}, ${pctTexto(Math.abs(f.pctDoPreco))} por cento`,
  );
  return `Para onde vai cada real de um preço de ${reaisPorExtenso(s.precoCentavos)}. ${partes.join(". ")}.`;
}

/** Texto de uma marca para a lista abaixo da régua, dizendo quando ela não cabe. */
export function textoDaMarca(m: Marca, l: Limites): string {
  const valor = reaisPorExtenso(m.centavos);
  if (m.dentro) return `${m.rotulo}, ${valor}`;
  return m.centavos < l.minCentavos
    ? `${m.rotulo}, ${valor}, fora da régua, abaixo do custo real`
    : `${m.rotulo}, ${valor}, fora da régua, acima do dobro do balcão`;
}
