import { describe, expect, it } from "vitest";
import { DocumentoPDF, type DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";
import type { Empresa } from "../src/lib/pdf/empresa";
import { CORES_DA_MARCA, FAIXA_DA_MARCA } from "../src/lib/marca";
import { pngMinusculo, textoDoPdf } from "./apoio/pdf";

/**
 * O visual da referência do dono (27/10/2026, o orçamento 142 redesenhado):
 * o que mudou no documento e o que NÃO pode mudar.
 *
 *   - o bloco LAYOUT vira cartões, um por item, com o nome do item na barra;
 *   - o rodapé repete endereço, telefone e e-mail da empresa;
 *   - o desconto fica na aba ao lado de ENDEREÇO: ENTREGA, e o total embaixo;
 *   - a faixa e a logo escura são da Bex Print — o documento do parceiro sai
 *     com a cor dele e NENHUMA cor da marca da gráfica.
 */

const bexPrint: Empresa = {
  nome: "BEX PRINT",
  razao_social: "Bex Print Gráfica e Comunicação Visual LTDA",
  cnpj: "68.726.406/0001-90",
  endereco: "Rua Cândido Mendes, 23",
  bairro: "Perpétuo Socorro",
  cidade: "Macapá",
  estado: "AP",
  cep: "68905-670",
  telefones: "(96) 98424-1205",
  email: "comercial@bexprint.com.br",
  cor: CORES_DA_MARCA.cyan,
  faixa: FAIXA_DA_MARCA,
  logo_escura_url: pngMinusculo(20, 20, 20),
  condicoes_gerais:
    "1 — Pagamento: 50% na entrada, na aprovação da arte, e 50% na entrega ou retirada.\n2 — Prazo de produção: 3 a 5 dias úteis após a aprovação da arte.",
};

// O 142 como está no banco: um item com arte (capa) e um sem.
const orcamento142: DocumentoPDFProps = {
  tipo: "orcamento",
  numero: 142,
  data_solicitacao: "26/10/2026",
  data_validade: "02/11/2026",
  vendedor: "Fernando Augusto",
  status: "enviado",
  empresa: bexPrint,
  cliente: { nome: "Felipe Clinica Reintegrar", telefone: "(96) 98402-1971" },
  itens: [
    {
      descricao: "Kit Pintura Reitegrar",
      especificacao: "PLA",
      tipo_produto: "3D",
      unidade: "un",
      quantidade: 100,
      valor_unitario: 15.97,
      valor_total: 1597,
      layout_url: pngMinusculo(30, 90, 200),
      layout_nome: "Foto do modelo — Kit Pintura Reitegrar",
    },
    {
      descricao: "CHAVEIRO ACRILICO",
      tipo_produto: "Brinde",
      acabamento: "embalagem individual, DTF",
      unidade: "un",
      quantidade: 400,
      valor_unitario: 7,
      valor_total: 2800,
    },
  ],
  subtotal: 4397,
  desconto: 0,
  total: 4397,
  pagamento: { forma: null, parcelas: 1 },
  parcelas: [{ numero: 1, valor: 4397, vencimento: null }],
  entrega: "Cliente retira na empresa",
  observacoes: null,
  mostrarValores: true,
};

const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

describe("o documento com o visual da referência", () => {
  it("o item com arte ganha um cartão com o próprio nome; o sem arte não ganha cartão", async () => {
    const texto = await textoDoPdf(orcamento142);
    expect(texto).toContain("LAYOUT - REFERÊNCIAS");
    // Na tabela e na barra do cartão.
    expect(vezes(texto, "Kit Pintura Reitegrar")).toBe(2);
    // O chaveiro não tem arte: aparece só na tabela.
    expect(vezes(texto, "CHAVEIRO ACRILICO")).toBe(1);
  }, 30_000);

  it("os blocos do modelo continuam todos, com os números do 142", async () => {
    const texto = await textoDoPdf(orcamento142);
    for (const trecho of [
      "Orçamento: Nº 142",
      "Razão Social: Felipe Clinica Reintegrar",
      "Data de Emissão: 26/10/2026",
      "PRODUTOS/SERVIÇOS",
      "Total Produtos R$ 4.397,00",
      "ENDEREÇO: ENTREGA",
      "Cliente retira na empresa",
      "Valor Desconto: R$ 0,00",
      "Valor Total do Orçamento: R$ 4.397,00",
      "PAGAMENTO",
      "Condições de Pagamento: 1x",
      "OBSERVAÇÃO",
      "1 — Pagamento: 50% na entrada",
      "Responsável: Fernando Augusto",
      "Data de expedição prevista: a combinar",
      "Esse orçamento é válido até 02/11/2026.",
      "Nome e CPF",
      "Página 1 de 1",
    ]) {
      expect(texto, `faltou "${trecho}"`).toContain(trecho);
    }
  }, 30_000);

  it("o rodapé repete o contato da empresa em cada página", async () => {
    const texto = await textoDoPdf({
      ...orcamento142,
      itens: Array.from({ length: 14 }, (_, i) => ({ ...orcamento142.itens[1], descricao: `Placa ${i + 1}` })),
    });
    expect(texto).toMatch(/Página 2 de 2/);
    for (const trecho of ["ENDEREÇO", "TELEFONE", "E-MAIL", "comercial@bexprint.com.br", "(96) 98424-1205"]) {
      expect(vezes(texto, trecho), `"${trecho}" não saiu nas duas páginas`).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);

  it("sem entrega o total sai solto, com o desconto em cima", async () => {
    const texto = await textoDoPdf({ ...orcamento142, entrega: null });
    expect(texto).not.toContain("ENDEREÇO: ENTREGA");
    expect(texto).toContain("Valor Desconto: R$ 0,00");
    expect(texto).toContain("Valor Total do Orçamento: R$ 4.397,00");
  }, 30_000);

  it("a via de produção leva o cartão de layout e nenhum valor", async () => {
    const texto = await textoDoPdf({
      ...orcamento142,
      mostrarValores: false,
      pagamento: null,
      parcelas: null,
      subtotal: null,
      desconto: null,
      total: 0,
    });
    expect(texto).toContain("LAYOUT - REFERÊNCIAS");
    expect(texto).toContain("VIA DE PRODUÇÃO");
    expect(texto).not.toContain("R$");
    expect(texto).not.toContain("Valor Desconto");
  }, 30_000);

  it("as cores da Bex Print entram no documento dela e em nenhum do parceiro", () => {
    const daGrafica = JSON.stringify(DocumentoPDF(orcamento142)).toLowerCase();
    for (const cor of FAIXA_DA_MARCA) expect(daGrafica).toContain(cor.toLowerCase());

    const doParceiro = JSON.stringify(
      DocumentoPDF({
        ...orcamento142,
        empresa: {
          nome: "Gráfica do Zé",
          cor: "#1d4ed8",
          telefones: "(96) 99111-2233",
          condicoes_gerais: "Pix na aprovação.",
        },
      }),
    ).toLowerCase();
    for (const cor of FAIXA_DA_MARCA) {
      expect(doParceiro, `${cor} apareceu no documento do parceiro`).not.toContain(cor.toLowerCase());
    }
    expect(doParceiro).not.toContain("fundo-escuro");
    expect(doParceiro).not.toContain("bex");
    // A faixa e os cartões do parceiro saem na cor dele.
    expect(doParceiro).toContain("#1d4ed8");
  });
});
