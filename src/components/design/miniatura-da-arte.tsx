import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, File, FileImage, FileText, Loader2, PenTool, Shapes } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import {
  bucketDaArte,
  extensaoDe,
  mostraMiniatura,
  rotuloDoTipo,
  tamanhoDaArte,
  tamanhoLegivel,
  tipoDaArte,
  type ArquivoDaArte,
  type TipoDeArte,
} from "./tipo-de-arquivo";

export type ArteParaMostrar = ArquivoDaArte & {
  id: string;
  nome: string;
  caminho: string;
  bucket?: string | null;
};

/** A miniatura vale 10 minutos: dá para olhar a fila com calma sem a URL vencer. */
const VALIDADE_MINIATURA_S = 600;
/** O link de "Abrir" é gerado na hora do clique e vale 2 minutos. */
const VALIDADE_ABRIR_S = 120;

const ICONE: Record<TipoDeArte, typeof File> = {
  imagem: FileImage,
  pdf: FileText,
  ai: PenTool,
  psd: FileImage,
  cdr: Shapes,
  outro: File,
};

/**
 * A arte de verdade, não um ícone.
 *
 * O bucket `arquivos-clientes` é privado: a imagem só abre com URL assinada,
 * e assinar exige a permissão de leitura do bucket (arquivos.read ou
 * arquivos.approve — a mesma régua de quem abre /design). PDF, AI, PSD e CDR o
 * navegador não desenha como miniatura: aparecem com o tipo, o nome e o botão
 * "Abrir", que gera um link curto na hora.
 *
 * `onVista` avisa a fila de que a pessoa VIU a peça — a imagem carregou ou o
 * arquivo foi aberto. É o que libera "Aprovar".
 */
export function MiniaturaDaArte({
  arte,
  onVista,
}: {
  arte: ArteParaMostrar;
  onVista?: (id: string) => void;
}) {
  const tipo = tipoDaArte(arte);
  const bucket = bucketDaArte(arte.bucket);
  const comMiniatura = mostraMiniatura(arte);
  const [imagemFalhou, setImagemFalhou] = useState(false);
  const [abrindo, setAbrindo] = useState(false);

  const url = useQuery({
    queryKey: ["arte-miniatura", arte.id, bucket, arte.caminho],
    enabled: comMiniatura,
    staleTime: (VALIDADE_MINIATURA_S - 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(arte.caminho, VALIDADE_MINIATURA_S);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  async function abrir() {
    // A aba abre JÁ, no clique, e recebe o endereço depois: aberta só depois
    // do `await`, o Safari do celular trata como pop-up e bloqueia.
    const janela = window.open("", "_blank");
    setAbrindo(true);
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(arte.caminho, VALIDADE_ABRIR_S);
    setAbrindo(false);
    if (error || !data?.signedUrl) {
      janela?.close();
      toast.error(
        `Não foi possível abrir a arte: ${mensagemErro(error, "o arquivo não respondeu")}`,
      );
      return;
    }
    if (!janela) {
      toast.error(
        "O navegador bloqueou a nova aba. Permita pop-ups para este endereço e tente de novo.",
      );
      return;
    }
    janela.opener = null;
    janela.location.href = data.signedUrl;
    onVista?.(arte.id);
  }

  const Icone = ICONE[tipo];
  const extensao = extensaoDe(arte.nome) || extensaoDe(arte.caminho);
  const tamanho = tamanhoLegivel(tamanhoDaArte(arte));

  if (comMiniatura && url.data && !imagemFalhou) {
    return (
      <button
        type="button"
        onClick={() => void abrir()}
        title="Abrir a arte em tamanho real"
        className="block aspect-video w-full overflow-hidden border-b bg-muted/40"
      >
        <img
          src={url.data}
          alt={`Arte ${arte.nome}`}
          loading="lazy"
          className="h-full w-full object-contain"
          onLoad={() => onVista?.(arte.id)}
          onError={() => setImagemFalhou(true)}
        />
      </button>
    );
  }

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 border-b bg-muted/40 p-3 text-center">
      {comMiniatura && url.isPending ? (
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Carregando a miniatura"
        />
      ) : (
        <Icone className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      )}
      <Badge variant="outline" className="font-normal">
        {rotuloDoTipo(tipo)}
        {extensao ? ` · .${extensao}` : ""}
        {tamanho ? ` · ${tamanho}` : ""}
      </Badge>
      <p className="max-w-full truncate text-xs" title={arte.nome}>
        {arte.nome}
      </p>
      {comMiniatura && (url.isError || imagemFalhou) && (
        <p className="text-xs text-destructive">
          Miniatura indisponível: {url.isError ? mensagemErro(url.error) : "a imagem não carregou"}.
        </p>
      )}
      {!comMiniatura && tipo === "imagem" && (
        <p className="text-xs text-muted-foreground">Imagem grande: abra para ver.</p>
      )}
      <Button size="sm" variant="outline" disabled={abrindo} onClick={() => void abrir()}>
        {abrindo ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5 mr-1" />
        )}
        Abrir
      </Button>
    </div>
  );
}
