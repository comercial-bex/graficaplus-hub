import { describe, expect, it } from "vitest";
import {
  acoesDoPedido,
  conferirPedido,
  conferirRecebimento,
  emAberto,
  faltaReceber,
  linhasDoPedido,
  numeroDoCampo,
  recebimentoCompleto,
  SEM_ENTRADA_NO_ESTOQUE,
  subtotalDaLinha,
  totalDoFormulario,
  totalDoPedido,
  type ItemDoPedido,
  type LinhaDoPedido,
  type PermissoesDeCompra,
} from "../src/components/compras/pedido";

/**
 * O pedido de compra aceitava UM material e gravava em duas chamadas soltas;
 * nunca foi usado (0 pedidos). Agora tem vários itens e o banco grava tudo de
 * uma vez. Estes testes travam as regras que a tela confere ANTES do banco —
 * as mesmas frases que `salvar_pedido_compra` e `receber_pedido_compra` usam.
 */

const NOMES: Record<string, string> = { lona: "Lona 440g reforçada", ilhos: "Ilhós metálico" };
const nomeDe = (id: string) => NOMES[id] ?? id;
const linha = (material_id: string, quantidade: string, custo_unitario: string, chave = material_id): LinhaDoPedido => ({
  chave,
  material_id,
  quantidade,
  custo_unitario,
});

describe("o formulário com vários itens", () => {
  it("soma o total linha a linha", () => {
    const linhas = [linha("lona", "10", "15.5"), linha("ilhos", "100", "0.4")];
    expect(subtotalDaLinha(linhas[0])).toBe(155);
    expect(totalDoFormulario(linhas)).toBe(195);
  });

  it("linha incompleta não soma (nem vira zero escondido no total)", () => {
    expect(subtotalDaLinha(linha("lona", "", "15"))).toBe(0);
    expect(totalDoFormulario([linha("lona", "2", "15"), linha("ilhos", "abc", "1")])).toBe(30);
  });

  it("campo vazio é nulo, não zero", () => {
    expect(numeroDoCampo("")).toBeNull();
    expect(numeroDoCampo("  ")).toBeNull();
    expect(numeroDoCampo("12,5")).toBe(12.5);
    expect(numeroDoCampo("0")).toBe(0);
    expect(numeroDoCampo("x")).toBeNull();
  });

  it("monta os itens para o banco e ignora a linha em branco do fim", () => {
    const r = conferirPedido({
      fornecedor: "Distribuidora Norte",
      linhas: [linha("lona", "10", "15.5"), linha("ilhos", "100", "0.4"), linha("", "", "", "nova")],
      registrar: true,
      nomeDe,
    });
    expect(r.problemas).toEqual([]);
    expect(r.itens).toEqual([
      { material_id: "lona", quantidade: 10, custo_unitario: 15.5 },
      { material_id: "ilhos", quantidade: 100, custo_unitario: 0.4 },
    ]);
  });

  it("material repetido é recusado com o nome — a tabela tem UNIQUE (pedido, material)", () => {
    const r = conferirPedido({
      fornecedor: "X",
      linhas: [linha("lona", "1", "1", "a"), linha("lona", "2", "1", "b")],
      registrar: true,
      nomeDe,
    });
    expect(r.problemas).toEqual([
      "O material Lona 440g reforçada aparece duas vezes. Junte as quantidades numa linha só.",
    ]);
  });

  it("quantidade e custo faltando são nomeados pelo material", () => {
    const r = conferirPedido({ fornecedor: "X", linhas: [linha("ilhos", "0", "")], registrar: true, nomeDe });
    expect(r.problemas).toEqual([
      "Informe a quantidade de Ilhós metálico.",
      "Informe o custo unitário de Ilhós metálico.",
    ]);
  });

  it("custo zero é permitido (brinde do fornecedor); negativo não", () => {
    expect(conferirPedido({ fornecedor: "X", linhas: [linha("ilhos", "5", "0")], registrar: true, nomeDe }).problemas).toEqual([]);
    expect(conferirPedido({ fornecedor: "X", linhas: [linha("ilhos", "5", "-1")], registrar: true, nomeDe }).problemas).toHaveLength(1);
  });

  it("linha começada sem material aponta o número da linha", () => {
    const r = conferirPedido({ fornecedor: "X", linhas: [linha("", "3", "", "a")], registrar: true, nomeDe });
    expect(r.problemas).toEqual(["Escolha o material da linha 1."]);
  });

  it("pedido sem nenhum material não sai", () => {
    const r = conferirPedido({ fornecedor: "X", linhas: [linha("", "", "")], registrar: true, nomeDe });
    expect(r.problemas).toEqual(["O pedido precisa de pelo menos um material."]);
  });

  it("fornecedor em branco é recusado", () => {
    const r = conferirPedido({ fornecedor: "  ", linhas: [linha("lona", "1", "1")], registrar: false, nomeDe });
    expect(r.problemas).toEqual(["Informe o fornecedor."]);
  });

  it("'A definir' serve para rascunho, não para registrar", () => {
    const base = { fornecedor: "A definir", linhas: [linha("lona", "1", "1")], nomeDe };
    expect(conferirPedido({ ...base, registrar: false }).problemas).toEqual([]);
    expect(conferirPedido({ ...base, registrar: true }).problemas).toEqual([
      "Defina o fornecedor antes de registrar o pedido.",
    ]);
  });
});

