import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import readXlsxFile from "read-excel-file/node";
import {
  casarLinhas,
  chaveDaColuna,
  lerNumeroBR,
  lerPlanilha,
  linhasDoFornecedor,
  montarPlano,
  nomeLegivel,
  normalizarCodigo,
  normalizarDescricao,
  semValores,
  unidadeDoPreco,
  type Celula,
  type ItemExistente,
  type LinhaDaPlanilha,
  type ModalidadeExistente,
  type SecaoExistente,
} from "../src/domain/catalogo/importacao";

/**
 * A sincronização com a planilha nova do fornecedor. A prévia tem de contar
 * como o banco conta (`catalogo_importar`) e o plano não pode apagar o que a
 * planilha não traz (mínimo, múltiplo e faixa de cada opção; a cor adicional
 * de quem não tem).
 *
 * Conferido também à mão em 05/10/2026 com a planilha real da LUGA (921
 * linhas): 921 iguais, nenhuma mudança — e, no banco, num ensaio desfeito, 58
 * itens aplicados sem mudar um campo.
 */

async function lerFixture(): Promise<Celula[][]> {
  const abas = await readXlsxFile(resolve(__dirname, "fixtures/catalogo-sincronizacao.xlsx"));
  return abas.find((a) => a.sheet === "dados")!.data as Celula[][];
}

const mod = (p: Partial<ModalidadeExistente> & Pick<ModalidadeExistente, "modalidade">): ModalidadeExistente => ({
  quantidadeMinima: null,
  multiplo: null,
  faixa: null,
  faixaMax: null,
  rotuloInferido: false,
  custo: null,
  adicionalPorCor: null,
  ...p,
});

const item = (p: Partial<ItemExistente> & Pick<ItemExistente, "id" | "codigoFornecedor" | "descricao">): ItemExistente => ({
  situacao: "ativo",
  secaoId: "s1",
  unidade: "unidade",
  quantidadeMinima: null,
  multiplo: null,
  quantidadeMinimaGravada: null,
  dimensoes: null,
  embalagem: null,
  eEmbalagem: false,
  observacao: null,
  ordem: 1,
  modalidades: [],
  ...p,
});

const SECOES: SecaoExistente[] = [
  { id: "s1", titulo: "AGENDAS", ordem: 1, especificacao: "Miolo 344 páginas" },
  { id: "s2", titulo: "CANETAS", ordem: 2, especificacao: null },
  { id: "s3", titulo: "Canetas", ordem: 3, especificacao: null },
];

const agenda = (id: string, codigo: string, descricao: string, ordem: number) =>
  item({
    id,
    codigoFornecedor: codigo,
    descricao,
    ordem,
    quantidadeMinima: 10,
    multiplo: 10,
    quantidadeMinimaGravada: 100,
    modalidades: [
      mod({ modalidade: "sem_gravacao", custo: 20.73, quantidadeMinima: 10, multiplo: 10 }),
      mod({ modalidade: "gravada_1_cor", custo: 22.38, quantidadeMinima: 100, adicionalPorCor: 0.77 }),
      mod({ modalidade: "gravada_mais_pagina", custo: 24.48, quantidadeMinima: 100 }),
    ],
  });

const ITENS: ItemExistente[] = [
  agenda("i1", "A100", "AGENDA LISA PRETA", 1),
  agenda("i2", "A101", "AGENDA LISA AZUL", 2),
  agenda("i3", "A102", "AGENDA LISA VINHO", 3),
  item({
    id: "i4",
    codigoFornecedor: "C1",
    descricao: "CANETA PLÁSTICA AZUL",
    secaoId: "s2",
    ordem: 4,
    quantidadeMinimaGravada: 100,
    modalidades: [mod({ modalidade: "sem_gravacao", custo: 0.76 }), mod({ modalidade: "gravacao_laser", custo: 1.96, quantidadeMinima: 100 })],
  }),
  item({
    id: "i5",
    codigoFornecedor: "C2",
    descricao: "CANETA DE METAL PRATA",
    secaoId: "s3",
    ordem: 5,
    quantidadeMinimaGravada: 100,
    modalidades: [
      mod({ modalidade: "sem_gravacao", custo: 1.6 }),
      mod({ modalidade: "gravacao_laser", custo: 2.8, quantidadeMinima: 100 }),
      // A planilha nova não traz mais esta opção: "outra mudança".
      mod({ modalidade: "gravada_1_cor", custo: 3 }),
    ],
  }),
  item({ id: "i6", codigoFornecedor: "C3", descricao: "Caneta de Metal Preta", secaoId: "s3", situacao: "fora_da_tabela", ordem: 10001 }),
  item({ id: "i7", codigoFornecedor: "Z9", descricao: "ITEM QUE SAIU DA TABELA", ordem: 7, modalidades: [mod({ modalidade: "sem_gravacao", custo: 5 })] }),
];

