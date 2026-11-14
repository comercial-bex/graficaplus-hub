import { pontosParaMm } from "@/domain/os/arquivos-da-os";
import { carregarPdfjs } from "./pdfjs";

/**
 * A medida da 1ª página de um PDF, em milímetros, e quantas páginas ele tem
 * (14/11/2026) — para conferir o arquivo de impressão contra a medida da peça.
 *
 * Lê pelo link assinado, sem baixar o arquivo inteiro: com `disableAutoFetch` e
 * `disableStream` o pdf.js pede ao Storage só os pedaços de que precisa (a tabela
 * do fim do arquivo e a 1ª página). PDF de lona tem centenas de MB.
 * A rotação da página já vem aplicada (`getViewport`).
 */
export async function medirPdf(url: string): Promise<{ largura: number; altura: number; paginas: number }> {
  const pdfjs = await carregarPdfjs();
  const tarefa = pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true });
  try {
    const documento = await tarefa.promise;
    const pagina = await documento.getPage(1);
    const { width, height } = pagina.getViewport({ scale: 1 });
    return { largura: pontosParaMm(width), altura: pontosParaMm(height), paginas: documento.numPages };
  } finally {
    await tarefa.destroy();
  }
}
