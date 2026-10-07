/**
 * Desconto do orçamento: o que se digita, a conta em centavos e o que o banco
 * respondeu sobre ele.
 *
 * Domínio puro (sem banco, sem rede). A REGRA mora no banco — o gatilho de
 * totais de `orcamentos` é a guarda e `desconto_do_orcamento` diz de quem é a
 * decisão. Aqui fica só o espelho do que a tela precisa ANTES de perguntar:
 *
 *   - a conta do valor, igual a `desconto_em_reais` (migração
 *     20261006230000): percentual sobre o subtotal, arredondado no centavo
 *     com meio-para-longe-do-zero, nunca acima do que sobra depois do crédito
 *     do parceiro;
 *   - as mesmas frases de `desconto_erro_de_entrada`, para a tela avisar
 *     enquanto a pessoa digita.
 *
 * Tudo em centavos INTEIROS: a conta em ponto flutuante cai em ...,4999 onde o
 * Postgres vê ...,5 exato (é o defeito das parcelas, ver `valoresDasParcelas`).
 */

export type ModoDoDesconto = "valor" | "percentual";

/**
 * De quem é a decisão sobre o desconto.
 *   sem_desconto   nada a decidir
 *   vendedor       dentro da alçada de quem vende
 *   gerente        passa da alçada: só quem tem `desconto.approve`
 *   abaixo_do_piso o lucro some; só aparece para quem vê o financeiro (para os
 *                  outros o banco devolve "gerente" — piso é custo disfarçado)
 */
export type AlcadaDoDesconto = "sem_desconto" | "vendedor" | "gerente" | "abaixo_do_piso";

/** margem: mínimo e piso a partir do custo · limite_fixo: 10% (algum item sem custo) */
export type RegraDoDesconto = "margem" | "limite_fixo";

export type AprovacaoDoDesconto = {
  por: string;
  nome: string | null;
  em: string;
  subtotal: number;
  valor: number;
};

