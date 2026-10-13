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
export function fecharPreco(operacional: Decimal, markup: number, quantidade: number) {
  const qtd = quantidade > 0 ? quantidade : 1;
  const unitario = operacional.mul(markup).div(qtd).round(2);
  const preco = unitario.mul(qtd);
  const lucro = preco.sub(operacional);
  const margem = preco.gt(0) ? lucro.div(preco) : D(0);
  return { preco, unitario, lucro, margem };
}
