/**
 * Preço mínimo recomendado de cada produto. Funções puras, sem banco e sem tela.
 *
 * Decisão do dono em 16/11/2026. O mínimo é o MAIOR entre duas travas:
 *
 *   a) regra de três: multiplicador, hoje 3, vezes o material com perda e falha;
 *   b) piso do custo de produção: custo de produção dividido por
 *      (1 menos margem mínima do produto menos imposto sobre a venda menos metade da taxa do cartão).
 *
 * A margem mínima é a do produto, ou 30 quando o cadastro está vazio ou zerado. As taxas vêm de custos_tabela.
 * O custo de produção já vem do banco com a ocupação alvo: o custo da conversão por metro quadrado, que é a hora da
 * máquina sem a energia, a mão de obra com encargos e o rateio com o aluguel, é dividido pela ocupação alvo, porque
 * nem a plotter, nem o impressor, nem o aluguel trabalham todas as horas pagas. Energia e perdas não são divididas.
 *
 * Quem calcula o mínimo para valer é o banco, na visão produto_custo_real. A tela lê os valores de lá e usa a função
 * daqui para reproduzir a conta na prévia e para completar o que o banco deixar vazio. Nada aqui grava preço: o mínimo
 * é recomendação, e a mudança de preço continua passando pela proposta e pela aprovação.
 */
import type { CustoRealDoProduto } from "./custo-real";

/** Margem mínima usada quando o produto não tem uma. Mesma regra do banco: COALESCE(NULLIF(margem_minima, 0), 30). */
export const MARGEM_MINIMA_PADRAO = 30;
/** Até quantos por cento acima do mínimo ainda conta como "no mínimo". */
export const TOLERANCIA_DO_MINIMO = 2;

export type TravaDoMinimo = "regra_de_3" | "piso_custo";
export type FaixaDoMinimo = "abaixo" | "no_minimo" | "acima" | "sem_dado";

/** Percentuais lidos de custos_tabela: impostos_venda e taxa_cartao. */
export type TaxasDeVenda = { impostoVendaPct: number; taxaCartaoPct: number };

export const ROTULO_DA_FAIXA_DO_MINIMO: Record<FaixaDoMinimo, string> = {
  abaixo: "Abaixo do mínimo",
  no_minimo: "No mínimo",
  acima: "Acima do mínimo",
  sem_dado: "Sem mínimo calculado",
};

export const ROTULO_DA_TRAVA: Record<TravaDoMinimo, string> = {
  regra_de_3: "a regra de três",
  piso_custo: "o piso do custo de produção",
};

const centavos = (n: number) => Math.round(n * 100) / 100;
const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pt = (n: number, casas = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });

const positivo = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n > 0;

/** Margem mínima em uso: a do produto, ou 30 quando vazia ou zero. */
export function margemMinimaUsada(margem: number | null | undefined): number {
  return positivo(margem) ? margem : MARGEM_MINIMA_PADRAO;
}

/** Imposto sobre a venda mais metade da taxa do cartão, em fração de 0 a 0,99. Nulo sem taxas lidas. */
export function taxaSobreAVenda(t: TaxasDeVenda | null | undefined): number | null {
  if (t == null) return null;
  const bruta = (t.impostoVendaPct + t.taxaCartaoPct / 2) / 100;
  return Math.min(Math.max(bruta, 0), 0.99);
}

export type EntradaDoMinimo = {
  /** Material com perda e falha, por unidade de venda. */
  materialComPerda: number | null;
  /** Custo de produção, já com a ocupação alvo. */
  custoProducao: number | null;
  /** Margem mínima do produto em por cento. Vazio ou zero vira 30. */
  margemMinimaPct: number | null;
  taxas: TaxasDeVenda | null;
  /** Multiplicador da regra de três, hoje 3. */
  multiplicador: number | null;
};

