/**
 * Composição do preço: para onde vai cada real que o cliente paga.
 *
 * O resumo em números soltos responde "quanto custa" e não responde a pergunta
 * que se faz na frente do cliente: **até onde dá para baixar**. Quem está
 * negociando precisa ver, de uma vez, quanto do preço é material, quanto é
 * máquina, quanto é gente, quanto é imposto — e onde fica o chão.
 *
 * Duas linhas mandam nessa conta e são diferentes:
 *
 *   PISO      preço em que o lucro é ZERO. Abaixo disso a peça sai do bolso.
 *             Não é o custo: as taxas de venda incidem sobre o PREÇO, então
 *             baixar o preço baixa a taxa junto, e o piso é
 *             custo ÷ (1 − taxa), não custo + taxa.
 *
 *   MÍNIMO    preço da margem que a casa aceita trabalhar. É uma decisão, não
 *             uma conta — e por isso entra como parâmetro.
 */

export type FatiaDoPreco = {
  chave: "materiais" | "processos" | "maoDeObra" | "outros" | "taxas" | "lucro" | "prejuizo";
  rotulo: string;
  valor: number;
  /** fração do preço final, de 0 a 1 */
  fracao: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type EntradaComposicao = {
  custoMateriais: number;
  custoProcessos: number;
  custoMaoDeObra: number;
  outrosCustos: number;
  taxasVenda: number;
  precoFinal: number;
  custoTotal: number;
};

/**
 * As fatias do preço, na ordem em que o dinheiro é consumido.
 *
 * A última fatia é lucro ou PREJUÍZO — e prejuízo é uma fatia própria, não um
 * lucro negativo desenhado como se fosse pequeno. Uma barra que encolhe quando
 * o negócio piora esconde exatamente o caso que precisa gritar.
 */
export function fatiasDoPreco(e: EntradaComposicao): FatiaDoPreco[] {
  const preco = num(e.precoFinal);
  const lucro = preco - num(e.custoTotal) - num(e.taxasVenda);

  const base: Omit<FatiaDoPreco, "fracao">[] = [
    { chave: "materiais", rotulo: "Materiais", valor: r2(num(e.custoMateriais)) },
    { chave: "processos", rotulo: "Máquina", valor: r2(num(e.custoProcessos)) },
    { chave: "maoDeObra", rotulo: "Mão de obra", valor: r2(num(e.custoMaoDeObra)) },
    { chave: "outros", rotulo: "Outros custos", valor: r2(num(e.outrosCustos)) },
    { chave: "taxas", rotulo: "Taxas de venda", valor: r2(num(e.taxasVenda)) },
    lucro >= 0
      ? { chave: "lucro" as const, rotulo: "Lucro", valor: r2(lucro) }
      : { chave: "prejuizo" as const, rotulo: "Prejuízo", valor: r2(Math.abs(lucro)) },
  ];

  // A referência da fração é o preço, não a soma das fatias: no prejuízo as
  // duas divergem, e é justamente aí que a barra precisa mostrar que o custo
  // passou do preço.
  const referencia = preco > 0 ? preco : base.reduce((s, f) => s + f.valor, 0);
  return base
    .filter((f) => f.valor > 0)
    .map((f) => ({ ...f, fracao: referencia > 0 ? f.valor / referencia : 0 }));
}

/**
 * Preço em que o lucro zera.
 *
 * As taxas incidem sobre o preço, então elas encolhem junto quando se dá
 * desconto: `custo + taxa` daria um piso alto demais e faria a casa recusar
 * negócio que ainda pagava. A conta certa é custo ÷ (1 − taxa).
 */
export function pisoDePreco(custoTotal: number, taxasVendaPct: number): number {
  const custo = num(custoTotal);
  const taxa = Math.min(Math.max(num(taxasVendaPct), 0), 0.99);
  return r2(custo / (1 - taxa));
}

/** Preço da margem que a casa aceita. Margem + taxa ≥ 100% não tem preço. */
export function precoDeMargem(custoTotal: number, margemAlvo: number, taxasVendaPct: number): number | null {
  const den = 1 - num(margemAlvo) - num(taxasVendaPct);
  if (den <= 0) return null;
  return r2(num(custoTotal) / den);
}

export type EspacoDeNegociacao = {
  piso: number;
  minimo: number | null;
  preco: number;
  /** quanto dá para baixar até o piso, em reais e em % do preço */
  descontoAtePiso: number;
  descontoAtePisoPct: number;
  /** quanto dá para baixar até a margem mínima aceita */
  descontoAteMinimo: number;
  descontoAteMinimoPct: number;
  /** o preço atual já está abaixo do piso */
  abaixoDoPiso: boolean;
  /** abaixo da margem mínima, mas ainda acima do piso */
  abaixoDoMinimo: boolean;
};

/**
 * Quanto ainda dá para baixar — a pergunta da mesa de negociação.
 *
 * Devolve os dois limites porque eles servem a decisões diferentes: até o
 * mínimo é desconto que o vendedor dá sozinho; entre o mínimo e o piso é
 * decisão de quem manda; abaixo do piso é pagar para trabalhar.
 */
export function espacoDeNegociacao(entrada: {
  precoFinal: number;
  custoTotal: number;
  taxasVendaPct: number;
  margemMinima: number;
}): EspacoDeNegociacao {
  const preco = num(entrada.precoFinal);
  const piso = pisoDePreco(entrada.custoTotal, entrada.taxasVendaPct);
  const minimo = precoDeMargem(entrada.custoTotal, entrada.margemMinima, entrada.taxasVendaPct);

  const ateP = Math.max(0, preco - piso);
  const ateM = minimo == null ? 0 : Math.max(0, preco - minimo);

  return {
    piso,
    minimo,
    preco: r2(preco),
    descontoAtePiso: r2(ateP),
    descontoAtePisoPct: preco > 0 ? ateP / preco : 0,
    descontoAteMinimo: r2(ateM),
    descontoAteMinimoPct: preco > 0 ? ateM / preco : 0,
    abaixoDoPiso: preco > 0 && preco < piso,
    abaixoDoMinimo: minimo != null && preco > 0 && preco < minimo && preco >= piso,
  };
}
