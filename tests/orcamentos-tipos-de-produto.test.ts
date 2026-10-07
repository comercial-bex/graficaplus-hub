import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TIPOS_DE_PRODUTO,
  acabamentosDoTexto,
  agruparPorTipo,
  alternarAcabamento,
  camposDaUnidade,
  chaveDoTipo,
  temAcabamento,
  tipoPelaChave,
  tipoPeloRotulo,
  unidadeAoEscolherTipo,
  type ChaveDoTipo,
} from "../src/domain/orcamentos/tipos-de-produto";
import { fraseDoResumo } from "../src/domain/orcamentos/resumo-do-item";
import { dicaCampo } from "../src/lib/dicas";

/**
 * Escolha visual do produto no orçamento (07/10/2026).
 *
 * O tipo (lona, adesivo, placa…) sai da categoria do catálogo, refinada pelo
 * nome e pela unidade nos três casos em que a categoria mistura. O retrato do
 * catálogo vivo de 06/10/2026 (46 produtos, todos ativos) está na fixture:
 * cada produto tem a sua linha na tabela abaixo, então um produto que mude de
 * tipo por acidente aparece aqui, não na tela do vendedor.
 */

type ProdutoDaFixture = {
  id: string;
  sku: string | null;
  nome: string;
  categoria: string;
  tipo: string;
  unidade: string;
  preco_base: number | null;
  area_minima_cobrada: number | null;
};

const PRODUTOS: ProdutoDaFixture[] = JSON.parse(
  readFileSync("tests/fixtures/produtos-06-10.json", "utf8"),
);

/** Para onde cada produto do catálogo vai. Linha nova no catálogo = linha nova aqui. */
const ESPERADO: Record<string, ChaveDoTipo> = {
  // impressao_grande_formato: lona por m², papel por unidade
  "Impressão A3 colorida": "papel",
  "Impressão A4 colorida": "papel",
  "Lona 280g impressa": "lona",
  "Lona 440g reforçada impressa": "lona",
  // adesivos: tudo adesivo, inclusive os de campanha vendidos por unidade
  "Adesivo jateado": "adesivo",
  "Adesivo perfurado (one way)": "adesivo",
  "Adesivo Perfurado 90 × 33 cm": "adesivo",
  "Adesivo Perfurado 90 × 50 cm": "adesivo",
  "Adesivo Praguinha 10 × 10 cm": "adesivo",
  "Adesivo Praguinha 7 × 7 cm": "adesivo",
  "Adesivo vinil branco impresso": "adesivo",
  "Adesivo vinil recortado": "adesivo",
  "Bola Leitoso 33 × 33 cm": "adesivo",
  "Bolão Leitoso 48 × 48 cm": "adesivo",
  "Pragão 15 × 15 cm": "adesivo",
  "Pragão 30 × 30 cm": "adesivo",
  "Testeira 90 × 12 cm": "adesivo",
  // comunicacao_visual: banner e fachada são lona; o resto é chapa
  "Acrílico Espelhado Recortado 2mm": "placa",
  "Acrílico Virgem Recortado 2mm": "placa",
  "Acrílico Virgem Recortado 3mm": "placa",
  "Banner com bastão e corda": "lona",
  "Banner com bastão e corda (Terceirizado)": "lona",
  "Fachada luminosa em lona": "lona",
  "Letra caixa em PVC": "placa",
  "Placa ACM 3mm com adesivo": "placa",
  "Placa PS 2mm com adesivo": "placa",
  "Placa PVC expandido 3mm": "placa",
  "Quadro Acrilico": "placa",
  // brindes: o milheiro de papel é gráfica rápida
  "BOLSA TERMICA 30L": "brinde",
  "CANETA BASICA PERSONALIZADA": "brinde",
  "Cartão de visita 4x4 (milheiro)": "papel",
  "CHAVEIRO ACRILICO": "brinde",
  "COPO TERMICO 500ML": "brinde",
  "COPO TIPO CUIA 380ML": "brinde",
  "KIT CHURRASCO 3PÇ": "brinde",
  "KIT CHURRASCO LONGO 2PÇ": "brinde",
  "NECESSAIRE PERSONALIZADA": "brinde",
  "Panfleto A5 4x4 (milheiro)": "papel",
  // acabamento, instalação e serviço
  "Acabamento de lona (bainha + ilhós)": "acabamento",
  "Laminação de adesivo": "acabamento",
  Deslocamento: "servico",
  "Instalação em campo": "servico",
  "Criação/arte final": "servico",
  "Impressão 3D (serviço)": "impressao_3d",
  // outros: os dois kits são brinde
  "KIT CHURRASCO 12PÇ": "brinde",
};

