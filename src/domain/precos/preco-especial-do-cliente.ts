/**
 * Preço especial para clientes (plano de 02/11/2026, decisão 5): o preço de um
 * produto combinado com um cliente, como a aba Preço do Holdprint. Quando o
 * orçamento é desse cliente, o item entra com ele no lugar do preço de tabela.
 * O modo parceiro continua mandando: a tabela do programa é um acordo à parte.
 */

export type OrigemDoPreco = "parceiro" | "cliente" | "tabela";

export function precoDoProdutoNoItem(a: {
  emParceiro: boolean;
  precoParceiro: number | string | null | undefined;
  precoEspecial: number | string | null | undefined;
  precoBase: number | string | null | undefined;
}): { preco: number; origem: OrigemDoPreco } {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const parceiro = n(a.precoParceiro);
  const especial = n(a.precoEspecial);
  if (a.emParceiro && parceiro !== null && Number.isFinite(parceiro)) return { preco: parceiro, origem: "parceiro" };
  if (!a.emParceiro && especial !== null && Number.isFinite(especial)) return { preco: especial, origem: "cliente" };
  return { preco: Number(n(a.precoBase) ?? 0) || 0, origem: "tabela" };
}

export type PrecoEspecialEmEdicao = { cliente_id: string; preco: string };

/** Pendência do cadastro, em uma frase; nula quando pode gravar. */
export function pendenciaDoPrecoEspecial(
  p: PrecoEspecialEmEdicao,
  jaTem: readonly { cliente_id: string }[],
): string | null {
  if (!p.cliente_id) return "Escolha o cliente.";
  const v = Number(String(p.preco).replace(",", "."));
  if (!(v > 0)) return "Informe o preço combinado.";
  if (jaTem.some((x) => x.cliente_id === p.cliente_id)) return "Este cliente já tem preço especial neste produto: tire o atual antes.";
  return null;
}

/** "Preço especial do cliente: R$ 80,00 (tabela R$ 89,90)". */
export function fraseDoPrecoEspecial(especial: number, tabela: number | null | undefined): string {
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const t = Number(tabela ?? 0);
  return t > 0 ? `Preço especial do cliente: ${brl(especial)} (tabela ${brl(t)})` : `Preço especial do cliente: ${brl(especial)}`;
}
