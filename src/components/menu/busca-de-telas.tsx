import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { dicasDoMenu } from "@/lib/dicas";
import { telasAchadas, type PaginaDaBusca } from "@/lib/menu";

/** Agrupa mantendo a ordem em que os grupos aparecem (Geral, depois as áreas). */
function agrupar(paginas: PaginaDaBusca[]): { grupo: string; paginas: PaginaDaBusca[] }[] {
  const grupos: { grupo: string; paginas: PaginaDaBusca[] }[] = [];
  for (const p of paginas) {
    const g = grupos.find((x) => x.grupo === p.grupo);
    if (g) g.paginas.push(p);
    else grupos.push({ grupo: p.grupo, paginas: [p] });
  }
  return grupos;
}

/**
 * A busca de telas (Ctrl+K, ⌘K no Mac): toda tela que a pessoa abre, achada
 * pelo nome — o novo, o antigo do menu ou o pedaço da URL —, com ou sem acento.
 *
 * Só lista o que a pessoa abre: a lista vem do mesmo filtro do menu, então a
 * busca nunca oferece uma porta que o guarda fecha.
 *
 * O filtro é nosso, não o do cmdk: o dele não ignora acento ("orcamento" não
 * achava "Orçamentos") e, com grupos, deixava o melhor resultado embaixo de
 * um pior. Com algo digitado a lista é uma só, da melhor nota para a pior.
 */
export function BuscaDeTelas({
  paginas,
  aberta,
  aoMudar,
  aoEscolher,
}: {
  paginas: PaginaDaBusca[];
  aberta: boolean;
  aoMudar: Dispatch<SetStateAction<boolean>>;
  aoEscolher: (url: string) => void;
}) {
  const [digitado, setDigitado] = useState("");

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        aoMudar((v) => !v);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoMudar]);

  // Cada abertura começa do zero.
  useEffect(() => {
    if (!aberta) setDigitado("");
  }, [aberta]);

  const achadas = digitado.trim() ? telasAchadas(paginas, digitado) : null;
  const grupos = achadas ? [{ grupo: "Telas encontradas", paginas: achadas }] : agrupar(paginas);

  return (
    <Dialog open={aberta} onOpenChange={aoMudar}>
      <DialogContent className="top-[8%] max-w-[calc(100vw-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-[14%] sm:max-w-lg">
        <DialogTitle className="sr-only">Buscar tela</DialogTitle>
        <DialogDescription className="sr-only">{dicasDoMenu.busca}</DialogDescription>
        <Command shouldFilter={false} loop className="rounded-none">
          <CommandInput
            value={digitado}
            onValueChange={setDigitado}
            placeholder="Buscar tela… (ex.: receber, leads, agenda)"
            className="h-12 pr-8 text-base md:text-sm"
          />
          <CommandList className="max-h-[min(60dvh,420px)]">
            <CommandEmpty>Nenhuma tela com esse nome entre as que você abre.</CommandEmpty>
            {grupos.map((g) => (
              <CommandGroup key={g.grupo} heading={g.grupo}>
                {g.paginas.map((p) => (
                  <CommandItem
                    key={p.url}
                    value={p.url}
                    onSelect={() => aoEscolher(p.url)}
                    className="group min-h-11 gap-3 md:min-h-9"
                  >
                    <p.icon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                    {p.onde && (
                      // Na linha marcada o fundo é o accent: o cinza some nele.
                      <span className="hidden shrink-0 text-xs text-muted-foreground group-data-[selected=true]:text-accent-foreground/80 sm:inline">
                        {p.onde}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
