import { describe, expect, it } from "vitest";
import type { DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";
import type { Empresa } from "../src/lib/pdf/empresa";
import { dataBR, descreverEntrega, parcelasDoAcordo, validadeAte } from "../src/lib/pdf/formato";
import { pngMinusculo, textoDoPdf } from "./apoio/pdf";

/**
 * O orçamento 1059 — o modelo que o dono mandou ("semelhante ao que já
 * fazemos") — montado como o sistema monta, renderizado de verdade e LIDO de
 * volta com o pdf.js. Conferir só o `%PDF-` do arquivo não pega uma caixa que
 * sumiu: aqui o texto de cada bloco do modelo precisa estar na folha.
 */

const empresa: Empresa = {
  nome: "GRAFICA DIGITAL PRINT",
  razao_social: "GRAFICA DIGITAL PRINT LTDA",
  cnpj: "37.914.628/0001-02",
  inscricao_estadual: "157077195",
  endereco: "RUA S37 LOTE 04 QUADRA C DEPOSITO 2, SN",
  bairro: "MONTE DOURADO - INDUSTRIAL",
  cidade: "Almeirim",
  estado: "PA",
  cep: "68240-000",
  telefones: "(96) 9119-4660",
  email: "g.3ddigital@gmail.com",
  cor: "#1d4ed8",
};

// Montado com as mesmas funções que o carregador usa: datas `date` do banco,
// parcelas da conversão e a caixa de entrega pelo modo.
const total = 792.43;
const modelo: DocumentoPDFProps = {
  tipo: "orcamento",
  numero: 1059,
  data_solicitacao: dataBR("2026-08-04T18:40:00+00:00"),
  data_validade: dataBR(validadeAte("2026-08-04T18:40:00+00:00", 10)),
  data_entrega: dataBR("2026-08-07"),
  data_expedicao: dataBR("2026-08-07"),
  vendedor: "FRANCYERICA SILVA ARAUJO",
  status: "aprovado",
  empresa,
  cliente: {
    nome: "AGENCIA BEX MCP",
    razao_social: "AGENCIA BEX MCP",
    cidade: "MACAPA",
    estado: "AP",
    telefone: "(96) 99111-6169",
    contato: "HARISSON",
  },
  itens: [
    {
      descricao: "Adesivo starpac 1 ano RP400",
      especificacao: "Vinil branco brilho, laminação fosca, recorte reto",
      unidade: "m2",
      quantidade: 3,
      largura: 3,
      altura: 2.45,
      area_total: 22.05,
      layout_url: pngMinusculo(30, 90, 200),
      layout_nome: "item1.png",
      valor_unitario: 257.25,
      valor_total: 771.75,
    },
    {
      descricao: "Adesivo starpac 1 ano RP400",
      unidade: "m2",
      quantidade: 1,
      largura: 1.1,
      altura: 0.4,
      area_total: 0.44,
      layout_url: pngMinusculo(0, 40, 140),
      layout_nome: "item2.png",
      layouts_extras: 2,
      valor_unitario: 20.68,
      valor_total: 20.68,
    },
  ],
  soma_area: 22.49,
  subtotal: total,
  desconto: 0,
  total,
  pagamento: { forma: "A Faturar", parcelas: 1 },
  parcelas: parcelasDoAcordo(total, { forma: "A Faturar", parcelas: 1 }),
  entrega: descreverEntrega({ precisa_entrega: false }),
  observacoes: null,
  mostrarValores: true,
};

describe("orçamento 1059, como no modelo", () => {
  it("tem cada bloco do modelo, com os números do modelo", async () => {
    const texto = await textoDoPdf(modelo);
    for (const trecho of [
      "Orçamento: Nº 1059",
      "GRAFICA DIGITAL PRINT LTDA",
      "CNPJ: 37.914.628/0001-02 - IE: 157077195",
      "Data de Emissão: 04/08/2026",
      "Razão Social: AGENCIA BEX MCP",
      "Telefone: (96) 99111-6169",
      "PRODUTOS/SERVIÇOS",
      "Dados Produtos/Serviços",
      "Acabamento",
      "Valor Total",
      "Adesivo starpac 1 ano RP400",
      "3,000m x 2,450m",
      "área: 22,050m²",
      "Metragem:",
      "R$ 257,25",
      "R$ 771,75",
      "Total Produtos R$ 792,43",
      "Soma área total: 22,490m²",
      "Vinil branco brilho, laminação fosca, recorte reto",
      "LAYOUT",
      "+2",
      "ENDEREÇO: ENTREGA",
      "Cliente retira na empresa",
      "Valor Desconto: R$ 0,00",
      "Valor Total do Orçamento: R$ 792,43",
      "PAGAMENTO",
      "Forma Pagto: A Faturar",
      "Condições de Pagamento: 1x",
      "OBSERVAÇÃO",
      "Responsável: FRANCYERICA SILVA ARAUJO",
      "Data de expedição prevista: 07/08/2026",
      "Esse orçamento é válido até 14/08/2026.",
      "Estou de acordo com o orçamento e autorizo gerar o pedido. Data ____/____/_______.",
      "Nome e CPF",
      "Página 1 de 1",
    ]) {
      expect(texto, `faltou "${trecho}"`).toContain(trecho);
    }
    // O prazo do orçamento fica só no rodapé (pedido do dono, 06/10/2026).
    expect(texto).not.toContain("Data de Entrega:");
    // A unidade sai em maiúsculas, como o modelo — e a quebra de linha logo
    // depois dela não ganha hífen ("RP400 - M²-" saía assim).
    expect(texto).toMatch(/RP400 - M²/);
    expect(texto).not.toMatch(/\S-\n/);
  }, 60_000);

  it("a descrição quebra nos espaços, sem hífen do inglês no meio da palavra", async () => {
    const texto = await textoDoPdf({
      ...modelo,
      itens: [
        {
          ...modelo.itens[0],
          descricao: "Fachada em lona 440g com estrutura metálica e iluminação",
        },
      ],
    });
    expect(texto).not.toMatch(/\S-\n/);
    expect(texto).toContain("estrutura");
  }, 60_000);

  it("parcelado com data mostra cada parcela com o vencimento", async () => {
    const texto = await textoDoPdf({
      ...modelo,
      pagamento: { forma: "Boleto", parcelas: 3 },
      parcelas: parcelasDoAcordo(1100, { parcelas: 3, primeiro_vencimento: "2026-10-20" }),
      total: 1100,
    });
    expect(texto).toContain("Condições de Pagamento: 3x");
    expect(texto).toContain("R$ 366,67");
    expect(texto).toContain("R$ 366,66");
    expect(texto).toContain("venc. 19/12/2026");
  }, 60_000);

  it("a via de produção não tem preço, pagamento, aceite nem custo", async () => {
    const texto = await textoDoPdf({
      ...modelo,
      mostrarValores: false,
      pagamento: null,
      parcelas: null,
      subtotal: null,
      desconto: null,
      total: 0,
      observacao_interna: "Cliente busca às 17h.",
      // Mesmo que alguém passe custo, a via de produção não o desenha.
      custos: { tarifas: [{ rotulo: "Energia", valor: "R$ 1,13/kWh" }] },
    });
    expect(texto).not.toContain("R$");
    expect(texto).not.toContain("USO INTERNO");
    expect(texto).not.toContain("PAGAMENTO");
    expect(texto).not.toContain("Estou de acordo");
    expect(texto).not.toContain("Nome e CPF");
    for (const trecho of [
      "VIA DE PRODUÇÃO",
      "Vinil branco brilho, laminação fosca, recorte reto",
      "Metragem:",
      "LAYOUT",
      "Cliente retira na empresa",
      "OBSERVAÇÃO INTERNA",
      "Cliente busca às 17h.",
      "Data de expedição prevista: 07/08/2026",
    ]) {
      expect(texto, `faltou "${trecho}"`).toContain(trecho);
    }
  }, 60_000);

  it("arte que não converteu vira a caixa com o nome — o resto do documento sai", async () => {
    const texto = await textoDoPdf({
      ...modelo,
      itens: [
        modelo.itens[0],
        {
          ...modelo.itens[1],
          layout_url: null,
          layout_sem_previa: true,
          layout_nome: "vitrine.webp",
        },
      ],
    });
    expect(texto).toContain("arte sem prévia: vitrine.webp");
    expect(texto).toContain("Valor Total do Orçamento: R$ 792,43");
  }, 60_000);

  it("entrega com instalação no lugar da retirada", async () => {
    const texto = await textoDoPdf({
      ...modelo,
      entrega: descreverEntrega({
        precisa_entrega: true,
        precisa_instalacao: true,
        endereco_entrega: { descricao: "Av. FAB, 1200, Centro, Macapá - AP" },
      }),
    });
    expect(texto).toContain("Av. FAB, 1200, Centro, Macapá - AP");
    expect(texto).toContain("Com instalação");
    expect(texto).not.toContain("Cliente retira na empresa");
  }, 60_000);
});