export type PrecoMinimo = {
  /** Multiplicador vezes o material com perda. Nulo sem material ou sem multiplicador. */
  tresXMaterial: number | null;
  /** Custo de produção dividido pelo que sobra de cada real vendido. Nulo sem custo ou sem taxas. */
  piso: number | null;
  /** O que sobra de cada real vendido depois de margem, imposto e metade do cartão. */
  fatorDoPiso: number | null;
  minimo: number;
  trava: TravaDoMinimo;
};

/**
 * O mínimo e a trava que manda. Empate vai para a regra de três. Sem nenhuma das duas contas devolve nulo:
 * a tela diz que falta dado, nunca inventa número.
 */
export function precoMinimoRecomendado(e: EntradaDoMinimo): PrecoMinimo | null {
  const tres =
    positivo(e.materialComPerda) && positivo(e.multiplicador)
      ? centavos(e.multiplicador * e.materialComPerda)
      : null;

  const taxa = taxaSobreAVenda(e.taxas);
  // Seis casas: sem isso, margem e taxas que somam cem por cento deixam um resto de ponto flutuante e o piso explode.
  const fator =
    taxa == null
      ? null
      : Math.round((1 - margemMinimaUsada(e.margemMinimaPct) / 100 - taxa) * 1e6) / 1e6;
  const piso =
    positivo(e.custoProducao) && fator != null && fator > 0
      ? centavos(e.custoProducao / fator)
      : null;

  if (tres == null && piso == null) return null;
  const regraManda = piso == null || (tres != null && tres >= piso);
  return {
    tresXMaterial: tres,
    piso,
    fatorDoPiso: fator != null && fator > 0 ? fator : null,
    minimo: regraManda ? (tres as number) : (piso as number),
    trava: regraManda ? "regra_de_3" : "piso_custo",
  };
}

export type LeituraDoMinimo = {
  /** Não há mínimo para mostrar: falta custo, material ou o banco ainda não entrega. */
  semMinimo: boolean;
  minimo: number | null;
  trava: TravaDoMinimo | null;
  tresXMaterial: number | null;
  piso: number | null;
  fatorDoPiso: number | null;
  materialComPerda: number | null;
  custoProducao: number | null;
  multiplicador: number | null;
  ocupacaoAlvoPct: number | null;
  custoOcupacao: number | null;
  margemMinimaPct: number;
  taxas: TaxasDeVenda | null;
  /** Preço menos mínimo. Negativo quer dizer abaixo do mínimo. */
  diferenca: number | null;
  faixa: FaixaDoMinimo;
};

export function faixaDoMinimo(preco: number | null, minimo: number | null): FaixaDoMinimo {
  if (!positivo(preco) || !positivo(minimo)) return "sem_dado";
  if (preco < minimo - 0.005) return "abaixo";
  if (preco <= minimo * (1 + TOLERANCIA_DO_MINIMO / 100) + 0.005) return "no_minimo";
  return "acima";
}

export function diferencaDoMinimo(preco: number | null, minimo: number | null): number | null {
  if (!positivo(preco) || !positivo(minimo)) return null;
  return centavos(preco - minimo);
}

type EntradaDaLeitura = {
  real?: CustoRealDoProduto | null;
  margem_minima: number | null;
  taxas?: TaxasDeVenda | null;
};

/**
 * Lê o mínimo de um produto para um preço dado. O que o banco entrega manda; a função completa o que faltar, a partir
 * das mesmas entradas: material com perda sai de tres_x_material dividido pelo multiplicador.
 */
