import { deflateSync } from "node:zlib";
import { DocumentoPDF, type DocumentoPDFProps } from "../../src/lib/pdf/DocumentoPDF";

/**
 * Apoio dos testes de PDF: renderiza o documento de verdade e lê o texto de
 * volta com o pdf.js — o mesmo motor da prévia. Não é um teste (o nome não
 * termina em .test.ts).
 */

export async function renderizar(p: DocumentoPDFProps): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await renderToBuffer(DocumentoPDF(p) as any);
}

/** O texto de todas as páginas, com quebra de linha onde o PDF quebra. */
export async function textoDoPdf(p: DocumentoPDFProps): Promise<string> {
  const buffer = await renderizar(p);
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("não saiu um PDF");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 });
  const doc = await tarefa.promise;
  const paginas: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const conteudo = await (await doc.getPage(n)).getTextContent();
    paginas.push(
      conteudo.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join(""),
    );
  }
  await tarefa.destroy();
  return paginas.join("\n");
}

/** PNG de 4×3 px, de uma cor, feito na hora (sem rede e sem arquivo). */
export function pngMinusculo(r: number, g: number, b: number): string {
  const largura = 4;
  const altura = 3;
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
  cabecalho[8] = 8; // bits por canal
  cabecalho[9] = 2; // RGB
  const linha = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array(largura).fill([r, g, b]).flat()),
  ]);
  const pixels = deflateSync(Buffer.concat(Array(altura).fill(linha)));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", pixels),
    bloco("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
