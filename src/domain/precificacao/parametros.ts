/**
 * Os parâmetros da casa (`custos_tabela`) do jeito que o simulador de preço usa.
 *
 * São os dez números que o admin edita em Custos de mão de obra → Parâmetros
 * da casa, e que o simulador ignorava até 02/10/2026: ele nascia com 45, 8,
 * 25, 35, 12, 5 e margem 50 escritos no código, sem ligação nenhuma com a Meta
 * do mês nem com o custo cheio do produto. Cada um contava uma história.
 *
 * Duas regras deste módulo:
 *
 *   - Parâmetro que falta NÃO vira número inventado. Ele entra como zero na
 *     conta — é o que a casa afirma sobre ele: nada — e volta em `faltando`,
 *     para a tela dizer que a conta saiu sem ele. Um 60% de markup "de
 *     reserva" escondido aqui seria o mesmo defeito que este módulo veio tirar.
 *
 *   - O que a pessoa muda na simulação fica na simulação. `alterados` diz o
 *     que está diferente da casa; gravar é outra ação, só do admin, pelo mesmo
 *     caminho da tela de parâmetros (UPDATE em `custos_tabela`, com o
 *     histórico gravado pelo gatilho `custos_tabela_log`).
 */

/** Os códigos que entram na conta, na ordem em que a tela os mostra. */
export const PARAMETROS = [
  { codigo: "markup_padrao", rotulo: "Markup de varejo", unidade: "%" },
  { codigo: "markup_atacado", rotulo: "Markup de atacado", unidade: "%" },
  { codigo: "impostos_venda", rotulo: "Impostos sobre a venda", unidade: "%" },
  { codigo: "taxa_cartao", rotulo: "Taxa do cartão", unidade: "%" },
  { codigo: "mo_custo_hora", rotulo: "Mão de obra por hora", unidade: "R$/h" },
  { codigo: "mo_encargos_pct", rotulo: "Encargos sobre a mão de obra", unidade: "%" },
  { codigo: "custo_admin_hora", rotulo: "Rateio administrativo por hora", unidade: "R$/h" },
  { codigo: "pct_perda_material", rotulo: "Perda de material (refile)", unidade: "%" },
  { codigo: "pct_falha_producao", rotulo: "Falha de produção", unidade: "%" },
  { codigo: "energia_tarifa_kwh", rotulo: "Tarifa de energia", unidade: "R$/kWh" },
] as const;

export type CodigoParametro = (typeof PARAMETROS)[number]["codigo"];

export const CODIGOS: readonly CodigoParametro[] = PARAMETROS.map((p) => p.codigo);

/** Uma linha de `custos_tabela`, como vem do banco. */
export type LinhaDeParametro = {
  id: string;
  codigo: string;
  descricao: string | null;
  unidade: string | null;
  valor: number | string | null;
};

export type ValoresDosParametros = Record<CodigoParametro, number>;

export type LeituraDosParametros = {
  /** Valor da casa por código. Ausente quando a linha não existe ou é ilegível. */
  valores: Partial<Record<CodigoParametro, number>>;
  /** A linha de origem: o `id` é o que se grava; descrição e unidade, o que se mostra. */
  linhas: Partial<Record<CodigoParametro, LinhaDeParametro>>;
  /** Os que o simulador usa e a casa não tem. A conta sai com zero ali. */
  faltando: CodigoParametro[];
};

const ehCodigo = (c: string): c is CodigoParametro => (CODIGOS as readonly string[]).includes(c);

/**
 * Lê as linhas de `custos_tabela` (já filtradas por `ativo`).
 *
 * Valor ilegível conta como faltando, não como zero: zero é uma afirmação
 * ("não há imposto"), ilegível é ausência de informação, e a tela trata as
 * duas de jeitos diferentes.
 */
export function lerParametros(linhas: LinhaDeParametro[]): LeituraDosParametros {
  const valores: Partial<Record<CodigoParametro, number>> = {};
  const porCodigo: Partial<Record<CodigoParametro, LinhaDeParametro>> = {};
  for (const linha of linhas) {
    if (!ehCodigo(linha.codigo)) continue;
    const n = linha.valor === null || linha.valor === "" ? Number.NaN : Number(linha.valor);
    porCodigo[linha.codigo] = linha;
    if (Number.isFinite(n)) valores[linha.codigo] = n;
  }
  return {
    valores,
    linhas: porCodigo,
    faltando: CODIGOS.filter((c) => valores[c] === undefined),
  };
}

/** Completa com zero o que falta — só depois de a tela ter avisado o que falta. */
export function comZeroNoQueFalta(
  valores: Partial<Record<CodigoParametro, number>>,
): ValoresDosParametros {
  return Object.fromEntries(CODIGOS.map((c) => [c, valores[c] ?? 0])) as ValoresDosParametros;
}

/**
 * Os códigos em que a simulação está diferente da casa.
 *
 * Compara em quatro casas decimais: a tarifa de energia tem quatro
 * (R$ 1,1339/kWh), e diferença menor que isso é ruído de digitação, não uma
 * decisão de mudar o parâmetro.
 */
export function alterados(
  casa: Partial<Record<CodigoParametro, number>>,
  simulacao: Partial<Record<CodigoParametro, number>>,
): CodigoParametro[] {
  const q = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10000));
  return CODIGOS.filter((c) => simulacao[c] !== undefined && q(simulacao[c]) !== q(casa[c]));
}

/** Rótulo para a tela: a descrição do banco quando existe, senão o nome daqui. */
export function rotuloDoParametro(
  codigo: CodigoParametro,
  linha?: Pick<LinhaDeParametro, "descricao"> | null,
): string {
  const proprio = PARAMETROS.find((p) => p.codigo === codigo)?.rotulo ?? codigo;
  return linha?.descricao?.trim() || proprio;
}

/** Unidade para a tela: a do banco quando existe, senão a esperada. */
export function unidadeDoParametro(
  codigo: CodigoParametro,
  linha?: Pick<LinhaDeParametro, "unidade"> | null,
): string {
  return linha?.unidade?.trim() || PARAMETROS.find((p) => p.codigo === codigo)?.unidade || "";
}