/** O que `desconto_do_orcamento` devolve. Os campos de custo só vêm para quem vê o financeiro. */
export type SituacaoDoDesconto = {
  orcamento_id: string;
  simulado: boolean;
  erro: string | null;
  modo: ModoDoDesconto;
  informado: number;
  subtotal: number;
  credito_parceiro: number;
  desconto: number;
  desconto_pct: number;
  total: number;
  fechado: boolean;
  regra: RegraDoDesconto;
  alcada: AlcadaDoDesconto;
  limite_fixo_pct: number;
  itens_sem_custo: number;
  margem_impossivel: boolean;
  aprovacao: AprovacaoDoDesconto | null;
  aprovacao_valida: boolean;
  pendente: boolean;
  pode_aprovar: boolean;
  pode_editar: boolean;
  pode_aplicar: boolean;
  /** Para todos no limite fixo; na regra da margem, só para quem vê o financeiro. */
  desconto_max_vendedor?: number | null;
  custo?: number | null;
  minimo?: number | null;
  piso?: number | null;
  desconto_ate_piso?: number | null;
  itens_so_material?: number;
  taxa?: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOuNulo = (v: unknown) =>
  v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

const ALCADAS: AlcadaDoDesconto[] = ["sem_desconto", "vendedor", "gerente", "abaixo_do_piso"];

/** Lê a resposta da função do banco sem confiar no formato: número vira número, o que falta vira zero/nulo. */
export function lerSituacao(cru: unknown): SituacaoDoDesconto {
  const s = (cru && typeof cru === "object" ? cru : {}) as Record<string, unknown>;
  const aprov =
    s.aprovacao && typeof s.aprovacao === "object"
      ? (s.aprovacao as Record<string, unknown>)
      : null;
  const alcada = ALCADAS.includes(s.alcada as AlcadaDoDesconto)
    ? (s.alcada as AlcadaDoDesconto)
    : "sem_desconto";
  return {
    orcamento_id: String(s.orcamento_id ?? ""),
    simulado: s.simulado === true,
    erro: typeof s.erro === "string" && s.erro ? s.erro : null,
    modo: s.modo === "percentual" ? "percentual" : "valor",
    informado: num(s.informado),
    subtotal: num(s.subtotal),
    credito_parceiro: num(s.credito_parceiro),
    desconto: num(s.desconto),
    desconto_pct: num(s.desconto_pct),
    total: num(s.total),
    fechado: s.fechado === true,
    regra: s.regra === "limite_fixo" ? "limite_fixo" : "margem",
    alcada,
    limite_fixo_pct: num(s.limite_fixo_pct ?? 10),
    itens_sem_custo: num(s.itens_sem_custo),
    margem_impossivel: s.margem_impossivel === true,
    aprovacao: aprov
      ? {
          por: String(aprov.por ?? ""),
          nome: typeof aprov.nome === "string" ? aprov.nome : null,
          em: String(aprov.em ?? ""),
          subtotal: num(aprov.subtotal),
          valor: num(aprov.valor),
        }
      : null,
    aprovacao_valida: s.aprovacao_valida === true,
    pendente: s.pendente === true,
    pode_aprovar: s.pode_aprovar === true,
    pode_editar: s.pode_editar === true,
    pode_aplicar: s.pode_aplicar === true,
    desconto_max_vendedor:
      "desconto_max_vendedor" in s ? numOuNulo(s.desconto_max_vendedor) : undefined,
    custo: "custo" in s ? numOuNulo(s.custo) : undefined,
    minimo: "minimo" in s ? numOuNulo(s.minimo) : undefined,
    piso: "piso" in s ? numOuNulo(s.piso) : undefined,
    desconto_ate_piso: "desconto_ate_piso" in s ? numOuNulo(s.desconto_ate_piso) : undefined,
    itens_so_material: "itens_so_material" in s ? num(s.itens_so_material) : undefined,
    taxa: "taxa" in s ? num(s.taxa) : undefined,
  };
}

/* ------------------------------------------------------------------------- */
/* O que se digita                                                            */
/* ------------------------------------------------------------------------- */

/**
 * O número digitado em CENTÉSIMOS inteiros (R$ 10,50 → 1050; 7,5% → 750), ou
 * null quando não é número. Vazio é zero.
 *
 * Aceita o jeito brasileiro ("1.234,56", "10,5") e o ponto decimal ("10.5").
 * Ponto seguido de exatamente três dígitos, sem vírgula, é milhar ("1.500" →
 * 1500): é como se escreve dinheiro aqui. A terceira casa arredonda como o
 * numeric(12,2) do banco: meio para longe do zero ("1,005" → 1,01).
 */
export function centesimosDigitados(texto: string): number | null {
  let t = String(texto ?? "")
    .replace(/R\$|%/g, "")
    .replace(/\s/g, "");
  if (t === "") return 0;
  const negativo = t.startsWith("-");
  if (negativo) t = t.slice(1);
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const inteiro = Number(m[1] || "0");
  const fracao = (m[2] ?? "").padEnd(3, "0");
  let centesimos = inteiro * 100 + Number(fracao.slice(0, 2));
  if (Number(fracao[2]) >= 5) centesimos += 1;
  if (!Number.isSafeInteger(centesimos)) return null;
  return negativo ? -centesimos : centesimos;
}

/** Centésimos de volta para o campo: 1050 → "10,5"; 1000 → "10". */
export function textoDoInformado(centesimos: number): string {
  const v = centesimos / 100;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });
}

/** Reais com duas casas para centavos inteiros, sem resto de ponto flutuante. */
export const emCentavos = (reais: number | string | null | undefined) =>
  Math.round(num(reais) * 100);

/* ------------------------------------------------------------------------- */
/* A conta (espelho de desconto_em_reais e desconto_erro_de_entrada)          */
/* ------------------------------------------------------------------------- */

/**
 * O desconto em centavos. Percentual incide sobre o subtotal; o resultado
 * nunca passa do que sobra depois do crédito do parceiro.
 *
 * `round(subtotal × pct ÷ 100, 2)` do banco em inteiros: subtotal em centavos
 * × pct em centésimos ÷ 10.000. O produto é inteiro exato e o meio (,5) é
 * representável, então `Math.round` — que para positivo arredonda o meio para
 * cima — dá o mesmo centavo que o Postgres.
 */