export function leituraDoMinimo(l: EntradaDaLeitura, preco: number | null): LeituraDoMinimo {
  const r = l.real ?? null;
  const multiplicador = positivo(r?.multiplicador_regra_de_tres)
    ? r.multiplicador_regra_de_tres
    : null;
  const materialComPerda =
    positivo(r?.tres_x_material) && multiplicador != null
      ? r.tres_x_material / multiplicador
      : null;
  const custoProducao = positivo(r?.custo_producao) ? r.custo_producao : null;
  const taxas = l.taxas ?? null;

  const calc = precoMinimoRecomendado({
    materialComPerda,
    custoProducao,
    margemMinimaPct: l.margem_minima,
    taxas,
    multiplicador,
  });

  const doBanco = positivo(r?.preco_minimo_recomendado) ? r.preco_minimo_recomendado : null;
  const minimo = doBanco ?? calc?.minimo ?? null;
  const trava = (doBanco != null ? r?.trava_que_manda : null) ?? calc?.trava ?? null;
  return {
    semMinimo: minimo == null,
    minimo,
    trava: minimo == null ? null : trava,
    tresXMaterial: (positivo(r?.tres_x_material) ? r.tres_x_material : null) ?? calc?.tresXMaterial ?? null,
    piso: (positivo(r?.piso_custo_producao) ? r.piso_custo_producao : null) ?? calc?.piso ?? null,
    fatorDoPiso: calc?.fatorDoPiso ?? null,
    materialComPerda: materialComPerda != null ? centavos(materialComPerda) : null,
    custoProducao,
    multiplicador,
    ocupacaoAlvoPct: positivo(r?.ocupacao_alvo_pct) ? r.ocupacao_alvo_pct : null,
    custoOcupacao: r?.custo_ocupacao ?? null,
    margemMinimaPct: margemMinimaUsada(l.margem_minima),
    taxas,
    diferenca: diferencaDoMinimo(preco, minimo),
    faixa: faixaDoMinimo(preco, minimo),
  };
}

/** A diferença contra o mínimo, em palavras. Sem sinal solto, sem seta. */
export function fraseDaDiferencaDoMinimo(diferenca: number | null): string {
  if (diferenca == null) return "Sem diferença, falta o mínimo";
  if (diferenca === 0) return "Igual ao mínimo";
  const v = reais(Math.abs(diferenca));
  return diferenca > 0 ? `${v} acima do mínimo` : `${v} abaixo do mínimo`;
}

/** O que a prévia diz na hora em que a pessoa digita um preço. */
export function fraseDaPreviaDoMinimo(leitura: LeituraDoMinimo, digitado: number | null): string {
  if (leitura.minimo == null) return "Sem mínimo recomendado para este produto, falta custo.";
  const base = `Mínimo recomendado ${reais(leitura.minimo)}.`;
  if (digitado == null || leitura.faixa === "sem_dado") return base;
  if (leitura.faixa === "abaixo")
    return `${base} O preço digitado está ${reais(Math.abs(leitura.diferenca ?? 0))} abaixo do mínimo.`;
  if (leitura.faixa === "no_minimo") return `${base} O preço digitado está no mínimo.`;
  return `${base} O preço digitado está ${reais(Math.abs(leitura.diferenca ?? 0))} acima do mínimo.`;
}

