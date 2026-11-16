/**
 * Como a tela de parâmetros da casa mostra e edita um valor de custos_tabela.
 *
 * custos_tabela.valor deixou de ser obrigatório (migração 20261116100000): um parâmetro novo nasce sem
 * número. Nulo não é zero. Number(null) dá 0, e uma tela que mostra "R$ 0,00" para um valor que ninguém
 * informou afirma uma coisa que o banco não diz.
 */

/** Lê o valor do banco. Vazio, nulo e texto sem sentido viram nulo, nunca zero. */
export function valorDoParametro(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatarParametro(valor: unknown, unidade: string | null): string {
  const n = valorDoParametro(valor);
  if (n === null) return "Sem valor";
  if (unidade === "%") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (unidade?.startsWith("R$"))
    return `${n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: unidade === "R$/kWh" ? 4 : 2 })}${unidade.replace("R$", "")}`;
  return `${n.toLocaleString("pt-BR")} ${unidade ?? ""}`.trim();
}

/** O texto que abre no campo de edição: vazio quando não há valor, nunca a palavra null. */
export function rascunhoDoParametro(valor: unknown): string {
  const n = valorDoParametro(valor);
  return n === null ? "" : String(n);
}
