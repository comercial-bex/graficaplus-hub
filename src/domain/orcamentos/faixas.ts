/**
 * Preço por faixa de quantidade ("de 50 peças pra cima sai por R$ 12").
 *
 * A tabela `produto_faixas_preco` guarda uma linha por degrau, com a
 * quantidade mínima que ativa aquele preço. Aqui só escolhemos o degrau certo
 * e apontamos o próximo — o número gravado no item continua saindo do trigger
 * do banco; a tela apenas sugere.
 */

export type FaixaPreco = {
  id: string;
  quantidade_minima: number;
  preco_unitario: number;
  preco_m2_referencia?: number | null;
  observacao?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
};

const emVigencia = (faixa: FaixaPreco, referencia: Date) => {
  const dia = referencia.toISOString().slice(0, 10);
  if (faixa.vigencia_inicio && faixa.vigencia_inicio > dia) return false;
  if (faixa.vigencia_fim && faixa.vigencia_fim < dia) return false;
  return true;
};

/** Faixas válidas hoje, ordenadas da menor para a maior quantidade. */
export function faixasVigentes(faixas: FaixaPreco[], referencia = new Date()): FaixaPreco[] {
  return faixas
    .filter((f) => emVigencia(f, referencia))
    .slice()
    .sort((a, b) => a.quantidade_minima - b.quantidade_minima);
}

/** Faixa aplicada a uma quantidade: a maior cujo mínimo já foi atingido. */
export function faixaAplicada(
  faixas: FaixaPreco[],
  quantidade: number,
  referencia = new Date(),
): FaixaPreco | null {
  const vigentes = faixasVigentes(faixas, referencia);
  let escolhida: FaixaPreco | null = null;
  for (const faixa of vigentes) {
    if (quantidade >= faixa.quantidade_minima) escolhida = faixa;
  }
  return escolhida;
}

/** Próximo degrau — o argumento de venda ("a partir de 100 un cai para…"). */
export function proximaFaixa(
  faixas: FaixaPreco[],
  quantidade: number,
  referencia = new Date(),
): FaixaPreco | null {
  const atual = faixaAplicada(faixas, quantidade, referencia);
  return (
    faixasVigentes(faixas, referencia).find(
      (f) =>
        f.quantidade_minima > quantidade &&
        (!atual || f.preco_unitario < atual.preco_unitario),
    ) ?? null
  );
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "A partir de 100 un: R$ 10,50" — texto pronto para a tela. */
export function descreverFaixa(faixa: FaixaPreco, unidade = "un"): string {
  return `A partir de ${faixa.quantidade_minima} ${unidade}: ${brl(faixa.preco_unitario)}`;
}
