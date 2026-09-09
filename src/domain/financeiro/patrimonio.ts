/**
 * Patrimônio em máquinas: o que é da casa, o que ela deve, e o que é alugado.
 *
 * A distinção que faz esta conta existir:
 *
 *   LOCADA       o bem é do locador. A casa paga e devolve no fim. NÃO é
 *                patrimônio — somar as parcelas pagas como se fossem ativo
 *                infla o balanço com uma coisa que vai embora. Mas continua
 *                sendo compromisso a pagar, e por isso aparece à parte.
 *
 *   FINANCIADA   o bem é da casa desde a entrega, com dívida em cima (e, no
 *                caso do CNC, alienado em garantia fiduciária). Entra no
 *                patrimônio pelo valor, e a dívida entra no passivo.
 *
 *   QUITADA      bem da casa, sem dívida.
 *
 * Patrimônio líquido é a diferença entre os dois primeiros. O aluguel não entra
 * em nenhum dos lados dessa subtração — ele é despesa, e misturar aluguel com
 * financiamento é o erro que faz a casa achar que tem um ativo que não tem.
 */

export type MaquinaPatrimonio = {
  id: string;
  nome: string;
  forma_aquisicao: "quitada" | "financiada" | "locada" | "comodato";
  valor_aquisicao: number | null;
  patrimonio: number;
  divida: number;
  ativa: boolean;
  compromisso_id: string | null;
  pendencia_patrimonio: string | null;
  pendencia_divida: string | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type ResumoPatrimonio = {
  /** valor dos bens que são da casa */
  patrimonioBruto: number;
  /** dívida em cima desses bens */
  dividaSobreBens: number;
  /** bruto − dívida */
  patrimonioLiquido: number;
  /** o que ainda falta pagar de locação: compromisso, não dívida sobre bem */
  compromissoLocacao: number;
  /** total a desembolsar, some ele sobre bem próprio ou sobre alugado */
  totalAPagar: number;
  quitadas: number;
  financiadas: number;
  locadas: number;
  /** máquinas cujo valor ou contrato falta — o número está incompleto por isso */
  incompletas: MaquinaPatrimonio[];
};

export function resumoPatrimonio(maquinas: MaquinaPatrimonio[]): ResumoPatrimonio {
  const ativas = maquinas.filter((m) => m.ativa);
  const proprias = ativas.filter((m) => m.forma_aquisicao !== "locada");
  const locadas = ativas.filter((m) => m.forma_aquisicao === "locada");

  const patrimonioBruto = proprias.reduce((s, m) => s + num(m.patrimonio), 0);
  const dividaSobreBens = proprias.reduce((s, m) => s + num(m.divida), 0);
  const compromissoLocacao = locadas.reduce((s, m) => s + num(m.divida), 0);

  return {
    patrimonioBruto,
    dividaSobreBens,
    patrimonioLiquido: patrimonioBruto - dividaSobreBens,
    compromissoLocacao,
    totalAPagar: dividaSobreBens + compromissoLocacao,
    quitadas: ativas.filter((m) => m.forma_aquisicao === "quitada").length,
    financiadas: ativas.filter((m) => m.forma_aquisicao === "financiada").length,
    locadas: locadas.length,
    // Uma máquina financiada sem contrato cadastrado esconde dívida; uma sem
    // valor esconde patrimônio. Nos dois casos o total está errado para menos,
    // e é isso que a tela precisa dizer em vez de exibir um número redondo.
    incompletas: ativas.filter((m) => m.pendencia_patrimonio || m.pendencia_divida),
  };
}

/**
 * Quanto do bem já foi pago, de 0 a 1.
 *
 * Sobre o VALOR DO BEM, não sobre o total do financiamento: os juros não viram
 * patrimônio. Máquina quitada é 1; locada não tem — não se compra o que se
 * aluga.
 */
export function pagoDoBem(m: MaquinaPatrimonio): number | null {
  if (m.forma_aquisicao === "locada") return null;
  const valor = num(m.patrimonio);
  if (valor <= 0) return null;
  const pago = valor - num(m.divida);
  return Math.min(1, Math.max(0, pago / valor));
}
