import { Gift, PartyPopper, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import {
  progressoDaMeta,
  textoDaRecompensa,
  type Campanha,
  type Conquista,
} from "@/domain/parceiros/painel";

/**
 * Metas em andamento e o que já foi conquistado.
 *
 * O prêmio aparece antes do número: o parceiro corre atrás do "4 m² de lona",
 * não do "R$ 800 de R$ 1.000".
 */
export function Metas({ campanhas, conquistas }: { campanhas: Campanha[]; conquistas: Conquista[] }) {
  if (campanhas.length === 0 && conquistas.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Target className="h-5 w-5 text-[color:var(--bex-magenta)]" />
        Metas
        <DicaIcone texto={dicaCampo("/parceiro", "metas")} rotulo="Metas" />
      </h2>

      {campanhas.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {campanhas.map((c) => (
            <MetaCard key={c.id} campanha={c} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma meta aberta agora. A próxima aparece aqui.</p>
      )}

      {conquistas.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Trophy className="h-4 w-4 text-[color:var(--bex-amber)]" />
            Suas conquistas
          </p>
          <ul className="divide-y divide-border text-sm">
            {conquistas.map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{x.recompensa}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {x.campanha} · {new Date(x.alcancado_em).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    x.status === "entregue"
                      ? "bg-foreground/10 text-muted-foreground"
                      : "bg-[color:var(--bex-amber)]/15 text-[color:var(--bex-amber)]",
                  )}
                >
                  {x.status === "entregue"
                    ? x.recompensa_tipo === "credito"
                      ? "No seu crédito"
                      : "Entregue"
                    : "A gráfica vai entregar"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MetaCard({ campanha }: { campanha: Campanha }) {
  const p = progressoDaMeta(campanha);
  return (
    <article
      className={cn(
        "rounded-2xl border bg-card p-4",
        p.conquistada ? "border-[color:var(--bex-amber)]/50" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            p.conquistada
              ? "bg-[color:var(--bex-amber)]/15 text-[color:var(--bex-amber)]"
              : "bg-[color:var(--bex-magenta)]/15 text-[color:var(--bex-magenta)]",
          )}
        >
          {p.conquistada ? <PartyPopper className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-balance">{textoDaRecompensa(campanha)}</p>
          <p className="text-sm text-muted-foreground">{campanha.titulo}</p>
        </div>
        {p.prazo && (
          <span className="shrink-0 text-[11px] text-muted-foreground">{p.prazo}</span>
        )}
      </div>
      {campanha.descricao && <p className="mt-2 text-sm text-muted-foreground">{campanha.descricao}</p>}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{
            width: `${p.pct}%`,
            background: p.conquistada ? "var(--bex-amber)" : "var(--bex-magenta)",
          }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-muted-foreground">{p.andamento}</span>
        <span className={cn("font-medium", p.conquistada && "text-[color:var(--bex-amber)]")}>{p.falta}</span>
      </div>
    </article>
  );
}