describe("leitura da planilha", () => {
  it("lê o modelo da LUGA: pula linha vazia, separa outro fornecedor, entende custo em texto pt-BR", async () => {
    const lida = lerPlanilha(await lerFixture());
    expect(lida.problemas).toEqual([]);
    expect(lida.linhas).toHaveLength(9);
    const { linhas, outros } = linhasDoFornecedor(lida.linhas, "Fornecedor Teste");
    expect(linhas).toHaveLength(8);
    expect(outros).toEqual(["Outra Fábrica"]);
    expect(linhas.find((l) => l.codigo === "A102")!.custos.sem_gravacao).toBe(19.999);
    expect(linhas.find((l) => l.codigo === "436L")!.unidade).toBe("pacote");
    expect(linhas.find((l) => l.codigo === "14L")!.unidade).toBe("milheiro");
    expect(linhas[0].edicao).toBe("OUTUBRO 2026 nº 11");
  });

  it("número pt-BR: vírgula sozinha é decimal (custo de argola é R$ 0,146, não 146)", () => {
    expect(lerNumeroBR("0,146")).toBe(0.146);
    expect(lerNumeroBR("1.234,56")).toBe(1234.56);
    expect(lerNumeroBR("1,234.56")).toBe(1234.56);
    expect(lerNumeroBR("12.5")).toBe(12.5);
    expect(lerNumeroBR("R$ 9,90")).toBe(9.9);
    expect(lerNumeroBR(20.73)).toBe(20.73);
    expect(lerNumeroBR("***")).toBeNull();
    expect(lerNumeroBR("")).toBeNull();
    expect(lerNumeroBR(null)).toBeNull();
    expect(lerNumeroBR("doze")).toBe("ilegivel");
  });

  it("a unidade do preço como a planilha da LUGA escreve", () => {
    expect(unidadeDoPreco("pacote com 10 unidades (ver observação)", null)).toBe("pacote");
    expect(unidadeDoPreco("conforme a coluna EMBALAGEM", "UNITÁRIO")).toBe("unidade");
    expect(unidadeDoPreco("conforme a coluna EMBALAGEM", "PACOTE C/2")).toBe("pacote");
    expect(unidadeDoPreco("Cento", null)).toBe("cento");
    expect(unidadeDoPreco(null, null)).toBe("unidade");
    expect(unidadeDoPreco("litro", null)).toBeNull();
  });

  it("cabeçalho escrito de qualquer jeito; linha com defeito vira problema com o número da linha", () => {
    expect(chaveDaColuna("Código")).toBe("codigo");
    expect(chaveDaColuna("Unidade do preço")).toBe("unidade_do_preco");
    const lida = lerPlanilha([
      ["Seção", "Código", "Descrição", "custo_sem_gravacao", "unidade_do_preco"],
      ["AGENDAS", "A1", "AGENDA", "10,50", "unidade"],
      ["AGENDAS", "A2", null, "1", "unidade"],
      ["AGENDAS", "A3", "AGENDA 3", "dez", "unidade"],
      ["AGENDAS", "A4", "AGENDA 4", "1", "litro"],
    ]);
    expect(lida.linhas.map((l) => l.codigo)).toEqual(["A1", "A3"]);
    expect(lida.linhas[0].custos.sem_gravacao).toBe(10.5);
    expect(lida.problemas.map((p) => p.linha)).toEqual([3, 4, 5]);
  });

  it("sem coluna obrigatória ou sem nenhuma coluna de custo, nada é lido", () => {
    expect(lerPlanilha([["codigo", "descricao"], ["A", "B"]]).problemas[0].mensagem).toMatch(/secao/);
    expect(lerPlanilha([["secao", "codigo", "descricao"], ["S", "A", "B"]]).problemas[0].mensagem).toMatch(/custo/);
    expect(lerPlanilha([["qualquer"], ["coisa"]]).problemas[0].mensagem).toMatch(/codigo/);
  });
});

