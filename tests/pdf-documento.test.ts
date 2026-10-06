import { test, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import type { DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";
import type { Empresa } from "../src/lib/pdf/empresa";
import { renderizar, textoDoPdf } from "./apoio/pdf";

/**
 * Renderiza o documento de verdade (não só monta props) e confere o PDF gerado.
 *
 * O PDF é o que chega ao cliente: um erro de layout aqui não aparece em
 * typecheck nem em teste de unidade do cálculo — só quando alguém tenta baixar
 * o orçamento e recebe uma tela de erro. Cada tipo que usa o DocumentoPDF (OS,
 * fatura, recibo, orçamento 3D, via interna) passa por aqui com os blocos que
 * só ele tem.
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
  pagamento: { forma: "A Faturar", parcelas: 1 },
  parcelas: [{ numero: 1, valor: 792.43, vencimento: null }],
  entrega: "Cliente retira na empresa",
  mostrarValores: true,
};

const ehPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString("latin1") === "%PDF-";

// Pedido do dono no Lovable em 06/10/2026 ("Otimizou dados do cliente"). A
// leitura agora é do texto do PDF de verdade, não da árvore React: no
// documento novo os rótulos ficam dentro de componentes (Campo, Caixa).
test("orçamento identifica o cliente no cabeçalho com cinco campos e prazo somente no rodapé", async () => {
  const exemplo: DocumentoPDFProps = {
    ...props,
    cliente: {
      ...props.cliente,
      razao_social: "DISTRIBUIDORA ESTRELA LTDA.",
      documento: "12.147.968/0001-24",
      endereco: "DE DUCA SERRA, 1921, A",
      bairro: "MARABAIXO",
      telefone: "(96) 99157-8102",
      nome_fantasia: "FANTASIA OCULTA",
      inscricao_estadual: "IE OCULTA",
      email: "email-oculto@exemplo.com",
      cep: "CEP OCULTO",
      contato: "CONTATO OCULTO",
    },
  };
  const texto = await textoDoPdf(exemplo);
  for (const campo of ["Razão Social:", "CNPJ:", "Endereço:", "Telefone:", "Bairro:"]) {
    expect(texto).toContain(campo);
  }
  for (const campo of [
    "Nome Fantasia:",
    "Inscrição Estadual:",
    "CEP:",
    "Cidade:",
    "Celular:",
    "E-mail:",
    "Contato:",
    "Data de Entrega:",
  ]) {
    expect(texto).not.toContain(campo);
  }
  expect(texto.indexOf("Razão Social:")).toBeLessThan(texto.indexOf("Data de Emissão:"));
  expect(texto).toContain("Data de expedição prevista: 07/08/2026");
  if (process.env.PDF_QA_DIR) {
    await mkdir(process.env.PDF_QA_DIR, { recursive: true });
    await writeFile(`${process.env.PDF_QA_DIR}/orcamento.pdf`, await renderizar(exemplo));
    await writeFile(
      `${process.env.PDF_QA_DIR}/orcamento-longo.pdf`,
      await renderizar({
        ...exemplo,
        cliente: {
          ...exemplo.cliente,
          razao_social: "DISTRIBUIDORA DE PRODUTOS GRAFICOS E COMUNICACAO VISUAL ESTRELA LTDA.",
          endereco:
            "Avenida de Duca Serra, numero 1921, bloco A, sala 12, proximo ao centro comercial",
        },
      }),
    );
  }
}, 30_000);

test("orçamento com entrega e expedição em dias diferentes mostra as duas, no rodapé", async () => {
  const texto = await textoDoPdf({
    ...props,
    data_entrega: "07/08/2026",
    data_expedicao: "06/08/2026",
  });
  expect(texto).toContain("Data de expedição prevista: 06/08/2026");
  expect(texto).toContain("Entrega ao cliente: 07/08/2026");
  expect(texto).not.toContain("Data de Entrega:");
}, 30_000);

test("orçamento com metragem e layout renderiza um PDF válido", async () => {
  const buffer = await renderizar(props);
  expect(ehPdf(buffer)).toBe(true);
  expect(buffer.length).toBeGreaterThan(1000);
}, 30_000);

test("via de produção renderiza sem valores e sem quebrar", async () => {
  const buffer = await renderizar({
    ...props,
    mostrarValores: false,
    pagamento: null,
    parcelas: null,
    subtotal: null,
    desconto: null,
  });
  expect(ehPdf(buffer)).toBe(true);
}, 30_000);

test("item sem dimensão e sem layout continua renderizando", async () => {
  const texto = await textoDoPdf({
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
  expect(texto).toContain("Serviço de instalação - UN");
  // Sem arte não há bloco LAYOUT, e sem área não há soma de área.
  expect(texto).not.toContain("LAYOUT");
  expect(texto).not.toContain("Soma área total");
}, 30_000);

test("empresa sem logo e sem dados opcionais não quebra o cabeçalho", async () => {
  const texto = await textoDoPdf({
    ...props,
    empresa: { nome: "BEX PRINT OS", cor: "#7B2E8B" },
  });
  // A caixa com o nome entra no lugar do logo.
  expect(texto).toContain("BEX PRINT OS");
  // Orçamento sem observação leva o texto padrão de condições.
  expect(texto).toContain("Favor conferir os dados cadastrais");
}, 30_000);

test("OS usa bloco de assinaturas em vez do termo de aceite", async () => {
  const texto = await textoDoPdf({ ...props, tipo: "os", numero: 10, status: "Fila de produção" });
  expect(texto).toContain("Ordem de Serviço: Nº 10");
  expect(texto).toContain("Situação: Fila de produção");
  expect(texto).toContain("Valor Total da OS: R$ 792,43");
  expect(texto).not.toContain("Estou de acordo");
  expect(texto).toContain("FRANCYERICA SILVA ARAUJO (GRAFICA TESTE LTDA)");
}, 30_000);

test("recibo de retirada renderiza sem valores e com as assinaturas próprias", async () => {
  const texto = await textoDoPdf({
    ...props,
    tipo: "recibo_material",
    numero: 1042,
    data_validade: null,
    data_entrega: null,
    vendedor: null,
    itens: [
      {
        descricao: "Lona 440g",
        unidade: "m2",
        quantidade: 12.6,
        valor_unitario: 0,
        valor_total: 0,
      },
      {
        descricao: "Ilhós latão",
        unidade: "un",
        quantidade: 24,
        valor_unitario: 0,
        valor_total: 0,
      },
    ],
    soma_area: null,
    subtotal: null,
    desconto: null,
    total: 0,
    pagamento: null,
    parcelas: null,
    entrega: null,
    observacoes: "Material retirado do estoque para a OS 1042 por Fulano.",
    assinaturas: { esquerda: "Entregue por (GRAFICA TESTE LTDA)", direita: "Retirado por Fulano" },
    mostrarValores: false,
  });
  expect(texto).toContain("OS Nº 1042");
  expect(texto).toContain("MATERIAIS RETIRADOS");
  expect(texto).toContain("12,6 M²");
  expect(texto).toContain("Retirado por Fulano");
  expect(texto).toContain("Material retirado do estoque para a OS 1042 por Fulano.");
  // Recibo não é via de produção (até 05/10 saía carimbado assim) e não tem valor.
  expect(texto).not.toContain("VIA DE PRODUÇÃO");
  expect(texto).not.toContain("R$");
}, 30_000);

test("fatura mostra parcelas, saldo em aberto e identificação legal", async () => {
  const texto = await textoDoPdf({
    ...props,
    tipo: "fatura",
    numero: 31,
    status: "Parcial",
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
    pagamento: { forma: "PIX", parcelas: 2 },
    observacoes:
      "Impresso por CNPJ 68.726.406/0001-90 para AGENCIA BEX MCP (37.914.628/0001-02). Tiragem: 3000 exemplares. Art. 38, Lei 9.504/1997.",
    mostrarValores: true,
  });
  for (const trecho of [
    "Fatura: Nº 31",
    "Valor Total da Fatura: R$ 1.110,00",
    "Já recebido: R$ 555,00",
    "Saldo em aberto: R$ 555,00",
    "Forma Pagto: PIX",
    "Condições de Pagamento: 2x",
    "venc. 05/09/2026",
    "(paga)",
    "venc. 20/09/2026",
    "Tiragem: 3000 exemplares. Art. 38",
  ]) {
    expect(texto, `faltou "${trecho}"`).toContain(trecho);
  }
}, 30_000);

test("fatura sem parcelas e sem pagamento continua renderizando", async () => {
  const texto = await textoDoPdf({
    ...props,
    tipo: "fatura",
    numero: 32,
    parcelas: [],
    valor_pago: 0,
    pagamento: null,
  });
  expect(texto).not.toContain("PAGAMENTO");
  expect(texto).not.toContain("Saldo em aberto");
}, 30_000);

test("orçamento 3D sai no mesmo formato, com validade e aceite", async () => {
  const texto = await textoDoPdf({
    ...props,
    tipo: "orcamento_3d",
    numero: "3F9A1C22",
    itens: [
      {
        descricao: "Chaveiro em PLA",
        unidade: "un",
        quantidade: 50,
        valor_unitario: 6.9,
        valor_total: 345,
      },
    ],
    soma_area: null,
    subtotal: 345,
    total: 345,
    pagamento: null,
    parcelas: null,
    entrega: null,
    observacoes: "Cor azul royal.",
  });
  expect(texto).toContain("Orçamento 3D: Nº 3F9A1C22");
  expect(texto).toContain("Cor azul royal.");
  expect(texto).toContain("Esse orçamento é válido até 14/08/2026.");
  expect(texto).toContain("Nome e CPF");
}, 30_000);

test("via interna leva a base de custo e sai marcada USO INTERNO", async () => {
  const texto = await textoDoPdf({
    ...props,
    custos: {
      tarifas: [{ rotulo: "Energia", valor: "R$ 1,13/kWh" }],
      itens: [
        {
          descricao: "Adesivo starpac 1 ano RP400",
          quantidade: 3,
          custo_previsto_unitario: 98.4,
          custo_real_unitario: 104.1,
          custo_perda: 12.3,
          preco_unitario: 257.25,
          margem_real: 0.5953,
        },
      ],
    },
  });
  expect(texto).toContain("USO INTERNO — BASE DE CUSTO");
  expect(texto).toContain("Energia: R$ 1,13/kWh");
  expect(texto).toContain("previsto R$ 98,40/un, real R$ 104,10/un, perda R$ 12,30");
  expect(texto).toContain("margem 59,5%");
}, 30_000);

test("documento longo quebra em páginas com o rodapé em cada uma", async () => {
  const texto = await textoDoPdf({
    ...props,
    itens: Array.from({ length: 18 }, (_, i) => ({
      ...props.itens[i % 2],
      descricao: `Placa ${i + 1}`,
    })),
  });
  expect(texto).toContain("Placa 18");
  expect(texto).toMatch(/Página 1 de [2-9]/);
  expect(texto).toMatch(/Página 2 de [2-9]/);
}, 30_000);
