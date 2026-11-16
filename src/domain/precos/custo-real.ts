/**
 * Custo real, margem líquida e regra de três da tela "Preços por produto". Funções puras, sem banco e sem tela.
 *
 * Quem calcula o custo real é o banco, na visão produto_custo_real: custo de produção com perda e falha, mais imposto
 * e metade da taxa do cartão, tudo lido de custos_tabela. A tela NUNCA digita percentual: ela só recebe o custo real
 * pronto e faz as contas que dependem do preço de balcão, que pode ser o do cadastro ou o que a pessoa está digitando.
 *
 *   margem líquida = (balcão menos custo real) dividido pelo balcão
 *   vezes o custo  = balcão dividido pelo custo real, com uma casa decimal
 *   regra de três  = 3 vezes o custo real, arredondada em centavos
 *
 * A regra de três é referência, não meta automática. Nenhuma conta aqui grava preço.
 */
import { fraseDaVelocidade } from "../maquinas/velocidade-de-calculo";
import { faixaDaMargem, type FaixaDaMargem } from "./propostas";

export { fraseDaVelocidade };

export const VEZES_DA_REGRA = 3;
/** Preço de mercado local da lona, em reais por metro quadrado. Mesmo número de REFERENCIA_M2 em propostas. */
export const MERCADO_LOCAL_DA_LONA = 70;

/** O que a visão produto_custo_real entrega por produto, já com números e não com texto do banco. */
export type CustoRealDoProduto = {
  custo_producao: number | null;
  custo_real: number | null;
  margem_liquida_pct: number | null;
  vezes_o_custo: number | null;
  preco_regra_de_tres: number | null;
  sem_tinta: boolean;
  material_sem_custo: boolean;
  sem_mao_de_obra: boolean;
  custo_incompleto: boolean;
  velocidade_usada_m2_h: number | null;
  velocidade_nominal_m2_h: number | null;
  tempo_presumido: boolean;
  parceiro_abaixo_do_piso: boolean;
};

/** Colunas lidas da visão. A ordem não importa, mas o nome é o contrato com o banco. */
export const COLUNAS_DO_CUSTO_REAL = [
  "produto_id",
  "nome",
  "familia",
  "preco_balcao",
  "custo_producao",
  "custo_real",
  "margem_liquida_pct",
  "vezes_o_custo",
  "preco_regra_de_tres",
  "sem_tinta",
  "material_sem_custo",
  "sem_mao_de_obra",
  "custo_incompleto",
  "velocidade_usada_m2_h",
  "velocidade_nominal_m2_h",
  "tempo_presumido",
  "parceiro_abaixo_do_piso",
] as const;

const numero = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Lê uma linha da visão. Valor ausente vira nulo e marca falsa, nunca um número inventado. */
export function lerCustoReal(r: Record<string, unknown>): CustoRealDoProduto {
  return {
    custo_producao: numero(r.custo_producao),
    custo_real: numero(r.custo_real),
    margem_liquida_pct: numero(r.margem_liquida_pct),
    vezes_o_custo: numero(r.vezes_o_custo),
    preco_regra_de_tres: numero(r.preco_regra_de_tres),
    sem_tinta: r.sem_tinta === true,
    material_sem_custo: r.material_sem_custo === true,
    sem_mao_de_obra: r.sem_mao_de_obra === true,
    custo_incompleto: r.custo_incompleto === true,
    velocidade_usada_m2_h: numero(r.velocidade_usada_m2_h),
    velocidade_nominal_m2_h: numero(r.velocidade_nominal_m2_h),
    tempo_presumido: r.tempo_presumido === true,
    parceiro_abaixo_do_piso: r.parceiro_abaixo_do_piso === true,
  };
}

/**
 * Quando o banco ainda não tem a visão ou uma das colunas, a mensagem é humana e não um código.
 * Devolve nulo quando o erro é de outra natureza, para quem chamou decidir.
 */
export function mensagemDoCustoRealAusente(mensagem: string): string | null {
  const m = mensagem.toLowerCase();
  // Permissão negada NÃO é visão ausente: esconder isso seria mascarar um vazamento ou um GRANT quebrado.
  const ausente =
    !m.includes("permission denied") &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("42p01") ||
      m.includes("42703") ||
      m.includes("pgrst204") ||
      m.includes("pgrst205"));
  return ausente
    ? "O custo real ainda não está ligado no banco. A tabela mostra só o custo de antes. Avise o suporte."
    : null;
}

const centavos = (n: number) => Math.round(n * 100) / 100;
const umaCasa = (n: number) => Math.round(n * 10) / 10;

