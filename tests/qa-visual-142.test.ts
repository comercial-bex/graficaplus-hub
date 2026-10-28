import { test } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import type { DocumentoPDFProps } from "../src/lib/pdf/DocumentoPDF";
import { renderizar } from "./apoio/pdf";
import { CORES_DA_MARCA, FAIXA_DA_MARCA } from "../src/lib/marca";

/**
 * Conferência VISUAL (não roda no CI): só com PDF_QA_DIR, escreve o 142 com o
 * visual novo para abrir e comparar com a referência do dono.
 */

/** PNG RGB com a "peça" (um retângulo colorido) no meio de uma folha branca — a arte típica. */
function pngComMargens(largura: number, altura: number): string {
  const crc = (dados: Buffer) => {
    let c = ~0;
    for (const byte of dados) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc(corpo));
    return Buffer.concat([tamanho, corpo, soma]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;
  cabecalho[9] = 2;
  const linhas: Buffer[] = [];
  for (let y = 0; y < altura; y++) {
    const linha = Buffer.alloc(1 + largura * 3, 255);
    linha[0] = 0;
    for (let x = 0; x < largura; x++) {
      const dentro = x > largura * 0.3 && x < largura * 0.7 && y > altura * 0.35 && y < altura * 0.65;
      if (dentro) {
        linha[1 + x * 3] = 232;
        linha[2 + x * 3] = 71;
        linha[3 + x * 3] = 139;
      }
    }
    linhas.push(linha);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", deflateSync(Buffer.concat(linhas))),
    bloco("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

test.skipIf(!process.env.PDF_QA_DIR)("escreve o 142 com o visual novo", async () => {
  const dir = process.env.PDF_QA_DIR as string;
  await mkdir(dir, { recursive: true });
  const logo = `data:image/png;base64,${(await readFile("public/marca/bex-print-fundo-claro.png")).toString("base64")}`;
  const logoEscura = `data:image/png;base64,${(await readFile("public/marca/bex-print-fundo-escuro.png")).toString("base64")}`;
  const props: DocumentoPDFProps = {
    tipo: "orcamento",
    numero: 142,
    data_solicitacao: "26/10/2026",
    data_validade: "02/11/2026",
    vendedor: "Fernando Augusto",
    status: "enviado",
    empresa: {
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
      logo_url: logo,
      logo_escura_url: logoEscura,
      condicoes_gerais:
        "1 — Pagamento: 50% na entrada, na aprovação da arte, e 50% na entrega ou retirada.\n2 — Prazo de produção: 3 a 5 dias úteis após a aprovação da arte.\n3 — Arte: nome, número e cores em layout padrão estão inclusos. Identidade visual e alterações após a aprovação são orçadas à parte.\n4 — Entrega: retirada na loja sem custo. Entrega e frete orçados à parte conforme o destino.",
    },
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
        layout_url: pngComMargens(600, 450),
        layout_nome: "modelo.png",
      },
      {
        descricao: "CHAVEIRO ACRILICO",
        tipo_produto: "Brinde",
        acabamento: "embalagem individual, DTF",
        unidade: "un",
        quantidade: 400,
        valor_unitario: 7,
        valor_total: 2800,
        layout_url: pngComMargens(500, 500),
        layout_nome: "chaveiro.png",
        layouts_extras: 2,
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
  await writeFile(`${dir}/orcamento-142-novo.pdf`, await renderizar(props));
  await writeFile(
    `${dir}/orcamento-142-producao.pdf`,
    await renderizar({ ...props, mostrarValores: false, pagamento: null, parcelas: null, observacao_interna: "Cliente busca às 17h." }),
  );
  await writeFile(
    `${dir}/fatura-exemplo.pdf`,
    await renderizar({
      ...props,
      tipo: "fatura",
      numero: 170,
      status: "Parcial",
      valor_pago: 2000,
      pagamento: { forma: "PIX", parcelas: 2 },
      parcelas: [
        { numero: 1, valor: 2198.5, vencimento: "2026-10-27", pago: true },
        { numero: 2, valor: 2198.5, vencimento: "2026-11-04", pago: false },
      ],
    }),
  );
}, 60_000);
