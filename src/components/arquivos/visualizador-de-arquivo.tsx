import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type Alvo = {
  titulo: string;
  nome: string;
} & ({ bucket: string; caminho: string; url?: never } | { url: string; bucket?: never; caminho?: never });

const ehImagem = (nome: string) => /\.(png|jpe?g|webp|gif|heic)$/i.test(nome);

/**
 * Abre o PDF ou a imagem DENTRO do sistema (27/10/2026). Antes o olho do histórico mandava a
 * pessoa para outra aba do navegador. O arquivo é baixado como blob e mostrado num quadro da
 * própria tela; "Baixar" continua ao lado para quem quiser o arquivo.
 */
export function VisualizadorDeArquivo({ alvo, onFechar }: { alvo: Alvo | null; onFechar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!alvo) return;
    let cancelado = false;
    let criada: string | null = null;
    setUrl(null);
    setErro(null);
    (async () => {
      try {
        let blob: Blob;
        if (alvo.url) {
          const r = await fetch(alvo.url);
          if (!r.ok) throw new Error(`o arquivo não abriu (${r.status})`);
          blob = await r.blob();
        } else {
          const { data, error } = await supabase.storage.from(alvo.bucket!).download(alvo.caminho!);
          if (error || !data) throw new Error(error?.message || "o arquivo não abriu");
          blob = data;
        }
        const tipo = ehImagem(alvo.nome) ? blob.type || "image/jpeg" : "application/pdf";
        criada = URL.createObjectURL(blob.type === tipo ? blob : new Blob([blob], { type: tipo }));
        if (!cancelado) setUrl(criada);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.");
      }
    })();
    return () => {
      cancelado = true;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [alvo]);

  return (
    <Dialog open={!!alvo} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{alvo?.titulo}</DialogTitle>
          <DialogDescription className="sr-only">Visualização do arquivo dentro do sistema</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {erro ? (
            <p className="p-4 text-sm text-destructive">{erro}</p>
          ) : !url ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o arquivo…
            </p>
          ) : alvo && ehImagem(alvo.nome) ? (
            <img src={url} alt={alvo.titulo} className="mx-auto h-full max-w-full object-contain" />
          ) : (
            <iframe src={url} title={alvo?.titulo} className="h-full w-full" />
          )}
        </div>
        <DialogFooter>
          {url && alvo && (
            <Button asChild variant="outline">
              <a href={url} download={alvo.nome}>
                <Download className="mr-1 h-4 w-4" /> Baixar
              </a>
            </Button>
          )}
          <Button onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
