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
export function menuAprovado(nome: string, temCatalogo: boolean, decideReembolso = false): ResumoDoMenu {
  const b = structuredClone((cenarioB as unknown as Record<string, ResumoDoMenu>)[nome]);
  somarAbasDoWhatsapp(b);
  juntarArteComEntrega(b);
  somarTabelaDePrecos(b);
  if (decideReembolso) somarReembolsos(b);
  somarFornecedores(b);
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
 * "Reembolsos" (15/10/2026, pedido do dono): a mesa de quem decide, em
 * Financeiro › Pagar e caixa, depois de Despesas fixas e contratos — para quem
 * tem reembolsos.pay ou reembolsos.approve. O pedido de cada pessoa ("Meus
 * reembolsos") fica no rodapé, fora da árvore: o operador não ganha área nova.
 */
function somarReembolsos(b: ResumoDoMenu): void {
  const pagar = b.arvore
    .find((a) => a.area === "Financeiro")
    ?.subs.find((s) => s.sub === "Pagar e caixa");
  if (!pagar) return;
  pagar.itens.splice(pagar.itens.indexOf("Despesas fixas e contratos") + 1, 0, "Reembolsos");
  b.itens += 1;
}

/**
 * "Fornecedores" (26/10/2026, pedido do dono): de quem a gráfica compra e o que
 * foi comprado em cada um, no fim de Financeiro › Pagar e caixa. Abre com
 * financeiro.read ou compras.read — preço de compra é custo. Quem tem "Pagar e
 * caixa" tem financeiro.read, então ganha o item; ninguém ganha área nova.
 */
function somarFornecedores(b: ResumoDoMenu): void {
  const pagar = b.arvore
    .find((a) => a.area === "Financeiro")
    ?.subs.find((s) => s.sub === "Pagar e caixa");
  if (!pagar) return;
  pagar.itens.push("Fornecedores");
  b.itens += 1;
}

/**
 * Abas novas do hub do WhatsApp depois do cenário B, a pedido do dono:
 * "Fila humana" (07/10/2026, caixa v3) e "Visão geral" (08/10/2026, os
 * números do atendimento). As duas abrem com whatsapp.read, a mesma porta do
 * WhatsApp: quem já via o WhatsApp no cenário B ganha as abas; ninguém ganha
 * item nem linha.
 */
const ABAS_NOVAS_DO_WHATSAPP = 2;

function somarAbasDoWhatsapp(b: ResumoDoMenu): void {
  const atendimento = b.arvore
    .find((a) => a.area === "Vendas")
    ?.subs.find((s) => s.sub === "Atendimento");
  if (!atendimento) return;
  const i = atendimento.itens.findIndex((t) => t === "WhatsApp" || t.startsWith("WhatsApp ("));
  if (i < 0) return;
  const n = Number(/\(\+(\d+) abas?\)/.exec(atendimento.itens[i])?.[1] ?? 0) + ABAS_NOVAS_DO_WHATSAPP;
  atendimento.itens[i] = `WhatsApp (+${n} aba${n > 1 ? "s" : ""})`;
  b.abas += ABAS_NOVAS_DO_WHATSAPP;
}

/**
 * Produção com cinco subgrupos em vez de seis (20/10/2026, ordem do diagnóstico
 * de UX aprovada pelo dono): "Arte" (um item só) e "Entrega e qualidade" viram
 * "Arte, entrega e qualidade", na posição da Arte, com os itens na mesma ordem.
 * Ninguém ganha nem perde item; quem via só um dos dois vê o subgrupo novo.
 */
function juntarArteComEntrega(b: ResumoDoMenu): void {
  const producao = b.arvore.find((a) => a.area === "Produção");
  if (!producao) return;
  const i = producao.subs.findIndex((s) => s.sub === "Arte" || s.sub === "Entrega e qualidade");
  if (i < 0) return;
  const itens = producao.subs
    .filter((s) => s.sub === "Arte" || s.sub === "Entrega e qualidade")
    .flatMap((s) => s.itens);
  producao.subs = producao.subs.filter((s) => s.sub !== "Arte" && s.sub !== "Entrega e qualidade");
  producao.subs.splice(i, 0, { sub: "Arte, entrega e qualidade", itens });
}

/**
 * "Tabela de preços" (23/10/2026, pedido do dono): custo, venda final, venda
 * parceiro, lucro e concorrentes, em Preço e custo, logo antes do Simulador de
 * preço. Abre com financeiro.read, a mesma porta do Simulador: quem via o
 * Simulador ganha o item (administrador, gerência e financeiro).
 */
function somarTabelaDePrecos(b: ResumoDoMenu): void {
  for (const area of b.arvore) {
    const sub = area.subs.find((s) => s.itens.includes("Simulador de preço"));
    if (!sub) continue;
    sub.itens.splice(sub.itens.indexOf("Simulador de preço"), 0, "Tabela de preços");
    b.itens += 1;
  }
}