/** Produtos que PODEM cair em "Outros" sem ser defeito. Hoje, nenhum. */
const OUTROS_PERMITIDOS: string[] = [];

describe("o tipo de cada produto do catálogo", () => {
  it("a fixture é o retrato do catálogo: 46 produtos, ids únicos, todos com categoria do enum", () => {
    expect(PRODUTOS).toHaveLength(46);
    expect(new Set(PRODUTOS.map((p) => p.id)).size).toBe(46);
    const categorias = new Set([
      "impressao_grande_formato",
      "adesivos",
      "comunicacao_visual",
      "brindes",
      "acabamento",
      "instalacao",
      "servico",
      "outros",
    ]);
    for (const p of PRODUTOS) expect(categorias.has(p.categoria), p.nome).toBe(true);
  });

  it("todo produto tem linha na tabela e vai para o tipo esperado", () => {
    for (const p of PRODUTOS) {
      expect(ESPERADO[p.nome], `falta a linha de "${p.nome}" na tabela do teste`).toBeDefined();
      expect(chaveDoTipo(p), p.nome).toBe(ESPERADO[p.nome]);
    }
  });

  it("nenhum produto cai em Outros sem estar na lista de permitidos", () => {
    const emOutros = PRODUTOS.filter((p) => chaveDoTipo(p) === "outros").map((p) => p.nome);
    expect(emOutros.sort()).toEqual([...OUTROS_PERMITIDOS].sort());
  });

  it("agrupar segue a ordem da tela e só mostra tipo com produto", () => {
    const grupos = agruparPorTipo(PRODUTOS);
    expect(grupos.map((g) => g.tipo.chave)).toEqual([
      "lona",
      "adesivo",
      "placa",
      "papel",
      "brinde",
      "acabamento",
      "servico",
      "impressao_3d",
    ]);
    expect(grupos.reduce((s, g) => s + g.produtos.length, 0)).toBe(46);
    // O que o vendedor mais pede fica em cima e com os produtos certos dentro.
    expect(grupos[0].produtos.map((p) => p.nome)).toEqual([
      "Lona 280g impressa",
      "Lona 440g reforçada impressa",
      "Banner com bastão e corda",
      "Banner com bastão e corda (Terceirizado)",
      "Fachada luminosa em lona",
    ]);
  });

  it("todo tipo tem ícone, rótulo, descrição e unidade padrão; o rótulo reabre o tipo", () => {
    for (const t of TIPOS_DE_PRODUTO) {
      expect(t.icone).toBeTruthy();
      expect(t.rotulo.length).toBeGreaterThan(2);
      expect(t.descricao.length).toBeGreaterThan(10);
      expect(t.unidadePadrao).toBeTruthy();
      // O rótulo curto é o gravado em tipo_produto e cabe na coluna de 46 pt do PDF.
      expect(t.rotuloCurto.length, t.rotuloCurto).toBeLessThanOrEqual(10);
      expect(t.rotuloCurto).not.toContain(" ");
      // Os dois rótulos voltam ao mesmo tipo, com ou sem acento e caixa.
      expect(tipoPeloRotulo(t.rotuloCurto)?.chave).toBe(t.chave);
      expect(tipoPeloRotulo(t.rotulo)?.chave).toBe(t.chave);
      expect(tipoPeloRotulo(t.rotulo.toUpperCase())?.chave).toBe(t.chave);
    }
    // O que o vendedor já digitava à mão ("Adesivo", "lona") reabre no tipo certo.
    expect(tipoPeloRotulo("adesivo")?.chave).toBe("adesivo");
    expect(tipoPeloRotulo(" LONA ")?.chave).toBe("lona");
    expect(tipoPeloRotulo("Servico")?.chave).toBe("servico");
    // Texto que não é um tipo fica sem tipo — não vira "Outros" calado.
    expect(tipoPeloRotulo("Adesivo vinil fosco")).toBeNull();
    expect(tipoPeloRotulo("")).toBeNull();
    expect(tipoPelaChave("inexistente").chave).toBe("outros");
  });

  it("item fora do catálogo: item novo pega a unidade do tipo; em edição fica a que tinha", () => {
    const lona = tipoPelaChave("lona");
    const brinde = tipoPelaChave("brinde");
    // formulário novo começa em "un": a lona avulsa vira m² e a medida aparece
    expect(unidadeAoEscolherTipo(lona, { unidade: "un", tinhaProduto: false, editando: false })).toBe("m2");
    expect(unidadeAoEscolherTipo(brinde, { unidade: "m2", tinhaProduto: false, editando: false })).toBe("un");
    // saindo de um produto do catálogo, a unidade dele não serve mais
    expect(unidadeAoEscolherTipo(lona, { unidade: "mil", tinhaProduto: true, editando: true })).toBe("m2");
    // editando item livre: a unidade escolhida por alguém fica
    expect(unidadeAoEscolherTipo(lona, { unidade: "un", tinhaProduto: false, editando: true })).toBe("un");
    expect(unidadeAoEscolherTipo(lona, { unidade: " ", tinhaProduto: false, editando: true })).toBe("m2");
  });

  it("a regra desempata pelo nome quando a categoria mistura", () => {
    // categoria nova com "lona" no nome vai para lona; sem pista, placa
    expect(chaveDoTipo({ nome: "Faixa de lona 4 × 1", categoria: "comunicacao_visual", unidade: "un" })).toBe("lona");
    expect(chaveDoTipo({ nome: "Totem em ACM", categoria: "comunicacao_visual", unidade: "un" })).toBe("placa");
    // grande formato sem ser m² e sem pista de lona é papel
    expect(chaveDoTipo({ nome: "Impressão A2", categoria: "impressao_grande_formato", unidade: "un" })).toBe("papel");
    expect(chaveDoTipo({ nome: "Papel fotográfico", categoria: "impressao_grande_formato", unidade: "m²" })).toBe("lona");
    // brinde em milheiro é papel; copo em unidade é brinde
    expect(chaveDoTipo({ nome: "Flyer 10 × 15", categoria: "brindes", unidade: "mil" })).toBe("papel");
    expect(chaveDoTipo({ nome: "Squeeze", categoria: "brindes", unidade: "un" })).toBe("brinde");
    // outros sem pista fica em outros — e aparece no cartão "Outros", não some
    expect(chaveDoTipo({ nome: "Taxa de urgência", categoria: "outros", unidade: "un" })).toBe("outros");
    expect(chaveDoTipo({ nome: "Qualquer coisa", categoria: "categoria_que_nao_existe", unidade: "un" })).toBe("outros");
  });
});

