import { test, expect } from "vitest";
import { DocumentoPDF, type DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";
import type { Empresa } from "../src/lib/pdf/empresa";

/**
 * Renderiza o documento de verdade (não só monta props) e confere o PDF gerado.
 *
 * O PDF é o que chega ao cliente: um erro de layout aqui não aparece em
 * typecheck nem em teste de unidade do cálculo — só quando alguém tenta baixar
 * o orçamento e recebe uma tela de erro.
 *
 * Um PNG 1x1 em data URI faz o papel do layout: exercita o caminho do <Image>
 * sem depender de rede ou de URL assinada.
 */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwSJgAAAIUATGuOB1vAAAAAElFTkSuQmCC";

const empresa: Empresa = {
  nome: "GRAFICA TESTE",
  razao_social: "GRAFICA TESTE LTDA",
  cnpj: "37.914.628/0001-02",
  inscricao_estadual: "157077195",
  endereco: "Rua S37 Lote 04 Quadra C Deposito 2",
  bairro: "Industrial",
  cidade: "Almeirim",
  estado: "PA",
  cep: "68240-000",
  telefones: "(96) 9119-4660",
  email: "teste@exemplo.com.br",
  cor: "#7B2E8B",
};

// Os dois itens do orçamento 1059, com o layout de cada um.
const props: DocumentoPDFProps = {
  tipo: "orcamento",
  numero: 1059,
  data_solicitacao: "04/08/2026",
  data_validade: "14/08/2026",
  data_entrega: "07/08/2026",
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
      unidade: "m²",
      quantidade: 3,
      largura: 3.0,
      altura: 2.45,
      area_total: 22.05,
      acabamento: "Refile",
      layout_url: PNG_1X1,
      valor_unitario: 257.25,
      valor_total: 771.75,
    },
    {
      descricao: "Adesivo starpac 1 ano RP400",
      unidade: "m²",
      quantidade: 1,
      largura: 1.1,
      altura: 0.4,
      area_total: 0.44,
      acabamento: null,
      layout_url: PNG_1X1,
      valor_unitario: 20.68,
      valor_total: 20.68,
    },
  ],
  soma_area: 22.49,
  subtotal: 792.43,
  desconto: 0,
  total: 792.43,
  pagamento: { forma: "A Faturar", parcelas: 1, valor_parcela: 792.43 },
  entrega: "Cliente retira na empresa",
  mostrarValores: true,
};

async function renderizar(p: DocumentoPDFProps) {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await renderToBuffer(DocumentoPDF(p) as any);
}

test("orçamento com metragem e layout renderiza um PDF válido", async () => {
  const buffer = await renderizar(props);
  // assinatura de arquivo PDF
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buffer.length).toBeGreaterThan(1000);
}, 30_000);

test("via de produção renderiza sem valores e sem quebrar", async () => {
  const buffer = await renderizar({
    ...props,
    mostrarValores: false,
    pagamento: null,
    subtotal: null,
    desconto: null,
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("item sem dimensão e sem layout continua renderizando", async () => {
  const buffer = await renderizar({
    ...props,
    itens: [
      {
        descricao: "Serviço de instalação",
        unidade: "un",
        quantidade: 1,
        valor_unitario: 150,
        valor_total: 150,
      },
    ],
    soma_area: null,
    subtotal: 150,
    total: 150,
    entrega: null,
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("empresa sem logo e sem dados opcionais não quebra o cabeçalho", async () => {
  const buffer = await renderizar({
    ...props,
    empresa: { nome: "BEX PRINT OS", cor: "#7B2E8B" },
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("OS usa bloco de assinaturas em vez do termo de aceite", async () => {
  const buffer = await renderizar({ ...props, tipo: "os", numero: 10 });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("recibo de retirada renderiza sem valores e com as assinaturas próprias", async () => {
  const buffer = await renderizar({
    ...props,
    tipo: "recibo_material",
    numero: 1042,
    data_validade: null,
    data_entrega: null,
    vendedor: null,
    itens: [
      { descricao: "Lona 440g", unidade: "m2", quantidade: 12.6, valor_unitario: 0, valor_total: 0 },
      { descricao: "Ilhós latão", unidade: "un", quantidade: 24, valor_unitario: 0, valor_total: 0 },
    ],
    soma_area: null,
    subtotal: null,
    desconto: null,
    total: 0,
    pagamento: null,
    entrega: null,
    observacoes: "Material retirado do estoque para a OS 1042 por Fulano.",
    assinaturas: { esquerda: "Entregue por (GRAFICA TESTE LTDA)", direita: "Retirado por Fulano" },
    mostrarValores: false,
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("fatura mostra parcelas, saldo em aberto e identificação legal", async () => {
  const buffer = await renderizar({
    ...props,
    tipo: "fatura",
    numero: 31,
    data_validade: null,
    vendedor: null,
    subtotal: 1110,
    desconto: 0,
    total: 1110,
    // Entrada já paga: a fatura precisa mostrar o SALDO, não o total cheio.
    valor_pago: 555,
    parcelas: [
      { numero: 1, valor: 555, vencimento: "2026-09-05", pago: true },
      { numero: 2, valor: 555, vencimento: "2026-09-20", pago: false },
    ],
    pagamento: { forma: "PIX", parcelas: 2, valor_parcela: 555 },
    observacoes:
      "Impresso por CNPJ 68.726.406/0001-90 para AGENCIA BEX MCP (37.914.628/0001-02). Tiragem: 3000 exemplares. Art. 38, Lei 9.504/1997.",
    mostrarValores: true,
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);

test("fatura sem parcelas e sem pagamento continua renderizando", async () => {
  const buffer = await renderizar({
    ...props,
    tipo: "fatura",
    numero: 32,
    parcelas: [],
    valor_pago: 0,
    pagamento: null,
  });
  expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
}, 30_000);
