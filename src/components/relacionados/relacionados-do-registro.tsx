import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Destino, Elo, Tom } from "@/domain/relacionados/elos";

/**
 * A faixa "Relacionados" (23/11/2026): só desenha os elos que o domínio decidiu (`src/domain/relacionados/elos.ts`).
 * Sem elo, não desenha nada (a ficha do cliente de quem não vê finanças nem é parceiro fica como estava).
 *
 * Cada elo é um bloco de toque (44 px), com o link só quando a pessoa abre a tela. Cor nunca é a única pista: a atenção
 * leva o ícone e o texto "Atenção" para leitor de tela, e o erro diz "Erro".
 */

const CLASSE_DO_BLOCO =
  "flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-lg border px-3 py-2 text-left";

const BORDA: Record<Tom, string> = {
  normal: "border-border",
  vazio: "border-border",
  carregando: "border-border",
  atencao: "border-[color:var(--warning)]",
  erro: "border-destructive",
};

function LinkDoElo({ destino, className, children }: { destino: Destino; className: string; children: ReactNode }) {
  switch (destino.rota) {
    case "cliente":
      return (
        <Link to="/clientes/$id" params={{ id: destino.id }} className={className}>
          {children}
        </Link>
      );
    case "orcamento":
      return (
        <Link to="/orcamentos/$id" params={{ id: destino.id }} className={className}>
          {children}
        </Link>
      );
    case "os":
      return (
        <Link to="/os/$id" params={{ id: destino.id }} className={className}>
          {children}
        </Link>
      );
    case "produto":
      return (
        <Link to="/produtos/$id" params={{ id: destino.id }} className={className}>
          {children}
        </Link>
      );
    case "conversa":
      return (
        <Link to="/whatsapp" search={{ conversa: destino.id }} className={className}>
          {children}
        </Link>
      );
    case "a-receber":
      return (
        <Link to="/a-receber" className={className}>
          {children}
        </Link>
      );
    case "entregas":
      return (
        <Link to="/entregas" className={className}>
          {children}
        </Link>
      );
    case "parceiros":
      return (
        <Link to="/parceiros" className={className}>
          {children}
        </Link>
      );
  }
}

function ConteudoDoElo({ elo, comLink }: { elo: Elo; comLink: boolean }) {
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{elo.rotulo}</span>
        {comLink ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </span>
      <span
        className={cn(
          "flex items-start gap-1.5 text-sm font-medium",
          (elo.tom === "vazio" || elo.tom === "carregando") && "text-muted-foreground",
          elo.tom === "erro" && "text-destructive",
        )}
      >
        {elo.tom === "atencao" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        <span className="min-w-0 break-words">
          {elo.tom === "atencao" ? <span className="sr-only">Atenção: </span> : null}
          {elo.tom === "erro" ? <span className="sr-only">Erro: </span> : null}
          {elo.texto}
        </span>
      </span>
      {elo.detalhe ? <span className="break-words text-xs text-muted-foreground">{elo.detalhe}</span> : null}
    </>
  );
}

export function RelacionadosDoRegistro({ elos }: { elos: Elo[] }) {
  const titulo = useId();
  if (elos.length === 0) return null;
  return (
    <section
      className="rounded-xl border border-border bg-card p-4 text-card-foreground"
      aria-labelledby={titulo}
      data-testid="relacionados"
    >
      <h2 id={titulo} className="mb-3 text-sm font-semibold">
        Relacionados
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {elos.map((elo) => (
          <li key={elo.chave} data-testid={`elo-${elo.chave}`} data-tom={elo.tom}>
            {elo.destino ? (
              <LinkDoElo
                destino={elo.destino}
                className={cn(
                  CLASSE_DO_BLOCO,
                  BORDA[elo.tom],
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <ConteudoDoElo elo={elo} comLink />
              </LinkDoElo>
            ) : (
              <div className={cn(CLASSE_DO_BLOCO, BORDA[elo.tom])} aria-busy={elo.tom === "carregando" || undefined}>
                <ConteudoDoElo elo={elo} comLink={false} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