describe("o que o formulário pergunta por unidade", () => {
  it("m² pede medida; as outras unidades pedem só quantidade, com o rótulo certo", () => {
    expect(camposDaUnidade("m2").medidas).toBe(true);
    expect(camposDaUnidade("m²").medidas).toBe(true);
    expect(camposDaUnidade("M2 ").medidas).toBe(true);
    for (const u of ["un", "mil", "m", "h", "km", "kg", "lote", "peca", "", null, undefined]) {
      expect(camposDaUnidade(u).medidas, String(u)).toBe(false);
    }
    expect(camposDaUnidade("mil").rotuloQuantidade).toBe("Milheiros (1.000 folhas cada)");
    expect(camposDaUnidade("m").rotuloQuantidade).toBe("Metros lineares");
    expect(camposDaUnidade("h").rotuloQuantidade).toBe("Horas");
    expect(camposDaUnidade("km").rotuloQuantidade).toBe("Quilômetros");
    expect(camposDaUnidade("un").rotuloQuantidade).toBe("Quantidade");
    expect(camposDaUnidade("m2").rotuloQuantidade).toBe("Quantidade de peças");
  });

  it("o passo do contador é inteiro para peça e meio para metro e hora", () => {
    expect(camposDaUnidade("un").passo).toBe(1);
    expect(camposDaUnidade("mil").passo).toBe(1);
    expect(camposDaUnidade("m").passo).toBe(0.5);
    expect(camposDaUnidade("h").passo).toBe(0.5);
  });

  it("toda unidade do catálogo vivo tem rótulo próprio (não o genérico por engano)", () => {
    const unidades = new Set(PRODUTOS.map((p) => p.unidade));
    expect([...unidades].sort()).toEqual(["h", "km", "m", "m2", "mil", "un"]);
    for (const u of unidades) {
      const c = camposDaUnidade(u);
      expect(c.unidadeLegivel, u).toBeTruthy();
      if (u !== "un") expect(c.rotuloQuantidade, u).not.toBe("Quantidade");
    }
  });
});

