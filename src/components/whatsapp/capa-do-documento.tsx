import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Presentation,
  Shapes,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";
import { Dica } from "@/components/bex/Dica";
import { Button } from "@/components/ui/button";
import { DICAS_WA_MIDIA } from "@/lib/dicas";
import { cn } from "@/lib/utils";
import { capaDoPdf } from "@/lib/pdf/imagens";
import {
  criarFilaDeUm,
  criarGuardaDeCapas,
  descricaoDoDocumento,
  lerComLimite,
  modoDaCapa,
  tipoDoArquivo,
  ArquivoGrandeDemais,
  LIMITE_DA_CAPA_BYTES,
  tamanhoLegivel,
  type TipoDeArquivo,
} from "@/domain/whatsapp/documento";

/**
 * O cartão do documento na bolha (onda 1, 12/11/2026): a CAPA da 1ª página
 * desenhada aqui no navegador pelo pdf.js, o nome original com 16 px, "PDF · 18
 * páginas" com o que se sabe, e Abrir e Baixar de 44 px.
 *
 * A capa custa: baixar o PDF e desenhar. Por isso:
 * - só começa quando o cartão aparece na tela (IntersectionObserver);
 * - uma capa por vez em toda a conversa (`FILA`): dez documentos não abrem
 *   dez leituras ao mesmo tempo;
 * - PDF acima de 15 MB nem é baixado (`lerComLimite` desiste ao passar);
 * - o espaço da capa é reservado (altura fixa): a conversa não pula;
 * - falhou ou é grande demais: "Sem prévia", e o resto do cartão segue.
 * Arte PNG ou JPG mandada como documento mostra a própria imagem, reduzida.
 *
 * `gif` e `segundos` ficam prontos para a onda seguinte (o Z-API manda, mas a
 * coluna ainda não existe); hoje ninguém os preenche.
 */

const FILA = criarFilaDeUm();
type Capa = { src: string; paginas: number; bytes: number };
const CAPAS = criarGuardaDeCapas<Capa>();

const ICONE: Record<TipoDeArquivo, LucideIcon> = {
  pdf: FileText,
  imagem: FileText,
  word: FileText,
  planilha: FileSpreadsheet,
  apresentacao: Presentation,
  compactado: Archive,
  projeto: Shapes,
  outro: FileIcon,
};

const FUNDO_DA_FICHA: Record<TipoDeArquivo, string> = {
  pdf: "bg-(--midia-ficha-pdf)",
  imagem: "bg-(--midia-ficha-outro)",
  word: "bg-(--midia-ficha-word)",
  planilha: "bg-(--midia-ficha-planilha)",
  apresentacao: "bg-(--midia-ficha-apresentacao)",
  compactado: "bg-(--midia-ficha-compactado)",
  projeto: "bg-(--midia-ficha-projeto)",
  outro: "bg-(--midia-ficha-outro)",
};

type Estado =
  | { fase: "espera" }
  | { fase: "desenhando" }
  | { fase: "pronta"; capa: Capa }
  | { fase: "sem_previa"; motivo: string };

