/**
 * Contas da tabela de preços (custo, venda final, venda parceiro, lucro,
 * concorrentes). Tudo por UNIDADE de venda do produto (m², un, m…), como o
 * cadastro guarda `custo_medio` e `preco_base`.
 *
 * Margem é sobre a VENDA (lucro ÷ preço), a mesma do semáforo do orçamento;
 * markup é sobre o custo. Misturar os dois já fez "30%" querer dizer duas coisas.
 */

export const MAX_CONCORRENTES = 3;

export type PrecoDeParceiro = { valor: number; origem: "cadastro" | "nivel" };

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Preço do parceiro: o do cadastro do produto, senão o do nível mais baixo do programa. */
export function precoDoParceiro(args: {
  precoParceiro: number | null;
  precoBase: number | null;
  descontoDoNivelPct: number | null;
}): PrecoDeParceiro | null {
  if (args.precoParceiro != null && args.precoParceiro > 0) return { valor: centavos(args.precoParceiro), origem: "cadastro" };
  if (args.precoBase != null && args.precoBase > 0 && args.descontoDoNivelPct != null) {
    return { valor: centavos(args.precoBase * (1 - args.descontoDoNivelPct / 100)), origem: "nivel" };
  }
  return null;
}

export function lucroPorUnidade(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null) return null;
  return centavos(preco - custo);
}

/** Margem sobre a venda, em %. Sem preço (ou preço zero) não há margem para mostrar. */
export function margemSobreVenda(preco: number | null, custo: number | null): number | null {
  if (preco == null || custo == null || preco <= 0) return null;
  return Math.round(((preco - custo) / preco) * 1000) / 10;
}

export type PosicaoNoMercado = {
  menor: number;
  media: number;
  /** quanto o nosso preço está acima (+) ou abaixo (−) do mais barato, em % */
  contraOMenorPct: number;
  /** idem contra a média dos concorrentes */
  contraAMediaPct: number;
};

export function posicaoNoMercado(preco: number | null, concorrentes: number[]): PosicaoNoMercado | null {
  const validos = concorrentes.filter((p) => Number.isFinite(p) && p > 0);
  if (preco == null || preco <= 0 || validos.length === 0) return null;
  const menor = Math.min(...validos);
  const media = validos.reduce((s, p) => s + p, 0) / validos.length;
  const pct = (ref: number) => Math.round(((preco - ref) / ref) * 1000) / 10;
  return { menor, media: centavos(media), contraOMenorPct: pct(menor), contraAMediaPct: pct(media) };
}

/** Quanto abaixo do concorrente mais barato a casa mira (R$ 1,20 a R$ 1,50, dito pelo dono em 24/10/2026). */
export const FOLGA_SOBRE_O_CONCORRENTE = 1.5;

export type Sugestao = {
  chave: "bater" | "igualar" | "piso";
  rotulo: string;
  preco: number;
  margem: number | null;
  /** margem abaixo do mínimo cadastrado no produto */
  abaixoDoMinimo: boolean;
  /** a conta por extenso, para a dica */
  conta: string;
};

const R = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const P = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

/**
 * Três caminhos para um preço, sempre com a conta à vista:
 *   bater   — o concorrente mais barato menos a folga (mira do dono);
 *   igualar — o mesmo preço dele;
 *   piso    — o menor preço que ainda respeita a margem mínima do produto
 *             (custo ÷ (1 − margem mínima)); só existe com custo e margem mínima.
 * Sem concorrente anotado só o piso é possível.
 */
export function sugestoesDePreco(args: {
  custo: number | null;
  margemMinimaPct: number | null;
  menorConcorrente: number | null;
  folga?: number;
}): Sugestao[] {
  const { custo, margemMinimaPct, menorConcorrente } = args;
  const folga = args.folga ?? FOLGA_SOBRE_O_CONCORRENTE;
  const minimo = margemMinimaPct != null && margemMinimaPct > 0 ? margemMinimaPct : null;
  const abaixo = (m: number | null) => m != null && minimo != null && m < minimo;
  const saida: Sugestao[] = [];

  if (menorConcorrente != null && menorConcorrente > 0) {
    const bater = centavos(menorConcorrente - folga);
    if (bater > 0) {
      const m = margemSobreVenda(bater, custo);
      saida.push({
        chave: "bater",
        rotulo: `Bater (−${R(folga)})`,
        preco: bater,
        margem: m,
        abaixoDoMinimo: abaixo(m),
        conta: `${R(menorConcorrente)} do concorrente − ${R(folga)} = ${R(bater)}. Custo ${custo != null ? R(custo) : "—"}: lucro ${
          custo != null ? R(centavos(bater - custo)) : "—"
        } e margem ${P(m)}${minimo != null ? ` (mínimo do produto: ${P(minimo)})` : ""}.`,
      });
    }
    const m = margemSobreVenda(menorConcorrente, custo);
    saida.push({
      chave: "igualar",
      rotulo: "Igualar",
      preco: menorConcorrente,
      margem: m,
      abaixoDoMinimo: abaixo(m),
      conta: `Mesmo preço do concorrente mais barato (${R(menorConcorrente)}). Margem ${P(m)}${minimo != null ? ` (mínimo: ${P(minimo)})` : ""}.`,
    });
  }

  if (custo != null && custo > 0 && minimo != null && minimo < 100) {
    const piso = centavos(custo / (1 - minimo / 100));
    saida.push({
      chave: "piso",
      rotulo: "Piso da margem",
      preco: piso,
      margem: margemSobreVenda(piso, custo),
      abaixoDoMinimo: false,
      conta: `Custo ${R(custo)} ÷ (1 − ${P(minimo)}) = ${R(piso)}: o menor preço que ainda respeita a margem mínima${
        menorConcorrente != null ? `. Fica ${R(centavos(piso - menorConcorrente))} ${piso >= menorConcorrente ? "acima" : "abaixo"} do concorrente.` : "."
      }`,
    });
  }
  return saida;
}
