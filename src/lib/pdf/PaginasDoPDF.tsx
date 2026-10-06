import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { carregarPdfjs } from "./pdfjs";

/**
 * As páginas do PDF, cada uma num canvas do tamanho da largura disponível.
 * Se o pdf.js não abrir (navegador antigo, falha de rede ao baixar o leitor),
 * a área diz o que houve — nunca fica branca e muda; baixar e abrir em nova
 * aba continuam no rodapé.
 */
export function PaginasDoPDF({ blob }: { blob: Blob }) {
  const medidaRef = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  const [documento, setDocumento] = useState<PDFDocumentProxy | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Largura útil, acompanhando giro de tela e redimensionamento. Só muda a
  // partir de 8 px de diferença: redesenhar a cada pixel trava o celular.
  useEffect(() => {
    const el = medidaRef.current;
    if (!el) return;
    let relogio = 0;
    const medir = () => {
      const nova = Math.floor(el.clientWidth);
      setLargura((atual) => (Math.abs(atual - nova) >= 8 ? nova : atual));
    };
    medir();
    const observador = new ResizeObserver(() => {
      window.clearTimeout(relogio);
      relogio = window.setTimeout(medir, 120);
    });
    observador.observe(el);
    return () => {
      window.clearTimeout(relogio);
      observador.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    let destruir: (() => void) | null = null;
    setDocumento(null);
    setErro(null);
    (async () => {
      try {
        const pdfjs = await carregarPdfjs();
        const dados = new Uint8Array(await blob.arrayBuffer());
        const tarefa = pdfjs.getDocument({ data: dados });
        destruir = () => void tarefa.destroy();
        const doc = await tarefa.promise;
        if (cancelado) return;
        setDocumento(doc);
      } catch (e: unknown) {
        if (cancelado) return;
        console.error("[pdf] prévia:", e);
        setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
      destruir?.();
    };
  }, [blob]);

  return (
    <div className="h-full overflow-auto overscroll-contain p-2 sm:p-4">
      <div ref={medidaRef} className="mx-auto w-full max-w-[880px]">
        {erro ? (
          <div className="mx-auto mt-6 max-w-md rounded-md border border-destructive/40 bg-background p-4 text-sm">
            <p className="font-medium">Não foi possível mostrar a prévia neste aparelho.</p>
            <p className="mt-1 text-muted-foreground">{erro}</p>
            <p className="mt-2 text-muted-foreground">
              O documento está pronto: use “Abrir em nova aba” ou “Baixar e salvar”, logo abaixo.
            </p>
          </div>
        ) : !documento || largura === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a prévia…
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {Array.from({ length: documento.numPages }, (_, i) => (
              <PaginaDoPDF
                key={i}
                documento={documento}
                numero={i + 1}
                largura={largura}
                total={documento.numPages}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PaginaDoPDF({
  documento,
  numero,
  largura,
  total,
}: {
  documento: PDFDocumentProxy;
  numero: number;
  largura: number;
  total: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // O pdf.js recusa dois desenhos no mesmo canvas: o novo espera o anterior
  // terminar de cancelar.
  const anteriorRef = useRef<RenderTask | null>(null);
  const [proporcao, setProporcao] = useState(842 / 595);
  const [falhou, setFalhou] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let tarefa: RenderTask | null = null;
    (async () => {
      try {
        await anteriorRef.current?.promise.catch(() => undefined);
        const pagina = await documento.getPage(numero);
        if (cancelado) return;
        const base = pagina.getViewport({ scale: 1 });
        setProporcao(base.height / base.width);
        // Nitidez de tela retina sem estourar a memória do celular: até 2x, e
        // 1,5x quando o documento é longo.
        const densidade = Math.min(window.devicePixelRatio || 1, total > 4 ? 1.5 : 2);
        const viewport = pagina.getViewport({ scale: (largura / base.width) * densidade });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        tarefa = pagina.render({ canvas, viewport });
        anteriorRef.current = tarefa;
        await tarefa.promise;
      } catch (e: unknown) {
        if (cancelado || (e instanceof Error && e.name === "RenderingCancelledException")) return;
        console.error(`[pdf] página ${numero}:`, e);
        setFalhou(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
      tarefa?.cancel();
    };
  }, [documento, numero, largura, total]);

  // `bg-white` de propósito, nos dois temas: é a folha de papel, não um painel.
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-border"
      style={{ width: largura, height: Math.round(largura * proporcao) }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        aria-label={`Página ${numero} de ${total}`}
      />
      {falhou && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
          Não foi possível desenhar a página {numero}: {falhou}
        </div>
      )}
    </div>
  );
}
