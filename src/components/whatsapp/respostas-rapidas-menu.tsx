import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/lib/auth-context";
import { getRoutePermissions } from "@/lib/permissions";
import { mensagemErro } from "@/lib/erros";
import {
  useRespostasRapidas,
  type RespostaRapida,
} from "@/components/whatsapp/usar-caixa-de-entrada";
import { Carregando } from "@/components/bex/Carregando";
import { Dica } from "@/components/bex/Dica";
import { DICAS_WA_CONVERSA } from "@/lib/dicas";
import { cn } from "@/lib/utils";

/**
 * As respostas rápidas, finalmente usadas por alguém.
 *
 * `respostas_rapidas` era cadastrada em /respostas-rapidas e nenhuma tela lia.
 * Escolher uma COLOCA o texto na caixa de resposta — não envia: quem atende
 * confere e ajusta antes (nome do cliente, prazo, valor).
 *
 * Onda 1 (12/11/2026): o botão passa a 44 px (alvo de toque) e mora dentro da
 * caixa de resposta; o "/" no começo da caixa abre a lista pelo teclado (que a
 * própria caixa desenha), e este botão é o caminho do mouse e do dedo.
 */
export function RespostasRapidasMenu({
  onEscolher,
  desabilitado,
  className,
}: {
  onEscolher: (texto: string) => void;
  desabilitado?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const { hasPermission } = useAuth();
  const respostas = useRespostasRapidas();
  // Mesma régua do menu: o link só aparece para quem a rota deixa entrar.
  const podeCadastrar = (getRoutePermissions("/respostas-rapidas") ?? []).some(hasPermission);

  const porCategoria = new Map<string, RespostaRapida[]>();
  for (const r of respostas.data ?? []) {
    const lista = porCategoria.get(r.categoria) ?? [];
    lista.push(r);
    porCategoria.set(r.categoria, lista);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <Dica texto={DICAS_WA_CONVERSA.respostas_rapidas}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={desabilitado}
            aria-label="Respostas rápidas"
            className={cn("size-11 shrink-0", className)}
          >
            <ListChecks className="h-5 w-5" />
          </Button>
        </PopoverTrigger>
      </Dica>
      <PopoverContent className="w-[360px] p-0" align="start" side="top">
        {respostas.isError ? (
          <div className="p-3 text-sm text-destructive">
            Não foi possível carregar as respostas rápidas: {mensagemErro(respostas.error)}
          </div>
        ) : respostas.isPending ? (
          <Carregando />
        ) : (respostas.data ?? []).length === 0 ? (
          <div className="space-y-2 p-3 text-sm">
            <p className="text-muted-foreground">Nenhuma resposta rápida ativa cadastrada.</p>
            {podeCadastrar ? (
              <Link to="/respostas-rapidas" className="text-sm font-medium text-link underline">
                Cadastrar respostas rápidas
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">
                Peça a um administrador para cadastrar.
              </p>
            )}
          </div>
        ) : (
          <Command
            filter={(valor, busca) => (valor.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0)}
          >
            <CommandInput placeholder="Buscar resposta…" />
            <CommandList>
              <CommandEmpty>Nenhuma resposta com esse termo.</CommandEmpty>
              {[...porCategoria.entries()].map(([categoria, lista]) => (
                <CommandGroup key={categoria} heading={categoria}>
                  {lista.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`${r.titulo} ${r.categoria} ${r.texto}`}
                      onSelect={() => {
                        onEscolher(r.texto);
                        setAberto(false);
                      }}
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium">{r.titulo}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{r.texto}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