describe("acabamento em chips sobre o campo livre", () => {
  it("lê a lista do texto e marca o que está escrito, sem ligar para caixa e acento", () => {
    expect(acabamentosDoTexto("bainha + ilhós, refile")).toEqual(["bainha + ilhós", "refile"]);
    expect(acabamentosDoTexto("")).toEqual([]);
    expect(acabamentosDoTexto(null)).toEqual([]);
    expect(temAcabamento("Bainha + Ilhos, refile", "bainha + ilhós")).toBe(true);
    expect(temAcabamento("refile", "laminação")).toBe(false);
  });

  it("alternar liga e desliga o termo preservando o que foi digitado à mão", () => {
    expect(alternarAcabamento("", "refile")).toBe("refile");
    expect(alternarAcabamento("refile", "bainha + ilhós")).toBe("refile, bainha + ilhós");
    expect(alternarAcabamento("refile, bainha + ilhós", "refile")).toBe("bainha + ilhós");
    expect(alternarAcabamento("corte especial do cliente, refile", "refile")).toBe("corte especial do cliente");
  });
});

/** O Intl põe espaço duro entre "R$" e o número; a comparação ignora isso. */
const semEspacoDuro = (s: string) => s.replace(/\u00a0/g, " ");

describe("o resumo antes de adicionar", () => {
  it("item por m²: quantidade, nome, medida, área da peça e do lote, preço", () => {
    expect(
      semEspacoDuro(fraseDoResumo({
        descricao: "Lona 440g reforçada impressa",
        quantidade: 3,
        unidade: "m2",
        largura: 3,
        altura: 2,
        valorTotal: 1260,
      })),
    ).toBe("3 × Lona 440g reforçada impressa · 3,00 × 2,00 m = 6,00 m² a peça · 18,00 m² no total · R$ 1.260,00");
  });

  it("uma peça só não repete o total; sem preço a frase para na metragem", () => {
    expect(
      fraseDoResumo({ descricao: "Adesivo jateado", quantidade: 1, unidade: "m2", largura: 0.5, altura: 0.5 }),
    ).toBe("1 × Adesivo jateado · 0,50 × 0,50 m = 0,25 m² a peça");
  });

  it("mínimo aplicado aparece na frase — o vendedor vê por que a conta deu mais", () => {
    expect(
      semEspacoDuro(fraseDoResumo({
        descricao: "Acrílico Virgem Recortado 2mm",
        quantidade: 2,
        unidade: "m2",
        largura: 0.2,
        altura: 0.2,
        areaMinima: 0.1,
        valorTotal: 120,
      })),
    ).toBe(
      "2 × Acrílico Virgem Recortado 2mm · 0,20 × 0,20 m = 0,04 m² a peça · 0,08 m² no total · cobrado 0,20 m² (mínimo) · R$ 120,00",
    );
  });

  it("item por unidade, milheiro, metro e hora fala a unidade certa", () => {
    expect(semEspacoDuro(fraseDoResumo({ descricao: "COPO TERMICO 500ML", quantidade: 50, unidade: "un", valorTotal: 2000 }))).toBe(
      "50 unidades de COPO TERMICO 500ML · R$ 2.000,00",
    );
    expect(fraseDoResumo({ descricao: "Cartão de visita 4x4", quantidade: 2, unidade: "mil" })).toBe(
      "2 milheiros de Cartão de visita 4x4",
    );
    expect(fraseDoResumo({ descricao: "Acabamento de lona", quantidade: 1, unidade: "m" })).toBe(
      "1 metro de Acabamento de lona",
    );
    expect(fraseDoResumo({ descricao: "Instalação em campo", quantidade: 2.5, unidade: "h" })).toBe(
      "2,5 horas de Instalação em campo",
    );
  });

  it("sem descrição não inventa nome", () => {
    expect(fraseDoResumo({ descricao: "  ", quantidade: 0, unidade: "un" })).toBe("1 unidade de item sem descrição");
  });
});

