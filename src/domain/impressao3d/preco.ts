import { D, type Decimal } from "./decimal";

/**
 * Fecha o preço do lote a partir do UNITÁRIO arredondado.
 *
 * O cliente confere o orçamento multiplicando: "2 × R$ 22,29". Quando o total
 * era arredondado sozinho (R$ 44,5734 → R$ 44,57) e o unitário também
 * (R$ 22,2867 → R$ 22,29), o PDF dizia 2 × 22,29 = 44,57 — um centavo que não
 * fecha na frente do cliente (orçamento 3D de 13/10/2026). Aqui o unitário é
 * arredondado primeiro e o total é ele vezes a quantidade; lucro e margem saem
 * desse total, que é o que vai para o banco, para a OS e para a conta a receber.
 */
/** Pós-processamento e embalagem por peça quando ninguém informa horas (decisão de 30/10/2026). */
export const POS_PROCESSAMENTO_PADRAO_MIN = 2;

/** Preço mínimo de UMA peça, em reais (decisão de 30/10/2026: o chaveiro saía a R$ 1,78). */
export const PRECO_MINIMO_POR_PECA = 5;

/**
 * Horas de mão de obra por peça: as informadas, ou o padrão de 2 minutos quando o campo está em
 * branco ou zero. Sem isto o 3D saía sem nenhuma mão de obra (só material, máquina e energia).
 */
export function horasDeMaoDeObraPorPeca(horasInformadas: number): number {
  return horasInformadas > 0 ? horasInformadas : POS_PROCESSAMENTO_PADRAO_MIN / 60;
}

/**
 * Fecha o preço do lote a partir do UNITÁRIO arredondado, com um piso por peça opcional.
 *
 * O cliente confere o orçamento multiplicando: "2 × R$ 22,29". Quando o total
 * era arredondado sozinho (R$ 44,5734 → R$ 44,57) e o unitário também
 * (R$ 22,2867 → R$ 22,29), o PDF dizia 2 × 22,29 = 44,57 — um centavo que não
 * fecha na frente do cliente (orçamento 3D de 13/10/2026). Aqui o unitário é
 * arredondado primeiro e o total é ele vezes a quantidade; lucro e margem saem
 * desse total, que é o que vai para o banco, para a OS e para a conta a receber.
 *
 * `minimoPorPeca`: se o unitário calculado ficar abaixo dele, vale o mínimo (`peloMinimo` avisa).
 */
export function fecharPreco(
  operacional: Decimal,
  markup: number,
  quantidade: number,
  minimoPorPeca = 0,
) {
  const qtd = quantidade > 0 ? quantidade : 1;
  const calculado = operacional.mul(markup).div(qtd).round(2);
  const peloMinimo = minimoPorPeca > 0 && calculado.lt(minimoPorPeca);
  const unitario = peloMinimo ? D(minimoPorPeca).round(2) : calculado;
  const preco = unitario.mul(qtd);
  const lucro = preco.sub(operacional);
  const margem = preco.gt(0) ? lucro.div(preco) : D(0);
  return { preco, unitario, lucro, margem, peloMinimo };
}