const ITENS: ItemDoPedido[] = [
  { id: "i1", material_id: "lona", quantidade: "12.0000", quantidade_recebida: "5.0000", custo_unitario: "15.0000", material: { nome: "Lona 440g reforçada", unidade: "m2" } },
  { id: "i2", material_id: "ilhos", quantidade: "100", quantidade_recebida: "0", custo_unitario: "0.4", material: { nome: "Ilhós metálico", unidade: "un" } },
];

describe("o pedido gravado", () => {
  it("total e quanto falta vêm dos itens", () => {
    expect(totalDoPedido(ITENS)).toBe(220);
    expect(faltaReceber(ITENS[0])).toBe(7);
    expect(faltaReceber({ quantidade: "3", quantidade_recebida: "3" })).toBe(0);
  });

  it("falta não erra na casa decimal (0,3 − 0,1 = 0,2)", () => {
    expect(faltaReceber({ quantidade: 0.3, quantidade_recebida: 0.1 })).toBe(0.2);
  });

  it("vira linhas do formulário para revisar", () => {
    let n = 0;
    expect(linhasDoPedido(ITENS, () => `k${++n}`)).toEqual([
      { chave: "k1", material_id: "lona", quantidade: "12", custo_unitario: "15" },
      { chave: "k2", material_id: "ilhos", quantidade: "100", custo_unitario: "0.4" },
    ]);
  });

  it("em aberto é o que ainda pede ação", () => {
    expect(["rascunho", "enviado", "recebido_parcial"].every(emAberto)).toBe(true);
    expect(emAberto("recebido")).toBe(false);
    expect(emAberto("cancelado")).toBe(false);
  });
});

describe("os botões de cada pedido", () => {
  const TODAS: PermissoesDeCompra = { criar: true, receber: true, darEntrada: true, cancelar: true };
  const nada = [{ quantidade: 5, quantidade_recebida: 0 }];

  it("rascunho se revisa e registra; não se recebe", () => {
    const a = acoesDoPedido({ status: "rascunho", itens: nada }, TODAS);
    expect(a).toMatchObject({ revisar: true, editar: false, receber: false, cancelar: true });
  });

  it("registrado sem nada recebido: edita, recebe e cancela", () => {
    expect(acoesDoPedido({ status: "enviado", itens: nada }, TODAS)).toMatchObject({
      revisar: false,
      editar: true,
      receber: true,
      cancelar: true,
    });
  });

  it("depois que algo chegou, não edita mais — o lote já foi gravado a partir dele", () => {
    const a = acoesDoPedido({ status: "recebido_parcial", itens: [{ quantidade: 5, quantidade_recebida: 2 }] }, TODAS);
    expect(a).toMatchObject({ editar: false, receber: true, cancelar: true });
  });

  it("recebido e cancelado são histórico", () => {
    for (const status of ["recebido", "cancelado"]) {
      const a = acoesDoPedido({ status, itens: [{ quantidade: 5, quantidade_recebida: 5 }] }, TODAS);
      expect(a).toMatchObject({ revisar: false, editar: false, receber: false, cancelar: false });
    }
  });

  it("quem tem compras.receive sem estoque.entry vê o porquê, não um botão que o banco recusa", () => {
    const a = acoesDoPedido({ status: "enviado", itens: nada }, { ...TODAS, darEntrada: false });
    expect(a.receber).toBe(false);
    expect(a.receberBloqueado).toBe(SEM_ENTRADA_NO_ESTOQUE);
  });

  it("o financeiro (só compras.read) olha e não mexe", () => {
    const a = acoesDoPedido({ status: "enviado", itens: nada }, { criar: false, receber: false, darEntrada: false, cancelar: false });
    expect(a).toEqual({ revisar: false, editar: false, receber: false, receberBloqueado: null, cancelar: false });
  });
});

describe("o recebimento", () => {
  it("vem preenchido com tudo o que falta", () => {
    expect(recebimentoCompleto(ITENS)).toEqual([
      { item_id: "i1", quantidade: "7", custo_unitario: "" },
      { item_id: "i2", quantidade: "100", custo_unitario: "" },
    ]);
  });

  it("parcial é a regra: linha zerada não chegou desta vez", () => {
    const r = conferirRecebimento(
      [
        { item_id: "i1", quantidade: "7", custo_unitario: "14" },
        { item_id: "i2", quantidade: "0", custo_unitario: "" },
      ],
      ITENS,
    );
    expect(r.problemas).toEqual([]);
    expect(r.itens).toEqual([{ item_id: "i1", quantidade: 7, custo_unitario: 14 }]);
  });

  it("custo em branco usa o do pedido (não manda custo)", () => {
    const r = conferirRecebimento([{ item_id: "i2", quantidade: "100", custo_unitario: "" }], ITENS);
    expect(r.itens).toEqual([{ item_id: "i2", quantidade: 100 }]);
  });

  it("chegar mais do que falta é recusado com material e unidade", () => {
    const r = conferirRecebimento([{ item_id: "i1", quantidade: "8", custo_unitario: "" }], ITENS);
    expect(r.problemas).toEqual(["De Lona 440g reforçada, faltam 7 m2 neste pedido e foram informados 8 m2."]);
  });

  it("nada informado não vira recebimento vazio", () => {
    const r = conferirRecebimento([{ item_id: "i1", quantidade: "", custo_unitario: "" }], ITENS);
    expect(r.problemas).toEqual(["Informe a quantidade que chegou de pelo menos um item."]);
  });
});