describe("normalização igual à do banco", () => {
  it("código: só letras e números, maiúsculo, sem zero à esquerda (fornecedor_codigo_normalizado)", () => {
    expect(normalizarCodigo("05049")).toBe("5049");
    expect(normalizarCodigo("LG C14")).toBe("LGC14");
    expect(normalizarCodigo("6035/8ZN")).toBe("60358ZN");
    expect(normalizarCodigo("  ")).toBeNull();
  });

  it("valor em reais sai do texto (fornecedor_sem_valores)", () => {
    expect(semValores("JOGO SAI R$ 6,55 C/20 FLS")).toBe("JOGO SAI (valor na tabela) C/20 FLS");
    expect(normalizarDescricao("Agenda  lisa   PRETA")).toBe(normalizarDescricao("AGENDA LISA PRETA"));
  });

  it("nome legível para item novo, sem código e sem valor", () => {
    expect(nomeLegivel("AGENDA LISA PRETA DE MESA", "A100")).toBe("Agenda Lisa Preta de Mesa");
    // O pedaço numérico do código sai mesmo colado ("clique.12411"); a cor do código fica.
    expect(nomeLegivel('CANETA "AZUL" PLÁSTICA CLIQUE.12411', "12411 AZUL")).toBe('Caneta "Azul" Plástica Clique.');
    expect(nomeLegivel("REFIL JOGO SAI R$ 6,55", "14L")).not.toContain("R$");
  });
});

describe("prévia e plano", () => {
  it("conta como o banco: novo, subiu, desceu, outra, voltou, igual, saiu", async () => {
    const { linhas } = linhasDoFornecedor(lerPlanilha(await lerFixture()).linhas, "Fornecedor Teste");
    const { plano, previa } = montarPlano({ linhas, secoes: SECOES, itens: ITENS, arquivo: "teste.xlsx" });
    const cods = (l: { linha: LinhaDaPlanilha }[]) => l.map((x) => x.linha.codigo).sort();
    expect(cods(previa.novos)).toEqual(["14L", "436L"]);
    expect(cods(previa.subiram)).toEqual(["A101"]);
    expect(cods(previa.desceram)).toEqual(["A102"]);
    expect(cods(previa.outras)).toEqual(["C2"]);
    expect(cods(previa.voltaram)).toEqual(["C3"]);
    expect(previa.iguais).toBe(2);
    expect(previa.sairam.map((s) => s.id)).toEqual(["i7"]);
    expect(previa.secoesNovas).toEqual(["REFIL"]);
    expect(previa.subiram[0].custos).toEqual([{ modalidade: "sem_gravacao", antes: 20.73, depois: 21.5 }]);
    expect(previa.outras[0].custos).toEqual([{ modalidade: "gravada_1_cor", antes: 3, depois: null }]);
    expect(plano.edicao).toBe("OUTUBRO 2026 nº 11");
    expect(plano.itens).toHaveLength(8);
  });

  it("duas seções com o mesmo título continuam duas (as canetas da LUGA)", async () => {
    const { linhas } = linhasDoFornecedor(lerPlanilha(await lerFixture()).linhas, "Fornecedor Teste");
    const { plano } = montarPlano({ linhas, secoes: SECOES, itens: ITENS, arquivo: null });
    expect(plano.secoes.map((s) => [s.titulo, s.ordem, s.secao_id])).toEqual([
      ["AGENDAS", 1, "s1"],
      ["CANETAS", 2, "s2"],
      ["CANETAS", 3, "s3"],
      ["REFIL", 4, null],
    ]);
    const secaoDe = (cod: string) => {
      const it = plano.itens.find((i) => i.codigo_fornecedor === cod)!;
      return plano.secoes.find((s) => s.ref === it.secao_ref)!.secao_id;
    };
    expect(secaoDe("C1")).toBe("s2");
    expect(secaoDe("C2")).toBe("s3");
  });

  it("a opção que já existe leva junto mínimo, múltiplo e faixa; a cor adicional fica só onde já estava", async () => {
    const { linhas } = linhasDoFornecedor(lerPlanilha(await lerFixture()).linhas, "Fornecedor Teste");
    const { plano } = montarPlano({ linhas, secoes: SECOES, itens: ITENS, arquivo: null });
    const a100 = plano.itens.find((i) => i.item_id === "i1")!;
    const m = Object.fromEntries(a100.modalidades.map((x) => [x.modalidade, x]));
    expect(m.sem_gravacao).toMatchObject({ quantidade_minima: 10, multiplo: 10, adicional_por_cor: null });
    expect(m.gravada_1_cor).toMatchObject({ quantidade_minima: 100, adicional_por_cor: 0.77 });
    // A linha traz 0,77 de cor adicional; o "silk + 1ª página" nunca teve e continua sem.
    expect(m.gravada_mais_pagina).toMatchObject({ quantidade_minima: 100, adicional_por_cor: null });
    // Nome, especificação e foto são da equipe: o item que já existe não manda nome.
    expect("nome" in a100).toBe(false);
  });

  it("item novo ganha nome legível, sem valor em reais; a observação da equipe não some", async () => {
    const { linhas } = linhasDoFornecedor(lerPlanilha(await lerFixture()).linhas, "Fornecedor Teste");
    const comNota = ITENS.map((i) => (i.id === "i4" ? { ...i, observacao: "Nota da equipe" } : i));
    const { plano } = montarPlano({ linhas, secoes: SECOES, itens: comNota, arquivo: null });
    const refil = plano.itens.find((i) => i.codigo_fornecedor === "14L")!;
    expect(refil.item_id).toBeNull();
    expect(refil.nome).toMatch(/^Refil Grande/);
    expect(refil.nome).not.toContain("R$");
    expect(refil.modalidades).toEqual([
      expect.objectContaining({ modalidade: "valor_unico", custo: 327.27, quantidade_minima: 1000, multiplo: 1000 }),
    ]);
    expect(plano.itens.find((i) => i.item_id === "i4")!.observacao).toBe("Nota da equipe");
  });
});