export function CapaDoDocumento({
  mensagemId,
  nome,
  origem,
  mime,
  gif,
  segundos,
  baixando,
  aoBaixar,
  aoAbrir,
  aoMudarAltura,
}: {
  /** A chave da capa guardada: a mesma mensagem não desenha duas vezes. */
  mensagemId: string;
  nome: string;
  /** O endereço do arquivo (link assinado ou do Z-API). */
  origem: string;
  mime?: string | null;
  /** Para a onda seguinte: o Z-API diz que a imagem é um GIF. */
  gif?: boolean;
  /** Para a onda seguinte: duração, quando for vídeo ou áudio mandado como documento. */
  segundos?: number;
  baixando: boolean;
  aoBaixar: () => void;
  aoAbrir: () => void;
  aoMudarAltura?: () => void;
}) {
  const tipo = tipoDoArquivo(nome, mime);
  const modo = modoDaCapa(tipo, null);
  const Icone = ICONE[tipo];
  const raiz = useRef<HTMLDivElement>(null);
  const noAr = useRef(true);
  const [estado, setEstado] = useState<Estado>(() => {
    const guardada = modo === "pdf" ? CAPAS.ler(mensagemId) : undefined;
    return guardada ? { fase: "pronta", capa: guardada } : { fase: "espera" };
  });
  const [imagemFalhou, setImagemFalhou] = useState(false);

  useEffect(() => {
    noAr.current = true;
    return () => {
      noAr.current = false;
    };
  }, []);

  // Só desenha quando o cartão aparece na tela, e uma vez.
  useEffect(() => {
    if (modo !== "pdf" || estado.fase !== "espera") return;
    const el = raiz.current;
    if (!el) return;
    const comecar = () => {
      setEstado({ fase: "desenhando" });
      FILA(
        async () => {
          const r = await fetch(origem);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const bytes = await lerComLimite(r, LIMITE_DA_CAPA_BYTES);
          const { src, paginas } = await capaDoPdf(bytes);
          return { src, paginas, bytes: bytes.length } satisfies Capa;
        },
        () => !noAr.current,
      )
        .then((capa) => {
          CAPAS.gravar(mensagemId, capa);
          if (noAr.current) setEstado({ fase: "pronta", capa });
        })
        .catch((e: unknown) => {
          if (!noAr.current) return;
          setEstado({
            fase: "sem_previa",
            motivo:
              e instanceof ArquivoGrandeDemais
                ? `O arquivo passa de ${tamanhoLegivel(LIMITE_DA_CAPA_BYTES)}.`
                : "Não deu para desenhar a primeira página.",
          });
        });
    };
    if (typeof IntersectionObserver === "undefined") {
      comecar();
      return;
    }
    const olho = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((x) => x.isIntersecting)) {
          olho.disconnect();
          comecar();
        }
      },
      { rootMargin: "200px" },
    );
    olho.observe(el);
    return () => olho.disconnect();
  }, [modo, estado.fase, origem, mensagemId]);

  const capa = estado.fase === "pronta" ? estado.capa : null;
  const descricao = descricaoDoDocumento({ tipo, paginas: capa?.paginas, bytes: capa?.bytes });
  const mostraCapa = modo === "pdf" || (modo === "imagem" && !imagemFalhou);
  const semPrevia = estado.fase === "sem_previa" || (modo === "imagem" && imagemFalhou);

  return (
    <div
      ref={raiz}
      data-documento={tipo}
      className="w-72 max-w-full overflow-hidden rounded-xl border border-(--midia-borda) bg-(--midia-cartao) text-(--midia-cartao-texto)"
    >
      {(mostraCapa || semPrevia) && (
        // Altura reservada: a conversa não pula quando a capa chega.
        <div className="relative flex h-44 items-center justify-center overflow-hidden bg-white">
          {modo === "imagem" && !imagemFalhou ? (
            <img
              src={origem}
              alt={nome}
              loading="lazy"
              onLoad={aoMudarAltura}
              onError={() => setImagemFalhou(true)}
              className="max-h-full max-w-full object-contain"
            />
          ) : capa ? (
            <img
              src={capa.src}
              alt={`Primeira página de ${nome}`}
              className="h-full w-full object-cover object-top"
            />
          ) : semPrevia ? (
            <p className="px-4 text-center text-sm text-neutral-700">
              <span className="block font-semibold">Sem prévia</span>
              {estado.fase === "sem_previa" ? estado.motivo : "A imagem não abriu."}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-neutral-700">
              {estado.fase === "desenhando" && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {estado.fase === "desenhando" ? "Montando a prévia" : "Prévia"}
            </p>
          )}
          {gif && (
            <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
              GIF
            </span>
          )}
        </div>
      )}

      <div className="flex items-start gap-3 p-3">
        <span
          aria-hidden
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-lg text-(--midia-ficha-texto)",
            FUNDO_DA_FICHA[tipo],
          )}
        >
          <Icone className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-medium leading-snug">{nome}</p>
          <p className="text-xs text-(--midia-cartao-apoio)">
            {descricao}
            {segundos ? ` · ${Math.round(segundos)} s` : ""}
          </p>
        </div>
      </div>

      <div className="flex gap-2 px-3 pb-3">
        <Dica texto={DICAS_WA_MIDIA.abrir} className="flex-1">
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full gap-2 border border-(--midia-borda) text-base text-(--midia-cartao-texto) hover:bg-transparent hover:text-(--midia-cartao-texto) hover:underline"
            onClick={aoAbrir}
            aria-label={`Abrir ${nome} em outra aba`}
          >
            <Paperclip aria-hidden /> Abrir
          </Button>
        </Dica>
        <Dica texto={DICAS_WA_MIDIA.baixar} className="flex-1">
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full gap-2 bg-(--midia-botao) text-base text-(--midia-botao-texto) hover:bg-(--midia-botao-hover) hover:text-(--midia-botao-texto)"
            onClick={aoBaixar}
            disabled={baixando}
            aria-label={`Baixar ${nome}`}
          >
            {baixando ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            Baixar
          </Button>
        </Dica>
      </div>
    </div>
  );
}
