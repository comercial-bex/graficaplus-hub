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
  if (temCatalogo) somarCatalogo(b);
  enxugarDeNovembro(b);
  return renomearParceiros(b);
}

function somarCatalogo(b: ResumoDoMenu): void {
  const vendas = b.arvore.find((a) => a.area === "Vendas");
  const orcamentos = vendas?.subs.find((s) => s.sub === "Orçamentos");
  if (!vendas || !orcamentos) return;
  orcamentos.itens.splice(
    orcamentos.itens.indexOf("Aprovações do cliente") + 1,
    0,
    "Catálogo de brindes",
  );
  b.itens += 1;
  // Uma linha a mais só quando Vendas abre sozinha (rotina em até duas áreas).
  if (vendas.rotina && b.rotina.length <= 2) b.linhas += 1;
}

type ItemLido = { titulo: string; n: number; link: string | null };

/** "WhatsApp (+3 abas) [abre em /x]" → partes; e de volta. */
const lerItem = (t: string): ItemLido => ({
  titulo: t.replace(/ \[abre em [^\]]+\]/, "").replace(/ \(\+\d+ abas?\)/, ""),
  n: Number(/\(\+(\d+) abas?\)/.exec(t)?.[1] ?? 0),
  link: /\[abre em ([^\]]+)\]/.exec(t)?.[1] ?? null,
});
const escreverItem = (l: ItemLido): string =>
  l.titulo + (l.n ? ` (+${l.n} aba${l.n > 1 ? "s" : ""})` : "") + (l.link ? ` [abre em ${l.link}]` : "");

/**
 * Funde itens de uma área num hub: cada item fundido (com as abas que já tinha)
 * vira aba do hub. Como o resumo de cada pessoa só traz o que ela abre, a conta
 * é mecânica: item que some é aba que entra. Se a pessoa não abre a tela
 * principal do hub, o hub nasce no lugar do primeiro desdobramento e abre nele.
 */
function fundirEmHub(
  b: ResumoDoMenu,
  area: string,
  hub: { titulo: string; abasNovasSeAberto?: number },
  desdobramentos: { titulo: string; url: string }[],
  subsDeOrigem: string[],
): void {
  const a = b.arvore.find((x) => x.area === area);
  if (!a) return;
  let doHub: ItemLido | null = null;
  let onde: { sub: { itens: string[] }; index: number } | null = null;
  let somaAbas = 0;
  let removidos = 0;
  let primeiraAba: string | null = null;
  for (const s of a.subs.filter((x) => subsDeOrigem.includes(x.sub))) {
    for (let i = 0; i < s.itens.length; i++) {
      const l = lerItem(s.itens[i]);
      if (l.titulo === hub.titulo) {
        doHub = l;
        onde = { sub: s, index: i };
        continue;
      }
      const d = desdobramentos.find((x) => x.titulo === l.titulo);
      if (!d) continue;
      somaAbas += 1 + l.n;
      removidos += 1;
      primeiraAba ??= d.url;
      onde ??= { sub: s, index: i };
      s.itens.splice(i, 1);
      i -= 1;
    }
  }
  if (!onde) return;
  if (doHub) {
    doHub.n += somaAbas + (hub.abasNovasSeAberto ?? 0);
    onde.sub.itens[onde.index] = escreverItem(doHub);
    b.itens -= removidos;
    b.abas += removidos + (hub.abasNovasSeAberto ?? 0);
    return;
  }
  // Sem a tela principal: o primeiro desdobramento vira a porta do hub.
  onde.sub.itens.splice(onde.index, 0, escreverItem({ titulo: hub.titulo, n: somaAbas - 1, link: primeiraAba }));
  b.itens -= removidos - 1;
  b.abas += removidos - 1;
}

/** Junta subgrupos de uma área num só, na posição do primeiro, mantendo a ordem dos itens. */
function juntarSubgrupos(b: ResumoDoMenu, area: string, nomes: string[], novoNome: string): void {
  const a = b.arvore.find((x) => x.area === area);
  if (!a) return;
  const i = a.subs.findIndex((s) => nomes.includes(s.sub));
  if (i < 0) return;
  const itens = a.subs.filter((s) => nomes.includes(s.sub)).flatMap((s) => s.itens);
  a.subs = a.subs.filter((s) => !nomes.includes(s.sub));
  if (itens.length > 0) a.subs.splice(i, 0, { sub: novoNome, itens });
}

