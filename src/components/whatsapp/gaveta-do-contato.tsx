import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ConversaDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import type { ModoDaCaixa } from "@/domain/whatsapp/moldura";
import type { DialogoDaConversa } from "@/domain/whatsapp/acoes-de-trabalho";
import { PainelDaConversa } from "@/components/whatsapp/painel-da-conversa";
import { FECHAR_DE_44_PX } from "@/components/whatsapp/fechar-de-44-px";

/**
 * "Dados do contato": a gaveta à direita, como a do WhatsApp Web. Dono:
 * GAVETA (onda 1, 12/11/2026). A MOLDURA decide quando abre e em que modo.
 *
 *   largo     encaixada: um <aside> que a moldura põe na 3ª coluna da grade
 *             (360 px); fechada, não desenha nada.
 *   medio     por cima, à direita (Sheet de 400 px).
 *   estreito  por cima, na tela inteira (Sheet de largura total).
 *
 * O miolo é o PainelDaConversa (cinco seções na ordem do uso, botões de 44 px).
 * Os botões de criar orçamento, criar OS e vincular cliente chamam
 * `onAbrirDialogo`; os diálogos moram em dialogos-da-conversa.tsx, desenhados
 * uma vez pela moldura. No modo largo, sem Sheet, o X de fechar é nosso: o
 * Sheet traz o dele.
 */
export type PropsDaGaveta = {
  conversa: ConversaDaCaixa;
  modo: ModoDaCaixa;
  aberta: boolean;
  onAberta: (aberta: boolean) => void;
  /** Abre um diálogo de trabalho; a moldura guarda qual está aberto. */
  onAbrirDialogo: (d: DialogoDaConversa) => void;
  /** Só no modo largo: as classes da coluna encaixada (a moldura posiciona). */
  className?: string;
};

export function GavetaDoContato({
  conversa,
  modo,
  aberta,
  onAberta,
  onAbrirDialogo,
  className,
}: PropsDaGaveta) {
  if (modo === "largo") {
    if (!aberta) return null;
    return (
      <aside
        aria-label="Dados do contato"
        className={cn("flex min-h-0 flex-col overflow-y-auto border-l bg-card", className)}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b pl-4 pr-2">
          <h2 className="text-base font-semibold">Dados do contato</h2>
          <Button
            type="button"
            variant="ghost"
            className="size-11 p-0"
            aria-label="Fechar dados do contato"
            onClick={() => onAberta(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <PainelDaConversa
          conversa={conversa}
          onAbrirDialogo={onAbrirDialogo}
          className="border-0 shadow-none"
        />
      </aside>
    );
  }
  return (
    <Sheet open={aberta} onOpenChange={onAberta}>
      <SheetContent
        side="right"
        className={cn(
          "overflow-y-auto p-0",
          FECHAR_DE_44_PX,
          modo === "estreito"
            ? "w-full max-w-none sm:max-w-none"
            : "w-[400px] max-w-[92vw] sm:max-w-[400px]",
        )}
      >
        <SheetHeader className="flex h-16 justify-center border-b p-4 pr-14 text-left">
          <SheetTitle className="text-base">Dados do contato</SheetTitle>
          <SheetDescription className="sr-only">
            Quem é o contato, orçamentos e OS ligados, atendimentos e etiquetas desta conversa.
          </SheetDescription>
        </SheetHeader>
        <PainelDaConversa
          conversa={conversa}
          // O diálogo abre por cima da gaveta e ela fica por baixo: depois de
          // vincular o cliente, a pessoa vê a seção Contato já atualizada. O Esc
          // fecha só a camada de cima (o Radix empilha as duas).
          onAbrirDialogo={onAbrirDialogo}
          className="border-0 shadow-none"
        />
      </SheetContent>
    </Sheet>
  );
}
