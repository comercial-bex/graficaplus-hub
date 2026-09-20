import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, ChevronDown, ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { usePendencias, type Pendencia } from "@/hooks/usePendencias";
import { guiaDe, rotulosDoPapel, ROTULO_PAPEL, type PapelResolvedor } from "@/lib/pendenciasGuia";
import { cn } from "@/lib/utils";

/**
 * "O que falta de mim" — o que o sistema está esperando de quem está logado.
 *
 * O painel do Bex Print era um só para os dez papéis: o financeiro e o
 * impressor viam a mesma tela, mudando apenas se os valores apareciam. Aqui
 * cada papel recebe as contas que só ele resolve, com o caminho literal e o
 * botão que leva direto ao destino.
 *
 * Some quando não há nada pendente. Bloco permanente vira moldura e para de
 * ser lido — que é como morre todo aviso de sistema.
 */

const ORDEM: Record<Pendencia["severidade"], number> = { critico: 0, atencao: 1, ok: 2 };

const TOM: Record<Pendencia["severidade"], string> = {
  critico: "border-l-[color:var(--bex-magenta)]",
  atencao: "border-l-[color:var(--bex-amber)]",
  ok: "border-l-[color:var(--bex-cyan)]",
};

const TEXTO: Record<Pendencia["severidade"], string> = {
  critico: "text-[color:var(--bex-magenta)]",
  atencao: "text-[color:var(--bex-amber)]",
  ok: "text-[color:var(--bex-cyan)]",
};

export function PendenciasDoMeuPapel({ className }: { className?: string }) {
  const { roles } = useAuth();
  const { data, isSuccess } = usePendencias();
  const [aberta, setAberta] = useState<string | null>(null);

  const rotulos = rotulosDoPapel(roles);

  // Enquanto carrega, nada — melhor atrasar o aviso do que piscar em falso.
  if (!isSuccess || !data || rotulos.length === 0) return null;

  const minhas = data
    .filter((p) => rotulos.includes(p.quem_resolve as PapelResolvedor))
    .filter((p) => p.quantidade > 0)
    .sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade] || b.quantidade - a.quantidade);

  if (minhas.length === 0) return null;

  const criticas = minhas.filter((p) => p.severidade === "critico").length;

  return (
    <Card className={cn("bg-card border-border", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          O que falta de mim
          {rotulos.map((r) => (
            <Badge key={r} variant="outline" className="text-[10px] font-normal">
              {ROTULO_PAPEL[r]}
            </Badge>
          ))}
          {criticas > 0 && (
            <span className="flex items-center gap-1 text-xs font-normal text-[color:var(--bex-magenta)]">
              <AlertTriangle className="h-3.5 w-3.5" />
              {criticas} {criticas === 1 ? "trava o trabalho" : "travam o trabalho"}
            </span>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Contado agora, no banco — não é relatório de ontem.
        </p>
      </CardHeader>

      <CardContent className="space-y-2">
        {minhas.map((p) => {
          const guia = guiaDe(p.chave);
          const estaAberta = aberta === p.chave;

          return (
            <div key={p.chave} className={cn("rounded-lg border border-l-4 p-3", TOM[p.severidade])}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-medium">{p.titulo}</h4>
                  <p className="font-mono text-sm tabular-nums">
                    <span className={TEXTO[p.severidade]}>{p.quantidade}</span>
                    {p.total != null && <span className="text-muted-foreground"> de {p.total}</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.o_que_fazer}</p>
                </div>

                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link to={p.link}>
                    {guia?.acao ?? "Resolver"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>

              {guia && (
                <>
                  <button
                    type="button"
                    onClick={() => setAberta(estaAberta ? null : p.chave)}
                    aria-expanded={estaAberta}
                    className="mt-2 flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", estaAberta && "rotate-180")}
                    />
                    {estaAberta ? "Esconder o caminho" : "Como resolver"}
                  </button>

                  {estaAberta && (
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                      {guia.passos.map((passo) => (
                        <li key={passo}>{passo}</li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
