/**
 * Os custos fixos da gráfica que entram no custo real do produto. Funções puras, sem banco e sem tela.
 *
 * Cada um é uma linha de custos_tabela, inclusive a ocupação alvo e o multiplicador da regra de três, que mexem no preço mínimo recomendado. Linha nova nasce com valor vazio e sem confirmação: a casa não inventa número.
 * Pendente quer dizer valor vazio ou ainda sem confirmação de alguém. Enquanto houver pendente, o custo real é um piso
 * otimista e a tela de preços avisa.
 *
 * Quem grava: quem tem custos.fixos.update (admin, gestor e financeiro, pela migração 20261116120000). É a mesma
 * permissão que a função confirmar_custo_fixo exige no banco; custos.update sozinho não basta e não aparece botão.
 */

export type GrupoDeCustoFixo = "espaco_e_energia" | "plotter" | "preco_minimo" | "pessoal";

export const ROTULO_DO_GRUPO: Record<GrupoDeCustoFixo, string> = {
  espaco_e_energia: "Espaço e energia",
  plotter: "Plotter",
  preco_minimo: "Ocupação e preço mínimo",
  pessoal: "Pessoal",
};

export const ORDEM_DOS_GRUPOS: GrupoDeCustoFixo[] = [
  "espaco_e_energia",
  "plotter",
  "preco_minimo",
  "pessoal",
];

export type DefinicaoDeCustoFixo = {
  codigo: string;
  rotulo: string;
  unidade: string;
  grupo: GrupoDeCustoFixo;
  /** De onde vem o número, quando o banco não traz observação. */
  fonte: string;
  /** Aceita zero como resposta confirmada, por exemplo "não há outros fixos". */
  aceitaZero: boolean;
  /** Só aparece, não se grava por esta tela. */
  somenteLeitura?: boolean;
  /** Faixa aceita na tela, antes de ir ao banco. O banco confere de novo. */
  faixa?: { minimo: number; maximo: number; frase: string };
};

export const CUSTOS_FIXOS: readonly DefinicaoDeCustoFixo[] = [
  {
    codigo: "aluguel_espaco_mensal",
    rotulo: "Aluguel do espaço",
    unidade: "R$/mês",
    grupo: "espaco_e_energia",
    fonte:
      "Valor do dono. Entra dentro do rateio por hora e nunca por cima. O pagamento do aluguel continua em compromissos, que é caixa.",
    aceitaZero: false,
  },
  {
    codigo: "outros_fixos_admin_mes",
    rotulo: "Outros fixos da administração",
    unidade: "R$/mês",
    grupo: "espaco_e_energia",
    fonte: "Internet, software e outras contas fixas do mês. Some o que a casa paga todo mês.",
    aceitaZero: true,
  },
  {
    codigo: "energia_comercial_tarifa_kwh",
    rotulo: "Energia comercial",
    unidade: "R$/kWh",
    grupo: "espaco_e_energia",
    fonte: "Tarifa comercial da fatura da distribuidora. Hoje o custo usa a tarifa de energia da casa, então preencher este valor ainda não muda o custo real nem o preço.",
    aceitaZero: false,
  },
  {
    codigo: "plotter_horas_mes_reais",
    rotulo: "Horas reais da plotter por mês",
    unidade: "h/mês",
    grupo: "plotter",
    fonte: "Horas por mês em que a plotter está disponível para produzir, com feriados e faltas descontados. Não desconte o tempo parado por falta de pedido, porque a ocupação alvo já cobre isso. Vazio usa as horas produtivas cadastradas na máquina.",
    aceitaZero: false,
  },
  {
    codigo: "tinta_consumo_ml_m2",
    rotulo: "Consumo médio de tinta",
    unidade: "ml/m²",
    grupo: "plotter",
    fonte: "Média medida em impressões reais, em mililitros por metro quadrado.",
    aceitaZero: false,
  },
  {
    codigo: "plotter_manutencao_mensal",
    rotulo: "Manutenção da plotter",
    unidade: "R$/mês",
    grupo: "plotter",
    fonte: "Gasto médio por mês com revisão e peças da plotter.",
    aceitaZero: false,
  },
  {
    codigo: "plotter_cabecote_custo",
    rotulo: "Custo do cabeçote",
    unidade: "R$",
    grupo: "plotter",
    fonte: "Preço de um cabeçote novo da plotter.",
    aceitaZero: false,
  },
  {
    codigo: "plotter_cabecote_vida_m2",
    rotulo: "Vida do cabeçote",
    unidade: "m²",
    grupo: "plotter",
    fonte: "Quantos metros quadrados um cabeçote imprime antes de trocar.",
    aceitaZero: false,
  },
  {
    codigo: "plotter_limpeza_mensal",
    rotulo: "Limpeza da plotter",
    unidade: "R$/mês",
    grupo: "plotter",
    fonte: "Gasto médio por mês com líquido e material de limpeza.",
    aceitaZero: false,
  },
  {
    codigo: "ocupacao_alvo_pct",
    rotulo: "Ocupação alvo",
    unidade: "%",
    grupo: "preco_minimo",
    fonte:
      "Parte das horas pagas em que a plotter, o impressor e o aluguel realmente trabalham. O ponto de partida é 50 por cento. O custo da conversão por metro quadrado é dividido por ela. Energia e perdas não são divididas. Os extras da plotter, manutenção, limpeza e cabeçote, também não.",
    aceitaZero: false,
    faixa: { minimo: 5, maximo: 100, frase: "Digite a ocupação de 5 a 100 por cento, por exemplo 50." },
  },
  {
    codigo: "multiplicador_regra_de_tres",
    rotulo: "Multiplicador da regra de três",
    unidade: "vezes",
    grupo: "preco_minimo",
    fonte:
      "Quantas vezes o material com perda e falha entra no preço mínimo recomendado. O preço mínimo é o maior entre este multiplicador vezes o material e o piso do custo de produção.",
    aceitaZero: false,
    faixa: { minimo: 1, maximo: 10, frase: "Digite um multiplicador de 1 a 10, por exemplo 3." },
  },
  {
    codigo: "mo_custo_hora",
    rotulo: "Mão de obra por hora, sem encargos",
    unidade: "R$/h",
    grupo: "pessoal",
    fonte: "Salário mínimo de 2026 dividido por 176 horas. Este número não muda o custo real dos produtos. Ele alimenta o simulador de precificação, o custo da peça e a calculadora 3D. Para mudar o custo real dos produtos, edite a função na lista de funções da mão de obra desta página. O custo real usa a função do mesmo setor da máquina padrão e, entre as do setor, a de maior valor por hora sem encargos.",
    aceitaZero: false,
    somenteLeitura: true,
  },
  {
    codigo: "mo_encargos_pct",
    rotulo: "Encargos sobre a mão de obra",
    unidade: "%",
    grupo: "pessoal",
    fonte:
      "Encargos estimados do Simples Nacional. Confirme com o contador. Este número alimenta o simulador de precificação, o custo da peça e a calculadora 3D. O custo real dos produtos usa o encargo de cada função: para mudar, edite a função na lista de funções da mão de obra desta página.",
    aceitaZero: false,
    somenteLeitura: true,
  },
];

