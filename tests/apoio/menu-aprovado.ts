import cenarioB from "../fixtures/menu-cenario-b-2026-10-05.json";

/** O resumo de um menu no formato do script da proposta (arvore-nova.mjs). */
export type ResumoDoMenu = {
  areas: string[];
  rotina: string[];
  itens: number;
  abas: number;
  linhas: number;
  atalhos: string[];
  arvore: { area: string; rotina: boolean; subs: { sub: string; itens: string[] }[] }[];
};

export const PESSOAS: Record<string, string[]> = {
  "Harison (admin)": ["admin"],
  "Yvens (gestor)": ["gestor"],
  "Cibele (financeiro)": ["financeiro"],
  "Leonardo (vendedor+operador)": ["vendedor", "operador"],
  "Sergio (operador)": ["operador"],
};

/**
 * O que o dono aprovou para cada pessoa: o cenário B de 05/10/2026, mais o
 * que entrou depois dele — "Catálogo de brindes" (era "Catálogos de fornecedores") em Vendas › Orçamentos,
 * logo depois de Aprovações do cliente, para quem tem catalogo.read.
 */
export function menuAprovado(nome: string, temCatalogo: boolean): ResumoDoMenu {
  const b = structuredClone((cenarioB as unknown as Record<string, ResumoDoMenu>)[nome]);
  somarFilaHumana(b);
  if (!temCatalogo) return b;
  const vendas = b.arvore.find((a) => a.area === "Vendas");
  const orcamentos = vendas?.subs.find((s) => s.sub === "Orçamentos");
  if (!vendas || !orcamentos) return b;
  orcamentos.itens.splice(
    orcamentos.itens.indexOf("Aprovações do cliente") + 1,
    0,
    "Catálogo de brindes",
  );
  b.itens += 1;
  // Uma linha a mais só quando Vendas abre sozinha (rotina em até duas áreas).
  if (vendas.rotina && b.rotina.length <= 2) b.linhas += 1;
  return b;
}

/**
 * Pedido do dono em 07/10/2026 (caixa v3 do WhatsApp): a aba "Fila humana"
 * entra no hub do WhatsApp. Quem já via o WhatsApp no cenário B (abre com
 * whatsapp.read, a mesma porta da fila humana) ganha uma aba; ninguém ganha
 * item nem linha.
 */
function somarFilaHumana(b: ResumoDoMenu): void {
  const atendimento = b.arvore
    .find((a) => a.area === "Vendas")
    ?.subs.find((s) => s.sub === "Atendimento");
  if (!atendimento) return;
  const i = atendimento.itens.findIndex((t) => t === "WhatsApp" || t.startsWith("WhatsApp ("));
  if (i < 0) return;
  const n = Number(/\(\+(\d+) abas?\)/.exec(atendimento.itens[i])?.[1] ?? 0) + 1;
  atendimento.itens[i] = `WhatsApp (+${n} aba${n > 1 ? "s" : ""})`;
  b.abas += 1;
}
