/**
 * pdf.js sob demanda, só no navegador.
 *
 * Serve a prévia do documento (cada página desenhada num canvas) e a arte em
 * PDF que vira miniatura no bloco LAYOUT. Entra por import dinâmico: são ~500 KB,
 * mais o worker, que o resto do sistema não precisa baixar.
 *
 * É o build "legacy" de propósito. O build padrão exige navegador recente, e a
 * prévia que ficava em branco era justamente a do celular (Android e iPhone).
 *
 * Sem `standardFontDataUrl`: os PDFs do @react-pdf usam Helvetica sem embutir a
 * fonte, e o pdf.js cai na fonte do sistema (Arial/Roboto) — para ver na tela
 * é o bastante e evita servir 1,5 MB de fontes.
 */

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

// A condição com `import.meta.env.SSR` some no build do servidor e leva junto
// o import dinâmico: o pdf.js não entra no pacote do servidor, onde nunca roda.
const importarPdfjs = import.meta.env.SSR
  ? null
  : () =>
      Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
      ]);

let carregando: Promise<Pdfjs> | null = null;

export function carregarPdfjs(): Promise<Pdfjs> {
  if (!importarPdfjs) return Promise.reject(new Error("O pdf.js só roda no navegador."));
  if (!carregando) {
    carregando = importarPdfjs().then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
    // Falhou (rede caiu no meio)? A próxima chamada tenta de novo em vez de
    // herdar a promessa rejeitada para sempre.
    carregando.catch(() => {
      carregando = null;
    });
  }
  return carregando;
}