/** As frases do tooltip de um produto, na ordem: qual trava manda, os dois valores, a ocupação. */
export function frasesDoMinimo(leitura: LeituraDoMinimo): string[] {
  if (leitura.minimo == null || leitura.trava == null)
    return [
      "Este produto ainda não tem preço mínimo recomendado. Falta o custo do material na ficha ou o custo de produção.",
    ];
  const f: string[] = [];
  f.push(
    `Hoje manda ${ROTULO_DA_TRAVA[leitura.trava]}. O mínimo recomendado de ${reais(leitura.minimo)} é o maior entre os dois valores abaixo.`,
  );

  if (leitura.tresXMaterial != null) {
    const veze = leitura.multiplicador != null ? pt(leitura.multiplicador) : "o multiplicador";
    const mat =
      leitura.materialComPerda != null
        ? `, que é ${reais(leitura.materialComPerda)}`
        : "";
    f.push(
      `A regra de três dá ${reais(leitura.tresXMaterial)}. É ${veze} vezes o material com perda e falha${mat}.`,
    );
  } else {
    f.push("A regra de três não entra: falta o material com custo na ficha do produto.");
  }

  if (leitura.piso != null) {
    const cp = leitura.custoProducao != null ? ` de ${reais(leitura.custoProducao)}` : "";
    const t = leitura.taxas;
    const fator = leitura.fatorDoPiso != null ? pt(leitura.fatorDoPiso, 4) : null;
    const resto =
      t != null && fator != null
        ? ` dividido por ${fator}, que é o que sobra de cada real vendido depois da margem mínima de ${pt(leitura.margemMinimaPct)} por cento, do imposto sobre a venda de ${pt(t.impostoVendaPct)} por cento e de metade da taxa do cartão, ${pt(t.taxaCartaoPct / 2)} por cento`
        : "";
    f.push(
      `O piso do custo de produção dá ${reais(leitura.piso)}. É o custo de produção${cp}${resto}.`,
    );
  } else {
    f.push("O piso do custo de produção não entra: falta custo de produção, margem ou as taxas.");
  }

  if (leitura.ocupacaoAlvoPct != null) {
    f.push(
      `O custo de produção usa a ocupação alvo de ${pt(leitura.ocupacaoAlvoPct)} por cento. Nem a plotter, nem o impressor, nem o aluguel trabalham todas as horas pagas, por isso o custo por hora sobe.` +
        (leitura.custoOcupacao != null && leitura.custoOcupacao > 0
          ? ` O custo da ocupação neste produto é de ${reais(leitura.custoOcupacao)}.`
          : ""),
    );
  } else {
    f.push("A ocupação alvo ainda não chegou do banco, por isso não dá para explicar o custo por hora.");
  }
  return f;
}

export const TEXTO_DO_MINIMO =
  "O preço mínimo recomendado é o maior entre dois valores. O primeiro é a regra de três, que é o multiplicador vezes o material com perda e falha. O segundo é o piso do custo de produção, com a margem mínima do produto e as taxas. É uma recomendação: quem muda o preço é uma pessoa, em preços pendentes.";

export const LEGENDA_DO_MINIMO: Array<{ faixa: FaixaDoMinimo; texto: string }> = [
  { faixa: "abaixo", texto: "Abaixo do mínimo: o balcão está abaixo do preço mínimo recomendado" },
  { faixa: "no_minimo", texto: "No mínimo: o balcão está até dois por cento acima do mínimo recomendado" },
  { faixa: "acima", texto: "Acima do mínimo: o balcão passa do mínimo recomendado" },
];

/** Parâmetros que o banco entrega junto com o custo real e que a tela explica em texto. */
export type ParametrosDoMinimo = {
  ocupacaoAlvoPct: number | null;
  multiplicador: number | null;
};

/** O texto explicativo da tela sobre a fórmula e a ocupação, com os números de hoje quando existem. */
export function textosDoPrecoMinimo(p: ParametrosDoMinimo | null): {
  formula: string;
  ocupacao: string;
  nomes: string;
} {
  const mult = p?.multiplicador != null ? pt(p.multiplicador) : "3";
  const oc =
    p?.ocupacaoAlvoPct != null
      ? `, hoje ${pt(p.ocupacaoAlvoPct)} por cento`
      : "";
  return {
    formula: `O preço mínimo recomendado é o maior entre dois valores. O primeiro é ${mult} vezes o material com perda e falha. O segundo é o piso do custo de produção, que é o custo de produção dividido pelo que sobra do preço depois da margem mínima do produto, do imposto sobre a venda e de metade da taxa do cartão.`,
    nomes:
      "A coluna Preço pela regra de três segue sendo o custo real vezes três, só para comparar. A regra de três do preço mínimo é outra conta, feita sobre o material com perda e falha.",
    ocupacao: `Nem a plotter, nem o impressor, nem o aluguel trabalham cem por cento do tempo que a gráfica paga. Por isso o custo por hora sobe pela ocupação alvo${oc}. A energia e as perdas não sobem, porque só correm quando a máquina roda.`,
  };
}
