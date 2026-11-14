import { Bot } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { seloDaTriagem, type SeloDaTriagem as Selo, type TomDoSelo } from "@/domain/whatsapp/triagem/selo";
import { useTriagensDaCaixa } from "@/components/whatsapp/usar-triagens-da-caixa";

const TOM: Record<TomDoSelo, string> = {
  neutro: "border-border bg-muted text-foreground",
  ok: "border-success bg-success/15 text-foreground",
  atencao: "border-warning bg-warning/15 text-foreground",
};

const CAIXA = "inline-flex min-w-0 max-w-full items-start gap-1 rounded-md border px-1.5 py-0.5 text-sm font-medium leading-5";

/**
 * O desenho do selo, sem leitura de dados (testável sozinho).
 *
 * Lista: só o estado curto, em 14 px, que quebra de linha em vez de ser cortado. A frase completa e a explicação ficam em
 * texto para leitor de tela (`sr-only`), e o balão com a explicação (14 px) é só um extra para quem usa mouse: o toque
 * não abre balão, por isso nada que a pessoa precise saber mora só nele.
 *
 * Cabeçalho: a frase completa e, logo abaixo, a explicação por escrito, em 14 px, sempre visível.
 */
export function SeloVisual({
  selo,
  variante,
  className,
}: {
  selo: Selo;
  variante: "lista" | "cabecalho";
  className?: string;
}) {
  if (variante === "cabecalho") {
    return (
      <span className={cn("mt-1 block min-w-0 max-w-full", className)}>
        <span className={cn(CAIXA, TOM[selo.tom])}>
          <Bot className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 whitespace-normal break-words">{selo.frase}</span>
        </span>
        <span className="mt-0.5 block whitespace-normal break-words text-sm leading-5 text-foreground">
          {selo.explicacao}
        </span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex min-w-0 max-w-full", className)}>
          <span className={cn(CAIXA, TOM[selo.tom])}>
            <Bot className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 whitespace-normal break-words" aria-hidden="true">
              {selo.estado}
            </span>
            <span className="sr-only">
              {selo.frase}. {selo.explicacao}
            </span>
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-sm leading-relaxed">
        {selo.explicacao}
      </TooltipContent>
    </Tooltip>
  );
}

/** O selo da linha da lista. O estado vem pronto da lista, que fez UMA leitura para todas as linhas visíveis. */
export function SeloDaTriagemNaLista({ status, className }: { status: string | undefined; className?: string }) {
  const selo = seloDaTriagem(status);
  if (!selo) return null;
  return <SeloVisual selo={selo} variante="lista" className={className} />;
}

/**
 * O selo do cabeçalho da conversa aberta: lê só esta conversa. Sem registro de triagem real, não renderiza nada. Erro de
 * leitura esconde o enfeite, mas a consulta fica em erro (a tela de métricas mostra isso). Nada daqui chega ao contato.
 */
export function SeloDaTriagem({ conversaId, className }: { conversaId: string; className?: string }) {
  const { data } = useTriagensDaCaixa([conversaId]);
  const selo = seloDaTriagem(data?.porConversa.get(conversaId)?.status);
  if (!selo) return null;
  return <SeloVisual selo={selo} variante="cabecalho" className={className} />;
}
