import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rotuloDoTipo, type MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { nomeParaBaixar } from "@/domain/whatsapp/midia";
import { contadorDeFotos, fotoAnterior, proximaFoto, teclaDoVisor } from "@/domain/whatsapp/visor";
import { baixarMidia, useOrigemDaMidia } from "@/components/whatsapp/usar-arquivo-da-midia";

/**
 * O visor das fotos da conversa (onda 1, 12/11/2026): a foto inteira, setas
 * para a anterior e a próxima, o contador "3 de 12", Esc para fechar e Baixar.
 * Anda entre as fotos já carregadas da conversa (`fotosDaConversa`).
 *
 * Feito com o Dialog do Radix direto, e não com `DialogContent` da casa, porque
 * o botão de fechar daquele é de 40 px e aqui todo alvo tem 44 px. O Radix
 * cuida do Esc (e avisa com `preventDefault`, então a tela do WhatsApp não
 * fecha a conversa junto), do foco preso e do retorno do foco.
 */
export function VisorDeFotos({
  fotos,
  indiceInicial,
  aberto,
  aoFechar,
}: {
  fotos: readonly MensagemDaCaixa[];
  indiceInicial: number;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const [indice, setIndice] = useState(indiceInicial);
  const [baixando, setBaixando] = useState(false);
  // Abriu de novo (outra foto): começa na que foi tocada.
  useEffect(() => {
    if (aberto) setIndice(indiceInicial);
  }, [aberto, indiceInicial]);

  const total = fotos.length;
  const atual = fotos[Math.min(indice, Math.max(0, total - 1))];
  const [falhou, setFalhou] = useState<string | null>(null);
  const { origem, aguardando, semLink } = useOrigemDaMidia(atual ?? { storage_bucket: null, storage_path: null, media_url: null }, aberto && !!atual);

  // Foto nova: zera a falha da anterior.
  useEffect(() => {
    setFalhou(null);
  }, [atual?.id]);

  if (!atual) return null;
  const nome = nomeParaBaixar(atual);
  const contador = contadorDeFotos(indice, total);
  const noComeco = indice <= 0;
  const noFim = indice >= total - 1;

  function ir(para: number) {
    setIndice(para);
  }

  async function baixar() {
    setBaixando(true);
    try {
      await baixarMidia(atual, nome);
    } finally {
      setBaixando(false);
    }
  }

  const botaoDoVisor =
    "size-11 rounded-full bg-white/15 text-white hover:bg-white/30 hover:text-white disabled:opacity-40";

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white focus:outline-none"
          onKeyDown={(e) => {
            const passo = teclaDoVisor(e.key, indice, total);
            // O Esc é do Radix; as setas são nossas.
            if (e.key === "Escape" || !passo.tratada) return;
            e.preventDefault();
            ir(passo.indice);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{rotuloDoTipo(atual.tipo)} do WhatsApp</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {nome}
            {contador ? `. Foto ${contador}.` : ""} Use as setas para trocar de foto e Esc para fechar.
          </DialogPrimitive.Description>

          <div className="flex h-16 shrink-0 items-center gap-2 px-3">
            <p className="min-w-0 flex-1 truncate text-base" aria-live="polite">
              {contador ?? nome}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-11 gap-2 rounded-full bg-white/15 px-4 text-base text-white hover:bg-white/30 hover:text-white"
              onClick={baixar}
              disabled={baixando || !origem}
              aria-label={`Baixar foto ${nome}`}
            >
              {baixando ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              Baixar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={botaoDoVisor}
              onClick={aoFechar}
              aria-label="Fechar o visor"
            >
              <X aria-hidden />
            </Button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
            {aguardando ? (
              <p className="flex items-center gap-2 text-base">
                <Loader2 className="size-5 animate-spin" aria-hidden /> Carregando a foto
              </p>
            ) : semLink || falhou ? (
              <p role="alert" className="max-w-sm text-center text-base">
                Esta foto não abriu. Toque em Baixar para tentar de novo.
              </p>
            ) : origem ? (
              <img
                key={atual.id}
                src={origem}
                alt={atual.legenda?.trim() || `${rotuloDoTipo(atual.tipo)} do WhatsApp`}
                onError={() => setFalhou(atual.id)}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}

            {total > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${botaoDoVisor} absolute left-2 top-1/2 -translate-y-1/2`}
                  onClick={() => ir(fotoAnterior(indice, total))}
                  disabled={noComeco}
                  aria-label="Foto anterior"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={`${botaoDoVisor} absolute right-2 top-1/2 -translate-y-1/2`}
                  onClick={() => ir(proximaFoto(indice, total))}
                  disabled={noFim}
                  aria-label="Próxima foto"
                >
                  <ChevronRight aria-hidden />
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