export const CODIGOS_DE_CUSTO_FIXO: readonly string[] = CUSTOS_FIXOS.filter(
  (c) => !c.somenteLeitura,
).map((c) => c.codigo);
/** Todos os códigos que a tela lê, inclusive os de pessoal. */
export const CODIGOS_LIDOS: readonly string[] = CUSTOS_FIXOS.map((c) => c.codigo);

/** Uma linha de custos_tabela com as colunas de confirmação. */
export type LinhaDeCustoFixo = {
  id: string;
  codigo: string;
  valor: number | null;
  unidade: string | null;
  observacao: string | null;
  confirmado_em: string | null;
  confirmado_por: string | null;
};

const numero = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function lerLinhaDeCustoFixo(r: Record<string, unknown>): LinhaDeCustoFixo {
  return {
    id: String(r.id ?? ""),
    codigo: String(r.codigo ?? ""),
    valor: numero(r.valor),
    unidade: (r.unidade as string | null) ?? null,
    observacao: (r.observacao as string | null) ?? null,
    confirmado_em: (r.confirmado_em as string | null) ?? null,
    confirmado_por: (r.confirmado_por as string | null) ?? null,
  };
}

/** Pendente é valor vazio OU sem confirmação. Linha que não existe no banco também é pendente. */
export function estaPendente(
  l: Pick<LinhaDeCustoFixo, "valor" | "confirmado_em"> | null | undefined,
): boolean {
  return l == null || l.valor == null || l.confirmado_em == null;
}

export type ItemDeCustoFixo = {
  definicao: DefinicaoDeCustoFixo;
  linha: LinhaDeCustoFixo | null;
  pendente: boolean;
};

export function itensDeCustoFixo(linhas: LinhaDeCustoFixo[]): ItemDeCustoFixo[] {
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  return CUSTOS_FIXOS.map((definicao) => {
    const linha = porCodigo.get(definicao.codigo) ?? null;
    return { definicao, linha, pendente: estaPendente(linha) };
  });
}

export function agruparPorGrupo(
  itens: ItemDeCustoFixo[],
): Array<{ grupo: GrupoDeCustoFixo; itens: ItemDeCustoFixo[] }> {
  return ORDEM_DOS_GRUPOS.map((grupo) => ({
    grupo,
    itens: itens.filter((i) => i.definicao.grupo === grupo),
  }));
}

