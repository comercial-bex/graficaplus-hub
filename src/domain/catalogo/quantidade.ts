/**
 * Quantidade mínima, múltiplo e faixa de uma opção de preço do fornecedor.
 *
 * Quem decide é o banco (`catalogo_adicionar_ao_orcamento` recusa 15 peças de
 * um item vendido de 10 em 10). Este arquivo diz a MESMA coisa antes do
 * clique, com as mesmas frases — e diz ao cliente, na vitrine, em português de
 * gente: "Pedido mínimo de 100 peças, de 10 em 10".
 *
 * Domínio puro.
 */

export type RegraDeQuantidade = {
  quantidadeMinima: number | null;
  multiplo: number | null;
  /** "100 a 199 peças": a faixa em que a tabela dá esse preço. */
  faixa: string | null;
  faixaMax: number | null;
};

export type ConferenciaDeQuantidade =
  | { ok: true; aviso: string | null }
  | { ok: false; mensagem: string; sugestao: number | null };

const PECAS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function inteiro(n: number): string {
  return String(Math.trunc(n));
}

/** A menor quantidade que o banco aceita: o mínimo, levado ao múltiplo. */
export function quantidadeInicial(regra: Pick<RegraDeQuantidade, "quantidadeMinima" | "multiplo">): number {
  const minimo = regra.quantidadeMinima && regra.quantidadeMinima > 0 ? regra.quantidadeMinima : 1;
  const multiplo = regra.multiplo && regra.multiplo > 0 ? regra.multiplo : 1;
  return Math.ceil(minimo / multiplo) * multiplo;
}

/**
 * As mesmas recusas, na mesma ordem e com as mesmas frases de
 * `catalogo_adicionar_ao_orcamento` — o teste confere que cada frase está no SQL.
 */
export function conferirQuantidade(
  quantidade: number,
  regra: RegraDeQuantidade,
  rotulo: string,
): ConferenciaDeQuantidade {
  if (
    !Number.isFinite(quantidade) ||
    quantidade <= 0 ||
    quantidade > 1_000_000 ||
    !Number.isInteger(quantidade)
  ) {
    return {
      ok: false,
      mensagem: "Informe a quantidade em peças inteiras (maior que zero).",
      sugestao: quantidadeInicial(regra),
    };
  }
  if (regra.quantidadeMinima != null && quantidade < regra.quantidadeMinima) {
    return {
      ok: false,
      mensagem: `A quantidade mínima de "${rotulo}" é ${inteiro(regra.quantidadeMinima)} peças.`,
      sugestao: quantidadeInicial(regra),
    };
  }
  if (regra.multiplo != null && regra.multiplo > 0 && quantidade % regra.multiplo !== 0) {
    const m = inteiro(regra.multiplo);
    const sugestao = Math.ceil(quantidade / regra.multiplo) * regra.multiplo;
    return {
      ok: false,
      mensagem: `"${rotulo}" é vendido de ${m} em ${m}: use ${inteiro(sugestao)}.`,
      sugestao,
    };
  }
  if (regra.faixaMax != null && quantidade > regra.faixaMax) {
    return {
      ok: true,
      aviso: `A tabela do fornecedor só traz preço para ${regra.faixa ?? "a faixa informada"}; acima disso, confirme o custo antes de enviar.`,
    };
  }
  return { ok: true, aviso: null };
}

/**
 * A regra de quantidade em linguagem de cliente, ou `null` quando a tabela não
 * diz nada (aí o vendedor confirma na conversa).
 *   mínimo 100, múltiplo 10  → "Pedido mínimo de 100 peças, de 10 em 10"
 *   mínimo 10,  múltiplo 10  → "Vendido de 10 em 10 peças"
 *   só mínimo 50             → "Pedido mínimo de 50 peças"
 *   faixa "100 a 199 peças"  → "Preço para 100 a 199 peças"
 */
export function quantidadeParaCliente(
  regra: Pick<RegraDeQuantidade, "quantidadeMinima" | "multiplo" | "faixa">,
): string | null {
  const minimo = regra.quantidadeMinima != null && regra.quantidadeMinima > 1 ? regra.quantidadeMinima : null;
  const multiplo = regra.multiplo != null && regra.multiplo > 1 ? regra.multiplo : null;
  const partes: string[] = [];
  if (minimo != null && multiplo != null && minimo === multiplo) {
    partes.push(`Vendido de ${PECAS.format(multiplo)} em ${PECAS.format(multiplo)} peças`);
  } else {
    if (minimo != null) partes.push(`Pedido mínimo de ${PECAS.format(minimo)} peças`);
    if (multiplo != null) {
      partes.push(
        minimo != null
          ? `de ${PECAS.format(multiplo)} em ${PECAS.format(multiplo)}`
          : `Vendido de ${PECAS.format(multiplo)} em ${PECAS.format(multiplo)} peças`,
      );
    }
  }
  const texto = partes.join(", ");
  if (regra.faixa) return texto ? `${texto} · preço para ${regra.faixa}` : `Preço para ${regra.faixa}`;
  return texto || null;
}
