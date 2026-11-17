import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/**
 * Foto que se amplia (17/11/2026). Em qualquer miniatura do Custeio:
 *   - mouse: ao passar por cima, um cartão médio mostra a foto maior (o do HoverCard só abre com
 *     mouse; no toque ele nunca abre sozinho, então não atrapalha o celular);
 *   - clique ou toque: abre a foto em tela cheia; Esc, o X ou um toque fora fecham.
 *
 * O gatilho é um `span` com `role="button"`, e não um `button`, porque a miniatura aparece dentro de
 * linhas, links e cartões clicáveis (botão dentro de botão é HTML inválido). O clique não sobe para
 * quem está em volta: ampliar a foto não abre a pasta do produto nem seleciona a linha.
 *
 * `alt` é o texto descritivo da foto ampliada ("Foto de Banner em lona 440 g"). A miniatura em si
 * é decorativa (`alt=""`), e quem lê a tela ouve o rótulo do botão, "Ampliar foto de ...".
 */
export function FotoAmpliavel({
  url,
  alt,
  legenda,
  className,
  children,
}: {
  url: string;
  /** Descrição da foto. Sem ela o texto cai num genérico, e o nome do produto deve ser passado sempre que houver. */
  alt?: string;
  legenda?: string | null;
  /** Classes do gatilho (ex.: `w-full` quando a miniatura ocupa a largura da grade). */
  className?: string;
  /** A miniatura em si. */
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(false);
  const [cartao, setCartao] = useState(false);
  const descricao = (alt ?? "").trim() || "Foto do produto";

  function abrir(e: MouseEvent | KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    setCartao(false);
    setAberta(true);
  }

  return (
    <>
      <HoverCard open={cartao && !aberta} onOpenChange={setCartao} openDelay={250} closeDelay={80}>
        <HoverCardTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Ampliar ${descricao.charAt(0).toLowerCase()}${descricao.slice(1)}`}
            data-foto-ampliavel="gatilho"
            onClick={abrir}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") abrir(e);
            }}
            className={cn(
              "inline-block shrink-0 cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            {children}
          </span>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          className="w-72 p-2"
          data-foto-ampliavel="cartao"
        >
          <img src={url} alt="" className="h-64 w-full rounded bg-muted object-contain" />
          {legenda ? <p className="mt-2 text-base text-foreground">{legenda}</p> : null}
        </HoverCardContent>
      </HoverCard>
      {/* O diálogo mora num portal, mas os eventos dele sobem pela árvore do React: sem esta capa, um toque
          na foto ampliada chegaria à linha ou ao link que está por trás da miniatura. */}
      <span
        className="contents"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Dialog open={aberta} onOpenChange={setAberta}>
          <DialogContent
            aria-describedby={undefined}
            data-foto-ampliavel="tela-cheia"
            className="left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-3 rounded-none border-0 bg-black/95 p-4 text-white ring-0 sm:rounded-none"
          >
            <DialogTitle className="sr-only">{descricao}</DialogTitle>
            <img
              src={url}
              alt={descricao}
              className="max-h-[calc(100dvh-6rem)] max-w-full object-contain"
            />
            {legenda ? <p className="text-center text-base text-white">{legenda}</p> : null}
          </DialogContent>
        </Dialog>
      </span>
    </>
  );
}