/** Conta só o que se grava por esta tela. Os de pessoal são leitura e não entram no contador. */
export function contagemDePendentes(itens: ItemDeCustoFixo[]): {
  pendentes: number;
  total: number;
} {
  const dos = itens.filter((i) => !i.definicao.somenteLeitura);
  return { pendentes: dos.filter((i) => i.pendente).length, total: dos.length };
}

export function fraseDoContador(c: { pendentes: number; total: number }): string {
  if (c.pendentes === 0) return `Os ${c.total} custos fixos estão confirmados.`;
  return `${c.pendentes} de ${c.total} pendentes.`;
}

/** Aceita 2000, 2.000, 2.000,50 e 1,1339. Devolve nulo para vazio, negativo ou sem sentido. */
export function lerValorDeCusto(texto: string, aceitaZero: boolean): number | null {
  const t = texto
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (t === "") return null;
  let normal: string;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  if (!/^\d+(\.\d{1,4})?$/.test(normal)) return null;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return n > 0 || (aceitaZero && n === 0) ? n : null;
}

/** Frase de erro quando o número digitado está fora da faixa do custo, ou nulo quando serve. */
export function fraseDaFaixaDoCusto(d: DefinicaoDeCustoFixo, valor: number | null): string | null {
  if (valor == null || d.faixa == null) return null;
  return valor < d.faixa.minimo || valor > d.faixa.maximo ? d.faixa.frase : null;
}

export function formatarCustoFixo(valor: number | null, unidade: string): string {
  if (valor == null) return "Sem valor";
  if (unidade.startsWith("R$")) {
    const casas = unidade === "R$/kWh" ? 4 : 2;
    const n = valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
    return `${n}${unidade.slice(2)}`
      .replace(/\u00a0/g, " ")
      .replace("/mês", " por mês")
      .replace("/kWh", " por quilowatt hora")
      .replace("/h", " por hora");
  }
  const n = valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  if (unidade === "%") return `${n} por cento`;
  if (unidade === "h/mês") return `${n} horas por mês`;
  if (unidade === "ml/m²") return `${n} mililitros por metro quadrado`;
  if (unidade === "m²") return `${n} metros quadrados`;
  return `${n} ${unidade}`.trim();
}

const dataBr = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Belem",
  });
};

/** Linha de quem confirmou, em palavras. Vazia quando não há confirmação. */
export function fraseDaConfirmacao(
  l: Pick<LinhaDeCustoFixo, "valor" | "confirmado_em" | "confirmado_por"> | null,
  nomes: Record<string, string>,
): string {
  if (l == null || l.valor == null) return "Sem valor. Falta preencher.";
  if (l.confirmado_em == null) return "Valor provisório. Falta confirmar.";
  const quem = l.confirmado_por ? nomes[l.confirmado_por] : null;
  const quando = dataBr(l.confirmado_em);
  if (quem) return `Confirmado por ${quem} em ${quando}.`;
  return quando ? `Confirmado em ${quando}.` : "Confirmado.";
}

export function podeEditarCustosFixos(a: { ehAdmin: boolean; permissoes: string[] }): boolean {
  return a.ehAdmin || a.permissoes.includes("custos.fixos.update");
}

/** Mão de obra por hora com encargos, em reais, para a frase da tela. Nulo se faltar um dos dois. */
export function maoDeObraPorHora(base: number | null, encargosPct: number | null): number | null {
  if (base == null || encargosPct == null) return null;
  return Math.round(base * (1 + encargosPct / 100) * 100) / 100;
}

/** Quando o banco ainda não tem a função ou as colunas, a mensagem é humana e não um código. */
export function mensagemDoSalvarCusto(mensagem: string): string {
  const m = mensagem.toLowerCase();
  const ausente =
    (m.includes("confirmar_custo_fixo") &&
      (m.includes("does not exist") ||
        m.includes("could not find") ||
        m.includes("schema cache") ||
        m.includes("pgrst202") ||
        m.includes("42883"))) ||
    m.includes("confirmado_em") ||
    m.includes("confirmado_por") ||
    m.includes("42703");
  return ausente
    ? "A confirmação de custos ainda não está ligada no banco. Avise o suporte e tente mais tarde."
    : mensagem;
}

/**
 * Há custo fixo legível para mostrar? A RLS de custos_tabela devolve zero linha a quem não vê custo, sem erro.
 * Mostrar o bloco assim diria "9 de 9 pendentes" a quem só não tem acesso: falha que se lê como vazio.
 */
export function haCustoFixoParaMostrar(linhas: LinhaDeCustoFixo[]): boolean {
  return linhas.length > 0;
}
