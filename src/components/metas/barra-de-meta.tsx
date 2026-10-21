import { marcos, posicaoNaBarra, type MetaDoMes, type NivelMeta } from "@/domain/metas/progresso";
import { cn } from "@/lib/utils";

/**
 * A barra da meta: vai do zero ao Diamante, com os marcos 50%, 75%, Ouro e
 * Diamante. Duas camadas — a clara é o que já foi VENDIDO, a cheia é o que já
 * foi PAGO (é o pago que define o nível). A cor da camada cheia acompanha o
 * nível: azul-Bex a caminho, âmbar no Ouro, ciano no Diamante.
 *
 * Os marcos têm texto e ícone de estado (preenchido x vazado), nunca só cor.
 */

const COR_DO_NIVEL: Record<NivelMeta, string> = {
  nenhum: "var(--primary)",
  ouro: "var(--bex-amber)",
  diamante: "var(--bex-cyan)",
};

export function BarraDeMeta({ meta, compacta = false, className }: { meta: MetaDoMes; compacta?: boolean; className?: string }) {
  const cor = COR_DO_NIVEL[meta.nivel];
  const pago = posicaoNaBarra(meta.pago, meta);
  const vendido = posicaoNaBarra(meta.vendido, meta);
  const lista = marcos(meta);
  const pctDaMeta = meta.meta > 0 ? Math.round((meta.pago / meta.meta) * 100) : 0;

  return (
    <div className={cn("pb-6", className)}>
      <div
        role="progressbar"
        aria-label="Progresso da meta de vendas"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctDaMeta}
        aria-valuetext={`${pctDaMeta}% da meta paga, nível ${meta.nivel === "nenhum" ? "ainda sem nível" : meta.nivel}`}
        className={cn("relative w-full overflow-hidden rounded-full bg-muted", compacta ? "h-2.5" : "h-4")}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${vendido}%`, background: `color-mix(in oklab, ${cor} 28%, transparent)` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${pago}%`, background: cor }}
        />
      </div>

      <div className="relative mt-1 h-5" aria-hidden="true">
        {lista.map((mc) => {
          const fim = mc.posicao >= 99;
          const destaque = mc.nivel != null;
          return (
            <div
              key={mc.chave}
              className={cn(
                "absolute top-0 flex flex-col items-center text-[11px] leading-tight",
                fim ? "-translate-x-full items-end" : "-translate-x-1/2",
                mc.atingido ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
              style={{ left: `${mc.posicao}%` }}
            >
              <span
                className={cn("mb-0.5 h-1.5 w-px", mc.atingido ? "bg-foreground" : "bg-muted-foreground/60")}
              />
              <span className={cn(destaque && "uppercase tracking-wide")}>
                {mc.atingido && destaque ? "✓ " : ""}
                {mc.rotulo}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
