import type { ResumoDoOrcamento } from "./preco";

/**
 * Prazo e expresso no pedido do parceiro (fase 2 de docs/plano-orcamento-em-passos.md).
 *
 * O expresso é uma TAXA EM PORCENTAGEM sobre o valor dos produtos, nunca um valor
 * fixo: o mesmo valor em reais pesaria diferente num produto de R$ 50 e num de
 * R$ 100 (decisão do dono, 24/10/2026). A porcentagem mora na tabela
 * `prazos_de_entrega` — hoje 12%, provisória.
 *
 * Quem cobra o número que vale é o BANCO: `parceiro_enviar_pedido` soma uma linha
 * de taxa sobre os produtos já recalculados pela tabela de parceiro. Aqui a tela só
 * ANTECIPA, com o mesmo arredondamento (2 casas), para o "você paga" bater com o
 * pedido que a gráfica recebe.
 *
 * A taxa é o que o parceiro paga À GRÁFICA. O preço de venda ao cliente dele
 * continua sendo dele: a taxa entra no custo e reduz o ganho, não muda a venda.
 */

export type PrazoDeEntrega = {
  chave: string;
  nome: string;
  descricao: string | null;
  taxa_percentual: number;
  ordem: number;
};

export const PRAZO_NORMAL = "normal";

const arred = (valor: number, casas: number) => {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
};

/** Normaliza as linhas de `prazos_de_entrega`: numeric pode chegar como texto. */
export function normalizarPrazos(linhas: unknown[]): PrazoDeEntrega[] {
  return (linhas ?? [])
    .map((bruto) => {
      const l = bruto as Record<string, unknown>;
      return {
        chave: String(l.chave),
        nome: String(l.nome ?? l.chave),
        descricao: (l.descricao as string | null) ?? null,
        taxa_percentual: Number(l.taxa_percentual) || 0,
        ordem: Number(l.ordem) || 0,
      };
    })
    .sort((a, b) => a.ordem - b.ordem);
}

/** A taxa em reais: porcentagem sobre a base, 2 casas, como o banco arredonda. */
export function taxaDoPrazo(base: number, taxaPercentual: number): number {
  const b = Number(base) || 0;
  const p = Number(taxaPercentual) || 0;
  if (b <= 0 || p <= 0) return 0;
  return arred((b * p) / 100, 2);
}

/** "12%", "11,5%", "12,25%". */
export function rotuloDaPorcentagem(taxaPercentual: number): string {
  return `${Number(taxaPercentual).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/** O prazo escolhido, ou o normal quando a chave não está na lista (prazo desativado). */
export function prazoEscolhido(prazos: PrazoDeEntrega[], chave: string): PrazoDeEntrega | null {
  return prazos.find((p) => p.chave === chave) ?? null;
}

/**
 * O resumo com a taxa dentro: o que o parceiro paga sobe, o ganho desce na mesma
 * quantia e a margem é refeita sobre a mesma venda. A venda não muda.
 */
export function aplicarTaxaDePrazo(resumo: ResumoDoOrcamento, taxa: number): ResumoDoOrcamento {
  if (taxa <= 0) return resumo;
  const vendaComCusto = resumo.lucro !== null ? arred(resumo.lucro + resumo.custo, 2) : 0;
  const lucro = resumo.lucro !== null ? arred(resumo.lucro - taxa, 2) : null;
  return {
    ...resumo,
    custo: arred(resumo.custo + taxa, 2),
    lucro,
    margemPct: lucro !== null && vendaComCusto > 0 ? arred((lucro / vendaComCusto) * 100, 1) : null,
  };
}
