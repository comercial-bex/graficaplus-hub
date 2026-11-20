import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CobrancaDoAcabamento } from "@/components/orcamento/cobranca-do-acabamento";
import {
  acabamentoCobravel,
  ACABAMENTOS_COBRAVEIS,
  alternarEscolha,
  ladosSugeridos,
  NENHUM_ACABAMENTO,
  quantidadeDoAcabamento,
} from "@/domain/orcamentos/cobranca-do-acabamento";

describe("quantidade do acabamento", () => {
  it("bainha conta o contorno de cada peça vezes a quantidade", () => {
    expect(quantidadeDoAcabamento("perimetro", { largura: 3, altura: 1, quantidade: 1 })).toBe(8);
    expect(quantidadeDoAcabamento("perimetro", { largura: 0.8, altura: 1.6, quantidade: 5 })).toBe(
      24,
    );
  });

  it("laminação conta a área da peça vezes a quantidade", () => {
    expect(quantidadeDoAcabamento("area", { largura: 2, altura: 1.25, quantidade: 2 })).toBe(5);
  });

  it("sem medida não cobra nada, e quantidade vazia vale 1", () => {
    expect(quantidadeDoAcabamento("area", { largura: 0, altura: 1, quantidade: 1 })).toBe(0);
    expect(quantidadeDoAcabamento("perimetro", { largura: 1, altura: 1, quantidade: 0 })).toBe(4);
  });

  it("só os acabamentos com serviço de preço são cobráveis", () => {
    expect(acabamentoCobravel("bainha + ilhós")?.medida).toBe("perimetro");
    expect(acabamentoCobravel("Recorte eletrônico (plotter de recorte)")).toBeNull();
    expect(new Set(ACABAMENTOS_COBRAVEIS.map((a) => a.servico)).size).toBe(
      ACABAMENTOS_COBRAVEIS.length,
    );
  });
});

describe("lados da bainha", () => {
  const peca = { largura: 0.8, altura: 1.6, quantidade: 5 };
  it("contorno todo, só os maiores ou só os menores", () => {
    expect(quantidadeDoAcabamento("perimetro", peca, "contorno")).toBe(24);
    expect(quantidadeDoAcabamento("perimetro", peca, "maiores")).toBe(16);
    expect(quantidadeDoAcabamento("perimetro", peca, "menores")).toBe(8);
  });
  it("o padrão é o contorno todo", () => {
    expect(quantidadeDoAcabamento("perimetro", peca)).toBe(24);
  });
  it("não depende de a largura ser a menor medida", () => {
    const deitada = { largura: 1.6, altura: 0.8, quantidade: 5 };
    expect(quantidadeDoAcabamento("perimetro", deitada, "maiores")).toBe(16);
    expect(quantidadeDoAcabamento("perimetro", deitada, "menores")).toBe(8);
  });
  it("laminação ignora os lados", () => {
    expect(quantidadeDoAcabamento("area", peca, "menores")).toBe(6.4);
  });
  it("banner sugere os lados menores; o resto, o contorno", () => {
    expect(ladosSugeridos("Banner com bastão e corda")).toBe("menores");
    expect(ladosSugeridos("Lona 440g reforçada impressa")).toBe("contorno");
    expect(ladosSugeridos(null)).toBe("contorno");
  });
  it("sem nenhum lado marcado a bainha não cobra nada; laminação e bastão não dependem dos lados", () => {
    expect(quantidadeDoAcabamento("perimetro", peca, null)).toBe(0);
    expect(quantidadeDoAcabamento("area", peca, null)).toBe(6.4);
    expect(quantidadeDoAcabamento("peca", peca, null)).toBe(5);
  });
});

describe("acabamento à parte é opcional: dá para desmarcar", () => {
  it("tocar no marcado desmarca; tocar em outro marca esse", () => {
    expect(alternarEscolha("Refile", "Refile")).toBeNull();
    expect(alternarEscolha("Refile", "Só bainha")).toBe("Só bainha");
    expect(alternarEscolha(null, "Refile")).toBe("Refile");
    expect(alternarEscolha<"contorno" | "maiores">("contorno", "contorno")).toBeNull();
  });
  it("o marcador de nenhum não é nome de acabamento nenhum", () => {
    expect(acabamentoCobravel(NENHUM_ACABAMENTO)).toBeNull();
    expect(ACABAMENTOS_COBRAVEIS.some((a) => a.acabamento === NENHUM_ACABAMENTO)).toBe(false);
  });
});

