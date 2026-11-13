/**
 * Crédito de entrada do parceiro: um valor fixo ao ser ativado, que só vale
 * junto com a 1ª compra (como o crédito inicial das campanhas de carteira).
 *
 * O servidor (`parceiro_enviar_pedido`) é a autoridade. Estas funções só
 * espelham a regra para a tela explicar o mesmo número que o banco aplica.
 * Se o banco ainda não tem o bloco `entrada`, tudo aqui devolve "desligado".
 */

export type ProgramaDeEntrada = {
  ativa: boolean;
  valor: number;
  validade_dias: number;
  pedido_minimo: number;
  max_pct: number;
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

/** Lê o bloco `entrada` da RPC pública. Ausente ou incompleto = null (recurso desligado). */
export function lerEntrada(programa: unknown): ProgramaDeEntrada | null {
  if (!programa || typeof programa !== "object") return null;
  const e = (programa as Record<string, unknown>).entrada;
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  const valor = num(r.valor);
  const validade = num(r.validade_dias);
  const minimo = num(r.pedido_minimo);
  const maxPct = num(r.max_pct);
  if (valor === null || validade === null || minimo === null || maxPct === null) return null;
  return {
    ativa: r.ativa === true,
    valor,
    validade_dias: validade,
    pedido_minimo: minimo,
    max_pct: maxPct,
  };
}

/** Status do pedido da gráfica que devolvem o crédito: o pedido não conta como compra. */
export const STATUS_QUE_NAO_CONTAM = ["rejeitado", "expirado"] as const;

/** É a 1ª compra se nenhum pedido anterior segue valendo (recusado/expirado não contam). */
export function ehPrimeiraCompra(pedidos: { pedido_status: string }[]): boolean {
  return !pedidos.some(
    (p) => !(STATUS_QUE_NAO_CONTAM as readonly string[]).includes(p.pedido_status),
  );
}

/**
 * Percentual máximo do pedido (só produtos, sem taxa de prazo) que o crédito
 * pode cobrir. Mesma regra do servidor: na 1ª compra com base >= pedido mínimo
 * e programa ligado, vale o maior entre o teto geral e o da entrada.
 */
export function pctMaximoDoPedido(args: {
  base: number;
  primeiraCompra: boolean;
  maxPctGeral: number | null | undefined;
  entrada: ProgramaDeEntrada | null;
}): number {
  const geral = num(args.maxPctGeral) ?? 100;
  const e = args.entrada;
  if (e && e.ativa && args.primeiraCompra && args.base > 0 && args.base >= e.pedido_minimo) {
    return Math.max(geral, e.max_pct);
  }
  return geral;
}

/** Teto em R$ do crédito no pedido (arredondado a centavos, como no banco). */
export function tetoDeCreditoDoPedido(args: Parameters<typeof pctMaximoDoPedido>[0]): number {
  const base = Math.max(Number(args.base) || 0, 0);
  return Math.round(base * pctMaximoDoPedido(args)) / 100;
}

const brl0 = (v: number) =>
  v
    .toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: v % 1 ? 2 : 0,
      maximumFractionDigits: v % 1 ? 2 : 0,
    })
    .replace(/\u00a0/g, " ");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** A frase da regra, gerada dos números (nada fixo no código). */
export function fraseDaEntrada(
  e: Pick<ProgramaDeEntrada, "valor" | "validade_dias" | "pedido_minimo" | "max_pct">,
): string {
  return `Todo parceiro novo ganha ${brl0(e.valor)} ao entrar. Vale ${e.validade_dias} dias e só junto com uma 1ª compra de pelo menos ${brl0(e.pedido_minimo)}, cobrindo até ${pct(e.max_pct)} do pedido.`;
}