export function margemLiquida(preco: number | null, custoReal: number | null): number | null {
  if (preco == null || custoReal == null || !(preco > 0) || !(custoReal > 0)) return null;
  return Math.round(((preco - custoReal) / preco) * 1000) / 10;
}

export function vezesOCusto(preco: number | null, custoReal: number | null): number | null {
  if (preco == null || custoReal == null || !(preco > 0) || !(custoReal > 0)) return null;
  return umaCasa(preco / custoReal);
}

export function regraDeTres(custoReal: number | null): number | null {
  if (custoReal == null || !(custoReal > 0)) return null;
  return centavos(custoReal * VEZES_DA_REGRA);
}

/** Balcão menos regra de três. Negativo quer dizer que o balcão está abaixo da regra. */
export function diferencaDaRegra(preco: number | null, regra: number | null): number | null {
  if (preco == null || regra == null || !(preco > 0)) return null;
  return centavos(preco - regra);
}

export type FaixaDaRegra =
  | "abaixo_do_custo"
  | "abaixo_da_regra"
  | "na_regra"
  | "acima"
  | "sem_dado";

export const ROTULO_DA_REGRA: Record<FaixaDaRegra, string> = {
  abaixo_do_custo: "Abaixo do custo",
  abaixo_da_regra: "Abaixo da regra de três",
  na_regra: "Na regra de três",
  acima: "Acima da regra de três",
  sem_dado: "Sem custo real",
};

/** Até quantos por cento da regra de três ainda conta como "na regra". */
export const TOLERANCIA_DA_REGRA = 2;

export function faixaDaRegra(
  preco: number | null,
  custoReal: number | null,
  regra: number | null,
): FaixaDaRegra {
  if (preco == null || !(preco > 0) || custoReal == null || !(custoReal > 0) || regra == null)
    return "sem_dado";
  if (preco < custoReal) return "abaixo_do_custo";
  const folga = (regra * TOLERANCIA_DA_REGRA) / 100;
  if (preco < regra - folga) return "abaixo_da_regra";
  if (preco <= regra + folga) return "na_regra";
  return "acima";
}

/** A diferença contra a regra de três, em palavras. Sem sinal solto, sem seta. */
export function fraseDaDiferenca(diferenca: number | null): string {
  if (diferenca == null) return "Sem diferença, falta custo real";
  const v = Math.abs(diferenca).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (diferenca === 0) return "Igual à regra de três";
  return diferenca > 0 ? `${v} acima da regra` : `${v} abaixo da regra`;
}

/** O que a tela precisa de um produto, para um preço dado. */
export type LeituraReal = {
  /** Falta custo real para este produto. */
  semCustoReal: boolean;
  custoReal: number | null;
  margem: number | null;
  faixaDaMargem: FaixaDaMargem;
  vezes: number | null;
  regra: number | null;
  diferenca: number | null;
  faixaDaRegra: FaixaDaRegra;
};

export function leituraReal(
  l: { real?: CustoRealDoProduto | null; margem_minima: number | null },
  preco: number | null,
): LeituraReal {
  const custoReal = l.real?.custo_real != null && l.real.custo_real > 0 ? l.real.custo_real : null;
  const margem = margemLiquida(preco, custoReal);
  const regra = regraDeTres(custoReal);
  return {
    semCustoReal: custoReal == null,
    custoReal,
    margem,
    faixaDaMargem: faixaDaMargem(margem, l.margem_minima),
    vezes: vezesOCusto(preco, custoReal),
    regra,
    diferenca: diferencaDaRegra(preco, regra),
    faixaDaRegra: faixaDaRegra(preco, custoReal, regra),
  };
}

/** Texto da margem líquida, escrito por extenso, sem parênteses. */
export function fraseDaMargemLiquida(leitura: LeituraReal, minima: number | null): string {
  const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (leitura.margem == null) return "Sem margem líquida, falta o custo real ou o preço";
  const base = `Margem líquida de ${n(leitura.margem)} por cento`;
  if (minima == null) return base;
  if (leitura.faixaDaMargem === "abaixo") return `${base}, abaixo do mínimo de ${n(minima)}`;
  if (leitura.faixaDaMargem === "perto") return `${base}, perto do mínimo de ${n(minima)}`;
  return `${base}, acima do mínimo de ${n(minima)}`;
}

export const ROTULO_DA_MARGEM_LIQUIDA: Record<FaixaDaMargem, string> = {
  abaixo: "Abaixo do mínimo",
  perto: "Margem justa",
  acima: "Margem boa",
  sem_dado: "Sem margem",
};

