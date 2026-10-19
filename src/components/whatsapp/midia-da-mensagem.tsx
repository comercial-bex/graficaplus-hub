import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { mensagemErro } from "@/lib/erros";
import { linkDaMidia } from "@/components/whatsapp/usar-caixa-de-entrada";
import { guardarMidiaDaMensagem } from "@/lib/api/whatsapp-midia.functions";
import { rotuloDoTipo, type MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import {
  categoriaDaMidia,
  nomeParaBaixar,
  precisaArquivar,
  temArquivo,
  temCopiaNossa,
} from "@/domain/whatsapp/midia";

/** Mensagens cuja cópia já foi pedida nesta sessão: abrir de novo não repete. */
const JA_PEDIRAM = new Set<string>();

/** Quanto vale o link assinado da nossa cópia: o suficiente para uma conversa longa. */
const VALIDADE_DO_LINK_S = 60 * 60;

function iniciarDownload(href: string, nome: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * A mídia de uma mensagem do WhatsApp, dentro da bolha: a foto aparece (e
 * amplia ao clicar), o vídeo e o áudio tocam ali mesmo, o documento mostra o
 * nome — e todos têm "Baixar".
 *
 * A fonte é a nossa cópia (link assinado, não vence) ou, enquanto ela não
 * existe, o link do Z-API (vale 30 dias). Mensagem que chegou só com o link é
 * copiada sozinha na primeira abertura (`guardarMidiaDaMensagem`), para o
 * arquivo não sumir do histórico.
 *
 * Sem arquivo não desenha nada. Se o arquivo não carrega (link vencido, áudio
 * em formato que o navegador não toca), a bolha diz isso e o "Baixar" segue
 * ali — falha não pode se ler como "não tinha mídia".
 */
export function MidiaDaMensagem({
  m,
  aoMudarAltura,
  aoArquivar,
}: {
  m: MensagemDaCaixa;
  /** A mídia carregou e a bolha cresceu: quem rola a conversa mantém o fim à vista. */
  aoMudarAltura?: () => void;
  /** A cópia foi feita: quem lista as mensagens recarrega. */
  aoArquivar?: () => void;
}) {
  const categoria = categoriaDaMidia(m.tipo);
  const naCopia = temCopiaNossa(m);
  const [falhou, setFalhou] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const guardar = useServerFn(guardarMidiaDaMensagem);

  const link = useQuery({
    queryKey: ["wa-midia-link", m.storage_bucket, m.storage_path],
    enabled: naCopia,
    staleTime: (VALIDADE_DO_LINK_S - 300) * 1000,
    queryFn: () => linkDaMidia(m.storage_bucket as string, m.storage_path as string, VALIDADE_DO_LINK_S),
  });
  const origem = naCopia ? link.data : (m.media_url ?? undefined);

  // O link do Z-API vence em 30 dias: copia para o nosso armazenamento agora.
  const deveArquivar = precisaArquivar(m);
  useEffect(() => {
    if (!deveArquivar || JA_PEDIRAM.has(m.id)) return;
    JA_PEDIRAM.add(m.id);
    guardar({ data: { mensagemId: m.id } })
      .then((r) => {
        if (r.ok) aoArquivar?.();
        else console.warn("[whatsapp] a cópia da mídia não foi feita:", r.erro);
      })
      .catch((e: unknown) => console.warn("[whatsapp] a cópia da mídia falhou:", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deveArquivar, m.id]);

  if (!temArquivo(m) || categoria === "outra") return null;

  const nome = nomeParaBaixar(m);
  const rotulo = rotuloDoTipo(m.tipo).toLowerCase();

  async function baixar() {
    setBaixando(true);
    try {
      if (naCopia) {
        // O armazenamento manda o arquivo como anexo, com o nome certo.
        const url = await linkDaMidia(m.storage_bucket as string, m.storage_path as string, 60, nome);
        iniciarDownload(url, nome);
        return;
      }
      try {
        // O Z-API aceita o nosso endereço (CORS): dá para baixar com o nome certo.
        const r = await fetch(m.media_url as string);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const objeto = URL.createObjectURL(blob);
        iniciarDownload(objeto, nome);
        setTimeout(() => URL.revokeObjectURL(objeto), 10_000);
      } catch {
        // Sem como ler o arquivo daqui: abre o link, e o navegador baixa ou mostra.
        window.open(m.media_url as string, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      toast.error(`Não foi possível baixar: ${mensagemErro(e)}`);
    } finally {
      setBaixando(false);
    }
  }

  async function abrir() {
    // A aba abre no clique e o endereço chega depois: abrir só depois do await
    // faz o celular tratar como janela não pedida e bloquear.
    const janela = window.open("", "_blank");
    try {
      const url = naCopia
        ? await linkDaMidia(m.storage_bucket as string, m.storage_path as string)
        : (m.media_url as string);
      if (janela) {
        janela.opener = null;
        janela.location.href = url;
      }
    } catch (e) {
      janela?.close();
      toast.error(`Não foi possível abrir o arquivo: ${mensagemErro(e)}`);
    }
  }

  const aguardando = naCopia && link.isPending;
  const semLink = naCopia && link.isError;
  const quebrou = falhou || semLink;

  const botaoBaixar = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={baixar}
      disabled={baixando}
      aria-label={`Baixar ${rotulo}`}
    >
      {baixando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
      Baixar
    </Button>
  );

  return (
    <div className="mt-1 space-y-1" data-midia={categoria}>
      {quebrou ? (
        <div role="alert" className="rounded-md border border-dashed bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
          {semLink
            ? `Não foi possível abrir o arquivo guardado (${mensagemErro(link.error)}).`
            : naCopia
              ? "Este arquivo não carrega aqui. Tente baixar."
              : "Este arquivo não carrega aqui: o link do WhatsApp pode ter vencido (vale 30 dias) ou o navegador não toca este formato. Tente baixar."}
        </div>
      ) : aguardando ? (
        <div className="flex h-16 items-center gap-2 rounded-md border bg-background/60 px-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando {rotulo}…
        </div>
      ) : categoria === "imagem" && origem ? (
        <>
          <button
            type="button"
            onClick={() => setAmpliada(true)}
            className="block overflow-hidden rounded-md border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ampliar ${rotulo}`}
          >
            <img
              src={origem}
              alt={m.legenda?.trim() || `${rotuloDoTipo(m.tipo)} do WhatsApp`}
              loading="lazy"
              onLoad={aoMudarAltura}
              onError={() => setFalhou(true)}
              className={m.tipo === "sticker" ? "max-h-32 max-w-full object-contain" : "max-h-64 max-w-full object-contain"}
            />
          </button>
          <Dialog open={ampliada} onOpenChange={setAmpliada}>
            <DialogContent className="max-w-4xl p-2">
              <DialogTitle className="sr-only">{rotuloDoTipo(m.tipo)} do WhatsApp</DialogTitle>
              <DialogDescription className="sr-only">{nome}</DialogDescription>
              <img src={origem} alt={nome} className="max-h-[80dvh] w-full object-contain" />
            </DialogContent>
          </Dialog>
        </>
      ) : categoria === "video" && origem ? (
        <video
          src={origem}
          controls
          preload="metadata"
          playsInline
          onLoadedMetadata={aoMudarAltura}
          onError={() => setFalhou(true)}
          className="max-h-72 max-w-full rounded-md bg-black"
        />
      ) : categoria === "audio" && origem ? (
        <audio
          src={origem}
          controls
          preload="metadata"
          onLoadedMetadata={aoMudarAltura}
          onError={() => setFalhou(true)}
          className="h-10 w-full min-w-[220px] max-w-[300px]"
        />
      ) : (
        <div className="flex items-center gap-2 rounded-md border bg-background/60 px-2.5 py-2 text-xs">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-all font-medium">{nome}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {botaoBaixar}
        {(categoria === "documento" || quebrou) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={abrir}
            aria-label={`Abrir ${rotulo} em outra aba`}
          >
            <Paperclip className="mr-1 h-3 w-3" /> Abrir
          </Button>
        )}
      </div>
    </div>
  );
}
