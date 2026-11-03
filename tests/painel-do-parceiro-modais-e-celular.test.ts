import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Auditoria do painel do parceiro (02/11/2026): modais nunca empilhados, campo
 * visível no tema escuro, buscas com nome e andamento do pedido legível no
 * celular.
 */
const ler = (p: string) => readFileSync(p, "utf8");
const AVISO = ler("src/components/parceiro/oferta-aviso.tsx");
const CASCA = ler("src/components/parceiro/casca.tsx");
// 02/11: a busca em lista virou a escolha em cartões da equipe (parceiro-escolha-em-cartoes.test.ts).
const SELETOR = ler("src/components/orcamento/escolha-de-produto.tsx");
const PEDIDO = ler("src/components/parceiro/pedido-dialog.tsx");
const PEDIDOS = ler("src/components/parceiro/pedidos.tsx");
const CSS = ler("src/styles.css");

describe("o aviso de oferta nunca abre por cima de outro diálogo", () => {
  it("só abre no Início e espera não haver outro diálogo aberto", () => {
    expect(AVISO).toContain('[role="dialog"][data-state="open"]');
    expect(AVISO).toContain("noInicio");
    expect(AVISO).toContain("if (!oferta || !noInicio || !livre) return null;");
  });
});

describe("a casca do parceiro", () => {
  it("o topo é sticky sem disputar com relative", () => {
    expect(CASCA).not.toMatch(/sticky top-0 z-30 relative/);
  });
  it("o item ativo da barra de baixo usa a cor de texto ciano com par claro/escuro", () => {
    expect(CASCA).toContain('selecionado ? "text-status-cyan"');
    expect(CASCA).not.toContain("text-[color:var(--bex-cyan)]");
  });
});

describe("campo visível no tema escuro", () => {
  it("--input nunca é igual a --card no .dark", () => {
    const escuro = CSS.slice(CSS.indexOf(".dark {"));
    const card = escuro.match(/--card:\s*(#[0-9a-f]{6})/i)?.[1];
    const input = escuro.match(/--input:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(card).toBeTruthy();
    expect(input).toBeTruthy();
    expect(input!.toLowerCase()).not.toBe(card!.toLowerCase());
  });
});

describe("campos com nome", () => {
  it("a busca da escolha de produto tem aria-label", () => {
    expect(SELETOR).toContain('aria-label="Buscar produto"');
  });
  it("o valor de crédito do pedido tem rótulo visível ligado ao campo", () => {
    expect(PEDIDO).toContain('<Label htmlFor="valor-credito">');
    expect(PEDIDO).toContain('id="valor-credito"');
  });
});

describe("editor do orçamento em 390 px (medido ao vivo em 02/11/2026: coluna de 428 px cortava o resumo)", () => {
  const EDITOR = ler("src/components/parceiro/editor-de-orcamento.tsx");
  const BARRA = ler("src/components/parceiro/barra-de-passos.tsx");
  const MENU = ler("src/components/parceiro/menu-do-parceiro.tsx");
  const CONVITE = ler("src/components/parceiro/convite-card.tsx");
  it("os filhos da grade têm min-w-0 e a barra de passos só mostra o nome do passo atual no celular", () => {
    expect(EDITOR).toContain('<div className="min-w-0 space-y-5">');
    expect(EDITOR).toContain('<aside className="h-fit min-w-0 space-y-3 lg:sticky lg:top-28">');
    expect(BARRA).toContain('!ativo && "hidden sm:inline"');
    expect(BARRA).toContain("w-full min-w-0 flex-col");
  });
  it("a barra de baixo usa nome curto e o link de convite ocupa a linha inteira no celular", () => {
    expect(MENU).toContain('curto: "Tabela"');
    expect(CASCA).toContain("{item.curto}");
    expect(CONVITE).toContain("basis-full");
  });
});

describe("o item do parceiro herda a estrutura do item da equipe (02/11/2026)", () => {
  const EDITOR = ler("src/components/parceiro/editor-de-orcamento.tsx");
  it("usa as mesmas peças: medidas, quantidade com − e +, acabamento", () => {
    for (const peca of ["<MedidasDaPeca", "<QuantidadeDoItem", "<AcabamentoDoItem"]) expect(EDITOR).toContain(peca);
    // cada item tem o próprio id nos campos compartilhados (vários cartões na mesma página)
    expect(EDITOR).toContain("idPrefixo={`item-${item.id}`}");
    expect(EDITOR).toContain("id={`item-${item.id}-qtd`}");
    expect(EDITOR).toContain("id={`item-${item.id}-acabamento`}");
  });
  it("tem as mesmas ações da tabela da equipe, com os mesmos ícones e nomes", () => {
    for (const acao of ["Subir o item", "Descer o item", "Duplicar o item", "Tirar o item"]) expect(EDITOR).toContain(acao);
    expect(EDITOR).toContain('<Trash2 className="h-4 w-4 text-destructive" />');
    expect(EDITOR).toContain("<AlertDialog open={aRemover !== null}");
    expect(EDITOR).not.toContain("Remover item ${indice + 1}");
  });
  it("preço na grade da equipe e o bloco de ganho só do parceiro", () => {
    // 02/11: uma troca de classe comeu o espaço ("ml-9grid") e o bloco de ganho
    // perdeu o grid no ar; classe colada na seguinte nunca mais.
    expect(EDITOR).not.toMatch(/className="ml-9\S/);
    expect(EDITOR).toContain('className="ml-9 grid grid-cols-3');
    expect(EDITOR).toContain('rotulo={porArea ? "Preço/m²" : "Valor un."}');
    expect(EDITOR).toContain('rotulo="Total do item"');
    for (const r of ["Cliente paga", "Você paga", "Seu ganho"]) expect(EDITOR).toContain(r);
  });
  it("as peças compartilhadas aceitam id por item sem mudar o padrão da equipe", () => {
    expect(ler("src/components/orcamento/quantidade-do-item.tsx")).toContain('id = "item-qtd"');
    expect(ler("src/components/orcamento/acabamento-do-item.tsx")).toContain('id = "item-acabamento"');
    expect(ler("src/components/orcamento/medidas-da-peca.tsx")).toContain('idPrefixo = "item"');
  });
});

describe("andamento do pedido no celular", () => {
  it("os cinco nomes só aparecem a partir de sm; no celular o passo atual é dito por extenso", () => {
    expect(PEDIDOS).toContain('"hidden truncate text-xs sm:block"');
    expect(PEDIDOS).toContain("{PASSOS_DO_PEDIDO[s.passo]}");
  });
});