describe("a tela", () => {
  const TELA = readFileSync("src/routes/_authenticated/orcamentos.$id.tsx", "utf8");
  const ESCOLHA = readFileSync("src/components/orcamento/escolha-de-produto.tsx", "utf8");
  const MEDIDAS = readFileSync("src/components/orcamento/medidas-da-peca.tsx", "utf8");

  it("usa a escolha visual, as medidas desenhadas e o resumo; o seletor antigo foi embora", () => {
    expect(TELA).toContain("<EscolhaDeProduto");
    expect(TELA).toContain("<MedidasDaPeca");
    expect(TELA).toContain("<QuantidadeDoItem");
    expect(TELA).toContain("<AcabamentoDoItem");
    expect(TELA).toContain("<ResumoDoItem");
    expect(TELA).not.toContain("OrcamentoProdutoPicker");
  });

  it("o que vai gravado não mudou: as mesmas colunas de sempre, sem coluna nova", () => {
    const campos = TELA.slice(TELA.indexOf("const campos: Record<string, unknown> = {"), TELA.indexOf("if (canSeePrices) {"));
    for (const coluna of ["descricao", "quantidade", "unidade", "largura", "altura", "acabamento", "tipo_produto", "especificacao", "produto_id", "origem_calculo"]) {
      expect(campos).toContain(`${coluna}:`);
    }
    expect(campos).not.toMatch(/tipo_chave|tipo_icone|chave_do_tipo/);
  });

  it("a edição reabre a escolha preenchida com o produto e o tipo do item", () => {
    expect(TELA).toContain("setTipoEscolhido(tipoDoItemGravado(i, catalogo.produtos))");
    expect(TELA).toContain("setItemLivre(!i.produto_id)");
    // trocar o produto na edição não apaga o que é do pedido
    expect(TELA).toContain("acabamento: editando ? form.acabamento");
    expect(TELA).toContain("especificacao: editando ? form.especificacao");
  });

  it("o tipo vai gravado pelo rótulo curto (coluna estreita do PDF), nunca o do cartão", () => {
    expect(TELA.match(/tipo_produto: tipo\.rotuloCurto/g)).toHaveLength(2);
    expect(TELA).not.toMatch(/tipo_produto: tipo\.rotulo\b(?!Curto)/);
    expect(TELA).toContain("unidadeAoEscolherTipo(tipo, {");
  });

  it("preço só para quem vê preço, nas duas pontas", () => {
    expect(TELA).toContain("verPreco={canSeePrices}");
    expect(TELA).toContain("valorTotal={canSeePrices ? valorUnitarioEfetivo * quantidadeForm : null}");
    expect(ESCOLHA).toContain("const preco = verPreco ? precoLegivel(p) : null");
  });

  it("o catálogo que não carrega diz que caiu, em vez de parecer vazio", () => {
    expect(ESCOLHA).toContain("não catálogo vazio");
  });

  it("cartões e chips têm 44 px no toque e andam com as setas", () => {
    expect(ESCOLHA).toContain("min-h-20");
    expect(ESCOLHA).toContain("min-h-[4.5rem]");
    expect(ESCOLHA).toContain('role="radiogroup"');
    expect(ESCOLHA).toContain("onKeyDown={moverFocoNaGrade}");
    expect(MEDIDAS).toContain("min-h-11");
  });

  it("as cinco dicas pedidas existem", () => {
    for (const campo of ["tipo_de_produto", "area_cobrada", "area_minima", "acabamento", "especificacao"]) {
      expect(dicaCampo("/orcamentos", campo), campo).toBeTruthy();
    }
    expect(MEDIDAS).toContain('dicaCampo("/orcamentos", "area_cobrada")');
    expect(MEDIDAS).toContain('dicaCampo("/orcamentos", "area_minima")');
  });
});
