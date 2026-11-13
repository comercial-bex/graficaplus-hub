import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * O "?" do título de uma seção da gaveta, com alvo de toque de 44 px (revisão
 * da onda 1, 12/11/2026). O `DicaIcone` do sistema tem 16 px no mouse e 32 px
 * no celular, e no mouse nem entra pela tecla Tab; aqui o botão tem 44 px
 * sempre, abre ao clique, ao toque e pelo teclado (Enter ou espaço), e o
 * texto de ajuda vem de `src/lib/dicas.ts`. As margens negativas mantêm o
 * título compacto: o alvo é de 44 px, a linha não cresce.
 */
export function AjudaDaSecao({ texto, rotulo }: { texto?: string | null; rotulo: string }) {
  if (!texto) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ajuda: ${rotulo}`}
          className="-my-3 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent collisionPadding={16} className="max-w-[calc(100vw-2rem)] p-3 text-sm leading-relaxed">
        {texto}
      </PopoverContent>
    </Popover>
  );
}