/**
 * O custeio como no Holdprint e o menu enxuto (02/11/2026, OK do dono ao plano
 * do custeio): 39 itens viraram 26. Tela que é desdobramento de outra virou aba
 * dela: Catálogo de brindes e Meta do mês no Orçamentos; Pós-venda e
 * Metragem no Clientes; Trabalho parado, Entregas e Perdas na OS; Contas
 * bancárias, Despesas fixas e Reembolsos no Caixa; e o hub "Custeio" (a tela de
 * produtos) com Processos, Planilha de custos, Mão de obra, Tabela de preços e
 * Simulador. Ninguém ganha nem perde tela: muda a porta.
 */
function enxugarDeNovembro(b: ResumoDoMenu): void {
  fundirEmHub(
    b,
    "Vendas",
    { titulo: "Orçamentos" },
    [
      // Aprovações do cliente continua item próprio: o selo de "pediu ajuste" leva à fila.
      { titulo: "Catálogo de brindes", url: "/catalogos" },
      { titulo: "Meta do mês", url: "/meta" },
    ],
    ["Orçamentos", "Números de venda"],
  );
  fundirEmHub(
    b,
    "Vendas",
    { titulo: "Clientes" },
    [
      { titulo: "Pós-venda", url: "/pos-venda" },
      { titulo: "Metragem por cliente", url: "/metragem" },
    ],
    ["Clientes", "Números de venda"],
  );
  juntarSubgrupos(b, "Vendas", ["Orçamentos", "Clientes", "Números de venda"], "Clientes e orçamentos");

  fundirEmHub(
    b,
    "Produção",
    { titulo: "Ordens de serviço" },
    [
      { titulo: "Trabalho parado", url: "/onde-para" },
      { titulo: "Entregas e instalações", url: "/entregas" },
      { titulo: "Perdas e ocorrências", url: "/perdas" },
    ],
    ["Fila da oficina", "Arte, entrega e qualidade"],
  );
  juntarSubgrupos(b, "Produção", ["Arte, entrega e qualidade", "Material e compras"], "Arte e material");

  fundirEmHub(
    b,
    "Financeiro",
    { titulo: "Caixa e contas a pagar" },
    [
      { titulo: "Contas bancárias e extrato", url: "/contas-bancarias" },
      { titulo: "Despesas fixas e contratos", url: "/compromissos" },
      { titulo: "Reembolsos", url: "/reembolsos" },
    ],
    ["Pagar e caixa"],
  );
  // "Processos" saiu de fora do menu e virou aba do Custeio; abre com a mesma porta de Produtos (custos.read).
  fundirEmHub(
    b,
    "Financeiro",
    { titulo: "Produtos e serviços", abasNovasSeAberto: 1 },
    [
      { titulo: "Planilha de custos", url: "/planilha-custos" },
      { titulo: "Tabela de preços", url: "/tabela-de-precos" },
      { titulo: "Simulador de preço", url: "/precificacao" },
    ],
    ["Preço e custo"],
  );
  const financeiro = b.arvore.find((x) => x.area === "Financeiro");
  const precoECusto = financeiro?.subs.find((s) => s.sub === "Preço e custo");
  if (precoECusto) {
    precoECusto.itens = precoECusto.itens.map((t) => {
      const l = lerItem(t);
      return l.titulo === "Produtos e serviços" ? escreverItem({ ...l, titulo: "Custeio" }) : t;
    });
  }
  juntarSubgrupos(b, "Financeiro", ["Preço e custo", "Resultado"], "Custeio e resultado");

  for (const a of b.arvore) a.subs = a.subs.filter((s) => s.itens.length > 0);
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

/** O menu aprovado em 05/10 chamava o item de "Parceiros revendedores"; a palavra saiu da tela (só parceiro e cliente final). */
function renomearParceiros(b: ResumoDoMenu): ResumoDoMenu {
  return JSON.parse(JSON.stringify(b).replaceAll("Parceiros revendedores", "Parceiros")) as ResumoDoMenu;
}