export function descontoEmCentavos(
  subtotalCentavos: number,
  creditoCentavos: number,
  modo: ModoDoDesconto,
  informadoCentesimos: number,
): number {
  const sub = Math.max(0, Math.round(subtotalCentavos));
  const base = Math.max(0, sub - Math.max(0, Math.round(creditoCentavos)));
  const bruto =
    modo === "percentual"
      ? Math.round((sub * Math.round(informadoCentesimos)) / 10_000)
      : Math.round(informadoCentesimos);
  return Math.min(Math.max(bruto, 0), base);
}

/**
 * O que está errado no que foi digitado — as MESMAS frases de
 * `desconto_erro_de_entrada` no banco (um teste confere uma contra a outra).
 */
export function erroDoDesconto(
  subtotalCentavos: number,
  creditoCentavos: number,
  modo: ModoDoDesconto,
  informadoCentesimos: number | null,
): string | null {
  if (informadoCentesimos == null) return "Digite só o número do desconto.";
  if (informadoCentesimos < 0) return "O desconto não pode ser negativo.";
  if (informadoCentesimos === 0) return null;
  if (subtotalCentavos <= 0)
    return "Adicione os itens antes do desconto: sem subtotal não há do que descontar.";
  if (modo === "percentual" && informadoCentesimos > 10_000) return "O desconto não passa de 100%.";
  const base = Math.max(0, subtotalCentavos - Math.max(0, creditoCentavos));
  if (modo === "valor" && informadoCentesimos > base) {
    return `O desconto de R$ ${reaisSemMilhar(informadoCentesimos)} passa do valor do orçamento (R$ ${reaisSemMilhar(base)}).`;
  }
  return null;
}

/** "800,00" — como o to_char('FM999999990.00') do banco, com vírgula. */
function reaisSemMilhar(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

export type PreviaDoDesconto = {
  erro: string | null;
  descontoCentavos: number;
  totalCentavos: number;
  /** % do desconto sobre o subtotal, com duas casas */
  pct: number;
};

/** O total que o cliente pagaria com o que está digitado agora. */
export function previaDoDesconto(
  subtotalCentavos: number,
  creditoCentavos: number,
  modo: ModoDoDesconto,
  informadoCentesimos: number | null,
): PreviaDoDesconto {
  const erro = erroDoDesconto(subtotalCentavos, creditoCentavos, modo, informadoCentesimos);
  const desconto = erro
    ? 0
    : descontoEmCentavos(subtotalCentavos, creditoCentavos, modo, informadoCentesimos ?? 0);
  const total = Math.max(0, subtotalCentavos - desconto - Math.max(0, creditoCentavos));
  return {
    erro,
    descontoCentavos: desconto,
    totalCentavos: total,
    pct: subtotalCentavos > 0 ? Math.round((desconto / subtotalCentavos) * 10_000) / 100 : 0,
  };
}

/* ------------------------------------------------------------------------- */
/* Como a tela fala                                                           */
/* ------------------------------------------------------------------------- */

/** "10%" / "7,5%" */
export function pctBR(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** A frase de uma linha sobre de quem é a decisão, para quem está olhando. */
export function fraseDaAlcada(
  s: Pick<SituacaoDoDesconto, "alcada" | "regra" | "pode_aprovar">,
): string {
  switch (s.alcada) {
    case "sem_desconto":
      return "Sem desconto.";
    case "vendedor":
      return s.regra === "limite_fixo"
        ? "Dentro da alçada de quem vende (até 10%)."
        : "Dentro da alçada de quem vende.";
    case "gerente":
      return s.pode_aprovar
        ? "Passa da alçada de quem vende: você aprova ao aplicar."
        : "Passa da sua alçada: precisa de quem aprova desconto.";
    case "abaixo_do_piso":
      return "Abaixo do piso: com esse desconto o lucro some.";
  }
}
