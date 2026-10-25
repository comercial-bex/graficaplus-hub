import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth-context";
import { usePendencias } from "@/hooks/usePendencias";
import { numerosDoDia } from "@/domain/painel/resumo-do-dia";
import { cn } from "@/lib/utils";

const TOM = {
  critico: "border-l-[color:var(--bex-magenta)]",
  atencao: "border-l-[color:var(--bex-amber)]",
  ok: "border-l-[color:var(--bex-cyan)]",
} as const;

const TEXTO = {
  critico: "text-[color:var(--bex-magenta)]",
  atencao: "text-[color:var(--bex-amber)]",
  ok: "text-[color:var(--bex-cyan)]",
} as const;

/**
 * "Seu dia": até quatro números grandes, cada um um toque até a tela onde se resolve. Os mesmos
 * números das pendências logo abaixo (contados no banco), só que primeiro e sem ler texto.
 * Enquanto carrega ou quando o papel não tem nada, não desenha nada além de, quando carregou e
 * está tudo em dia, uma linha dizendo isso.
 */
export function ResumoDoDia({ className }: { className?: string }) {
  const { roles } = useAuth();
  const { data, isSuccess } = usePendencias();
  if (!isSuccess || !data || roles.length === 0) return null;

  const numeros = numerosDoDia(data, roles);
  if (numeros.length === 0) {
    return (
      <p
        className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
        data-testid="resumo-do-dia"
      >
        <CheckCircle2 className="h-4 w-4" /> Seu dia está em dia: nada pendente para o seu papel.
      </p>
    );
  }

  return (
    <section className={className} aria-label="Seu dia" data-testid="resumo-do-dia">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {numeros.map((n) => (
          <Link
            key={n.chave}
            to={n.link}
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card
              className={cn(
                "h-full border-l-4 bg-card transition-colors hover:bg-muted",
                TOM[n.severidade],
              )}
            >
              <CardContent className="p-3">
                <p
                  className={cn(
                    "font-mono text-3xl font-semibold tabular-nums",
                    TEXTO[n.severidade],
                  )}
                >
                  {n.quantidade}
                </p>
                <p className="text-sm text-muted-foreground">{n.curto}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