// ---------------------------------------------------------------------------------------------------------------
// Avisos por produto

export type Gravidade = "alta" | "media" | "info";

export const ROTULO_DA_GRAVIDADE: Record<Gravidade, string> = {
  alta: "Atenção",
  media: "Cuidado",
  info: "Informação",
};

export type CodigoDeAviso =
  | "sem_custo_real"
  | "abaixo_do_custo"
  | "parceiro_abaixo_do_piso_liquido"
  | "parceiro_acima_do_balcao"
  | "material_sem_custo"
  | "sem_mao_de_obra"
  | "sem_tinta"
  | "custo_incompleto"
  | "margem_liquida_abaixo_do_minimo"
  | "tempo_presumido"
  | "velocidade_com_margem"
  | "abaixo_da_regra_de_tres"
  | "mercado_local_da_lona";

export type AvisoDoProduto = { codigo: CodigoDeAviso; gravidade: Gravidade; frase: string };

const ORDEM_DA_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1, info: 2 };

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export type EntradaDeAvisos = {
  nome: string;
  familia: string | null;
  unidade: string;
  margem_minima: number | null;
  preco_parceiro: number | null;
  real?: CustoRealDoProduto | null;
};

/** Os avisos de um produto para um preço dado, do mais grave ao mais leve. Sem aviso, lista vazia. */
export function avisosDoProduto(l: EntradaDeAvisos, preco: number | null): AvisoDoProduto[] {
  const a: AvisoDoProduto[] = [];
  const r = l.real ?? null;
  const leitura = leituraReal(l, preco);

  if (r == null || leitura.semCustoReal) {
    a.push({
      codigo: "sem_custo_real",
      gravidade: "media",
      frase:
        "Este produto ainda não tem custo real calculado. Sem ele não dá para medir a margem líquida.",
    });
  }
  if (leitura.faixaDaRegra === "abaixo_do_custo" && leitura.custoReal != null) {
    a.push({
      codigo: "abaixo_do_custo",
      gravidade: "alta",
      frase: `O preço de balcão está abaixo do custo real de ${reais(leitura.custoReal)}. Cada venda dá prejuízo.`,
    });
  }
  if (r?.parceiro_abaixo_do_piso) {
    a.push({
      codigo: "parceiro_abaixo_do_piso_liquido",
      gravidade: "alta",
      frase:
        "O preço do parceiro está abaixo do piso líquido. Vender a ele deixa menos lucro do que a casa aceitou. A gerência precisa confirmar.",
    });
  }
  if (preco != null && preco > 0 && l.preco_parceiro != null && l.preco_parceiro > preco) {
    a.push({
      codigo: "parceiro_acima_do_balcao",
      gravidade: "alta",
      frase: "O preço do parceiro passa do balcão. Isso não pode.",
    });
  }
  if (r?.material_sem_custo) {
    a.push({
      codigo: "material_sem_custo",
      gravidade: "alta",
      frase:
        "Há material da ficha sem custo cadastrado. O custo real está abaixo do verdadeiro até o custo entrar.",
    });
  }
  if (r?.sem_mao_de_obra) {
    a.push({
      codigo: "sem_mao_de_obra",
      gravidade: "media",
      frase:
        "A ficha não tem tempo de mão de obra. O custo real não inclui o trabalho de quem produz.",
    });
  }
  if (r?.sem_tinta) {
    a.push({
      codigo: "sem_tinta",
      gravidade: "media",
      frase:
        "A ficha não tem tinta. Se o produto é impresso, o custo real está abaixo do verdadeiro.",
    });
  }
  if (r?.custo_incompleto) {
    a.push({
      codigo: "custo_incompleto",
      gravidade: "media",
      frase:
        "O custo está incompleto. Falta confirmar algum custo fixo da gráfica, como aluguel, manutenção ou consumo de tinta. O custo real é um piso otimista.",
    });
  }
  if (leitura.faixaDaMargem === "abaixo" && l.margem_minima != null) {
    a.push({
      codigo: "margem_liquida_abaixo_do_minimo",
      gravidade: "media",
      frase: `A margem líquida está abaixo do mínimo cadastrado de ${pt(l.margem_minima)} por cento. Esse mínimo foi definido sobre o material.`,
    });
  }
  if (
    leitura.faixaDaRegra === "abaixo_da_regra" &&
    leitura.diferenca != null &&
    leitura.regra != null
  ) {
    a.push({
      codigo: "abaixo_da_regra_de_tres",
      gravidade: "info",
      frase: `O balcão está ${reais(Math.abs(leitura.diferenca))} abaixo da regra de três, que vale ${reais(leitura.regra)}. A regra é só referência e não manda subir o preço.`,
    });
  }
  if (r?.tempo_presumido) {
    a.push({
      codigo: "tempo_presumido",
      gravidade: "info",
      frase: "O tempo de produção é presumido e não medido na máquina.",
    });
  }
  if (
    r?.velocidade_usada_m2_h != null &&
    r.velocidade_nominal_m2_h != null &&
    r.velocidade_usada_m2_h > 0 &&
    r.velocidade_usada_m2_h < r.velocidade_nominal_m2_h
  ) {
    a.push({
      codigo: "velocidade_com_margem",
      gravidade: "info",
      frase: fraseDaVelocidade(r.velocidade_nominal_m2_h, r.velocidade_usada_m2_h),
    });
  }
  const ehLona = /lona/i.test(l.nome) || /lona/i.test(l.familia ?? "");
  if (
    ehLona &&
    l.unidade.toLowerCase().startsWith("m") &&
    leitura.regra != null &&
    leitura.regra > MERCADO_LOCAL_DA_LONA
  ) {
    a.push({
      codigo: "mercado_local_da_lona",
      gravidade: "info",
      frase: `O mercado local vende lona a ${reais(MERCADO_LOCAL_DA_LONA)} por metro quadrado. A regra de três de ${reais(leitura.regra)} não se vende neste produto.`,
    });
  }
  return a.sort((x, y) => ORDEM_DA_GRAVIDADE[x.gravidade] - ORDEM_DA_GRAVIDADE[y.gravidade]);
}