describe("casamento linha × item", () => {
  const linha = (codigo: string, descricao: string): LinhaDaPlanilha => ({
    linhaNaPlanilha: 2,
    fornecedor: null,
    secao: "S",
    ordemSecao: 1,
    especificacao: null,
    codigo,
    descricao,
    dimensoes: null,
    embalagem: null,
    unidade: "unidade",
    quantidadeMinima: null,
    multiplo: null,
    quantidadeMinimaGravada: null,
    adicionalPorCor: null,
    eEmbalagem: false,
    observacao: null,
    pagina: null,
    linhaDaTabela: null,
    edicao: null,
    custos: { sem_gravacao: 1 },
  });

  it("descrição corrigida: uma linha e um item com o mesmo código casam", () => {
    expect(casarLinhas([linha("K1", "CANETA AZUL ROYAL")], [item({ id: "x", codigoFornecedor: "K1", descricao: "CANETA AZUL" })])).toEqual(["x"]);
  });

  it("ambíguo (duas e duas com descrição nova) não casa à força — e a prévia avisa", () => {
    const itens = [
      item({ id: "a", codigoFornecedor: "K2", descricao: "A" }),
      item({ id: "b", codigoFornecedor: "K2", descricao: "B" }),
    ];
    const linhas = [linha("K2", "C"), linha("K2", "D")];
    expect(casarLinhas(linhas, itens)).toEqual([null, null]);
    const { previa } = montarPlano({ linhas, secoes: [], itens, arquivo: null });
    expect(previa.novos).toHaveLength(2);
    expect(previa.sairam).toHaveLength(2);
    expect(previa.avisos[0]).toMatch(/K2/);
  });

  it("linha repetida: a primeira fica com o item, a segunda é nova (a trava do banco exige essa ordem)", () => {
    const itens = [item({ id: "x", codigoFornecedor: "0K3", descricao: "IGUAL" })];
    expect(casarLinhas([linha("K3", "igual"), linha("K3", "IGUAL")], itens)).toEqual(["x", null]);
  });
});
