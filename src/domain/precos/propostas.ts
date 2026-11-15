/**
 * Contas da tela "Preços pendentes de aprovação". Funções puras, sem banco e sem tela.
 *
 * Tudo em margem sobre a venda, em percentual, na MESMA escala: o piso (margem mínima do produto),
 * a margem de hoje e a margem se o preço proposto for aprovado.
 * O preço do piso em reais vem do banco (round(custo / (1 - margem mínima / 100), 2)).
 */

/** A referência do dono para o metro quadrado de impressão (adesivo ou lona impressa). */
export const REFERENCIA_M2 = 70;
/** Categoria cujo preço por metro quadrado entra na média da tela. */
export const CATEGORIA_DA_MEDIA_M2 = "impressao_grande_formato";
/** Até quantos pontos percentuais acima do piso a margem ainda é amarela. */
export const FOLGA_AMARELA = 5;

export type PropostaDePreco = {
  id: string;
  produto_id: string;
  produto_nome: string;
  unidade: string | null;
  preco_atual: number;
  preco_proposto: number;
  custo: number | null;
  piso: number | null;
  margem_minima: number | null;
  margem_atual: number | null;
  margem_proposta: number | null;
  motivo: string;
  origem: "abaixo_do_piso" | "referencia_m2";
  created_at: string;
};

export type FaixaDaMargem = "abaixo" | "perto" | "acima" | "sem_dado";

export function faixaDaMargem(margem: number | null, minima: number | null): FaixaDaMargem {
  if (margem == null || minima == null) return "sem_dado";
  if (margem < minima) return "abaixo";
  if (margem < minima + FOLGA_AMARELA) return "perto";
  return "acima";
}

export const ROTULO_DA_FAIXA: Record<FaixaDaMargem, string> = {
  abaixo: "Abaixo do piso",
  perto: "Perto do piso",
  acima: "Acima do piso",
  sem_dado: "Sem dado",
};

export type BarraDaProposta = {
  tipo: "piso" | "atual" | "proposta";
  rotulo: string;
  /** Margem em percentual, ou nulo quando falta o custo. */
  valor: number | null;
  /** Largura em percentual da escala, de 0 a 100. */
  largura: number;
  faixa: FaixaDaMargem;
};

/** As três barras, na mesma escala. A escala vai até o maior valor com uma folga e nunca passa de 100. */
export function barrasDaProposta(p: Pick<PropostaDePreco, "margem_minima" | "margem_atual" | "margem_proposta">): BarraDaProposta[] {
  const valores = [p.margem_minima, p.margem_atual, p.margem_proposta].filter((v): v is number => v != null);
  const teto = Math.min(100, Math.max(10, ...valores) * 1.15);
  const largura = (v: number | null) => (v == null ? 0 : Math.max(0, Math.min(100, (v / teto) * 100)));
  const minima = p.margem_minima;
  return [
    { tipo: "piso", rotulo: "Piso da margem", valor: minima, largura: largura(minima), faixa: minima == null ? "sem_dado" : "perto" },
    { tipo: "atual", rotulo: "Margem de hoje", valor: p.margem_atual, largura: largura(p.margem_atual), faixa: faixaDaMargem(p.margem_atual, minima) },
    { tipo: "proposta", rotulo: "Margem se aprovar", valor: p.margem_proposta, largura: largura(p.margem_proposta), faixa: faixaDaMargem(p.margem_proposta, minima) },
  ];
}

/** O preço proposto resolve quando a margem proposta chega ao mínimo. */
export function propostaResolve(p: Pick<PropostaDePreco, "margem_minima" | "margem_proposta" | "piso" | "preco_proposto">): boolean {
  if (p.piso != null) return p.preco_proposto >= p.piso;
  if (p.margem_minima != null && p.margem_proposta != null) return p.margem_proposta >= p.margem_minima;
  return false;
}

export function mediaPrecoM2(precos: Array<number | null | undefined>): { media: number; quantidade: number } | null {
  const v = precos.map((x) => (x == null ? NaN : Number(x))).filter((x) => Number.isFinite(x) && x > 0);
  if (v.length === 0) return null;
  const soma = v.reduce((s, x) => s + x, 0);
  return { media: Math.round((soma / v.length) * 100) / 100, quantidade: v.length };
}

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ponto = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por cento`;

/** Explicação de cada barra em português simples, com os números da proposta. Sem parênteses, travessão ou seta. */
export function explicacaoDaBarra(tipo: BarraDaProposta["tipo"], p: PropostaDePreco): string {
  const piso = p.piso != null ? reais(p.piso) : "sem custo cadastrado";
  const minima = p.margem_minima != null ? ponto(p.margem_minima) : "não definida";
  if (tipo === "piso") {
    return `O piso é o menor preço que ainda deixa a margem mínima do produto, que é ${minima}. Para este produto o piso é ${piso}. Vender abaixo disso é vender com lucro menor do que a casa decidiu aceitar. O certo é consertar o preço para ficar no piso ou acima, e nunca baixar a margem mínima.`;
  }
  if (tipo === "atual") {
    const m = p.margem_atual != null ? ponto(p.margem_atual) : "desconhecida";
    return `Margem é a parte do preço de venda que sobra depois de pagar o custo. Hoje o preço é ${reais(p.preco_atual)} e a margem é ${m}. ${
      faixaDaMargem(p.margem_atual, p.margem_minima) === "abaixo" ? "Está abaixo do mínimo, então este preço está errado e precisa ser corrigido." : "Está dentro do mínimo."
    }`;
  }
  const m = p.margem_proposta != null ? ponto(p.margem_proposta) : "desconhecida";
  return propostaResolve(p)
    ? `Com o preço de ${reais(p.preco_proposto)} a margem passa a ser ${m}, que respeita o mínimo de ${minima}. Por isso este preço resolve o problema sem mexer na margem mínima.`
    : `Com o preço de ${reais(p.preco_proposto)} a margem seria ${m}, que ainda não chega ao mínimo de ${minima}. Não aprove este preço.`;
}