describe("cartão de cobrança", () => {
  const servicos = [
    { id: "s1", nome: "Acabamento de lona (bainha + ilhós)", unidade: "m", preco_base: 9 },
    { id: "s2", nome: "Laminação de adesivo", unidade: "m2", preco_base: 28 },
  ];
  const render = (props: Partial<Parameters<typeof CobrancaDoAcabamento>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(CobrancaDoAcabamento, {
        acabamentos: [{ nome: "Bainha + ilhós", padrao: true }],
        servicos,
        peca: { largura: 3, altura: 1, quantidade: 1 },
        jaNoOrcamento: new Set<string>(),
        onAdicionar: () => {},
        ...props,
      }),
    );

  it("mostra a conta e o botão que acrescenta a linha", () => {
    const html = render();
    expect(html).toContain("8 m");
    expect(html).toContain("72,00");
    expect(html).toContain("Adicionar ao orçamento");
  });

  it("a bainha mostra as três opções de lados, cada uma com a metragem e o valor", () => {
    const html = render();
    expect(html).toContain("Contorno todo");
    expect(html).toContain("Só os 2 lados maiores");
    expect(html).toContain("Só os 2 lados menores");
    expect(html).toMatch(/6 m · R\$\s54,00/); // 2 lados maiores de 3 m
    expect(html).toMatch(/2 m · R\$\s18,00/); // 2 lados menores de 1 m
    // o acabamento (botão) e o lado (cartão) vêm marcados: dois, e cada um desmarca ao tocar de novo
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
  });

  // O botão (ou cartão) marcado cujo conteúdo é exatamente este título.
  const marcado = (html: string, titulo: string) =>
    new RegExp(`<button[^>]*aria-pressed="true"[^>]*>(?:(?!</button>)[\\s\\S])*${titulo}`).test(html);

  it("no banner a sugestão já vem nos lados menores", () => {
    const html = render({ nomeDoProduto: "Banner com bastão e corda" });
    expect(marcado(html, "Só os 2 lados menores")).toBe(true);
    expect(marcado(html, "Contorno todo")).toBe(false);
  });

  it("o acabamento aparece como botão marcado mesmo quando é o único, para poder desmarcar", () => {
    const html = render();
    expect(marcado(html, "Bainha \\+ ilhós")).toBe(true);
    expect(html).toContain("opcional");
    expect(html).toContain("Para não cobrar, toque de novo no que está marcado.");
    expect(html).not.toContain("Nenhum acabamento será cobrado à parte");
  });

  it("o serviço que cobra vem da coluna do acabamento, mesmo com outro nome", () => {
    const html = render({
      acabamentos: [{ nome: "Bainha + ilhós", padrao: true, servicoId: "x9" }],
      servicos: [{ id: "x9", nome: "Bainha da casa", unidade: "m", preco_base: 10 }],
    });
    expect(html).toContain("80,00"); // 8 m × R$ 10
  });

  it("a laminação não pergunta os lados", () => {
    const html = render({ acabamentos: [{ nome: "Laminação de adesivo", padrao: false }] });
    expect(html).not.toContain("Contorno todo");
    expect(html).toContain("84,00"); // 3 m² × R$ 28
  });

  it("some quando o serviço já é linha do orçamento", () => {
    expect(render({ jaNoOrcamento: new Set(["s1"]) })).toBe("");
  });

  it("some sem medida e quando o acabamento não tem serviço com preço", () => {
    expect(render({ peca: { largura: 0, altura: 0, quantidade: 1 } })).toBe("");
    expect(render({ acabamentos: [{ nome: "Corte a laser (CNC Laser)", padrao: false }] })).toBe(
      "",
    );
  });
});

describe("o componente deixa desmarcar (contrato do código)", () => {
  const fonte = readFileSync("src/components/orcamento/cobranca-do-acabamento.tsx", "utf8");
  it("o acabamento e o lado marcados desmarcam ao toque e nada fica marcado no lugar", () => {
    expect(fonte).toContain("alternarEscolha(lados, o.chave)");
    expect(fonte).toContain("alternarEscolha(atual?.regra.acabamento ?? null, regra.acabamento)");
    expect(fonte).toContain("NENHUM_ACABAMENTO");
    expect(fonte).toContain('data-testid="cobranca-nenhuma"');
  });
  it("sem lado marcado ou sem quantidade, o botão de acrescentar fica desligado", () => {
    expect(fonte).toContain("disabled={desabilitado || !(quantidade > 0)}");
    expect(fonte).toContain("Marque os lados para ver o valor.");
  });
  it("só o clique em Adicionar grava a linha: desmarcar nunca cobra nem apaga nada", () => {
    // do comentário do botão do acabamento até o cartão da cobrança: só marca e desmarca
    const desmarcar = fonte.slice(
      fonte.indexOf("// Tocar no marcado desmarca"),
      fonte.indexOf("{atual ? ("),
    );
    expect(desmarcar.length).toBeGreaterThan(0);
    expect(desmarcar).not.toContain("onAdicionar");
    expect(desmarcar).not.toContain("inserirLinhaDeAcabamento");
  });
});

describe("a tela da equipe", () => {
  const tela = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  it("só mostra a cobrança a quem vê preço e nada é cobrado sozinho", () => {
    expect(tela).toContain("canSeePrices && vendidoPorArea");
    expect(tela).toContain("onAdicionar={adicionarCobrancaDeAcabamento}");
    // a linha só nasce pelo clique: o salvar do item não chama a cobrança
    const salvar = tela.slice(
      tela.indexOf("async function salvarItem"),
      tela.indexOf("async function removerItem"),
    );
    expect(salvar).not.toContain("inserirLinhaDeAcabamento");
  });
});