// ---------------------------------------------------------------------------------------------------------------
// Mapa: margem líquida contra vezes o custo

export type CelulaDoMapa = { margem: 0 | 1 | 2; vezes: 0 | 1 | 2 };

export const ROTULO_DA_LINHA_DO_MAPA = ["Abaixo do mínimo", "Margem justa", "Margem boa"] as const;
export const ROTULO_DA_COLUNA_DO_MAPA = [
  "Menos de 2 vezes o custo",
  "De 2 a menos de 3 vezes",
  "3 vezes o custo ou mais",
] as const;

export function colunaDoMapa(vezes: number): 0 | 1 | 2 {
  if (vezes < 2) return 0;
  if (vezes < 3) return 1;
  return 2;
}

/** Célula do produto, ou nulo quando falta custo real, preço ou margem mínima para medir. */
export function celulaDoMapa(
  l: { real?: CustoRealDoProduto | null; margem_minima: number | null },
  preco: number | null,
): CelulaDoMapa | null {
  const leitura = leituraReal(l, preco);
  if (leitura.vezes == null || leitura.margem == null) return null;
  const f = leitura.faixaDaMargem;
  if (f === "sem_dado") return null;
  return { margem: f === "abaixo" ? 0 : f === "perto" ? 1 : 2, vezes: colunaDoMapa(leitura.vezes) };
}

export function mesmaCelula(a: CelulaDoMapa | null, b: CelulaDoMapa | null): boolean {
  return a != null && b != null && a.margem === b.margem && a.vezes === b.vezes;
}

export type Mapa = {
  /** Contagem por linha de margem e coluna de vezes. */
  celulas: number[][];
  /** Produtos que não entram na grade por falta de custo real, preço ou margem mínima. */
  semDados: number;
  total: number;
};

export function mapaDeMargem(
  linhas: Array<{
    real?: CustoRealDoProduto | null;
    margem_minima: number | null;
    preco: number | null;
  }>,
): Mapa {
  const celulas = [0, 1, 2].map(() => [0, 0, 0]);
  let semDados = 0;
  for (const l of linhas) {
    const c = celulaDoMapa(l, l.preco);
    if (c) celulas[c.margem][c.vezes] += 1;
    else semDados += 1;
  }
  return { celulas, semDados, total: linhas.length };
}

/** Frase para leitor de tela e para quem prefere texto à grade. */
export function resumoDoMapa(m: Mapa): string {
  const meta = m.celulas[2][2];
  const abaixo = m.celulas[0].reduce((s, n) => s + n, 0);
  const p = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const partes = [
    `${p(m.total, "produto", "produtos")} no mapa`,
    `${p(meta, "produto está", "produtos estão")} na meta, com margem boa e 3 vezes o custo ou mais`,
    `${p(abaixo, "produto está", "produtos estão")} abaixo do mínimo de margem`,
  ];
  if (m.semDados > 0)
    partes.push(
      `${p(m.semDados, "produto fica", "produtos ficam")} de fora por falta de custo real`,
    );
  return `${partes.join(". ")}.`;
}
