import { escalaDePrecos, type Marcador } from "@/domain/precos/tabela-de-precos";
import { Dica } from "@/components/bex/Dica";
import { cn } from "@/lib/utils";
import { brl } from "./tipos";

const COR: Record<Marcador["tipo"], string> = {
  custo: "bg-muted-foreground",
  piso: "bg-warning",
  nos: "bg-primary",
  parceiro: "bg-success",
  concorrente: "bg-destructive",
};
export const LEGENDA_DA_BARRA: Array<{ tipo: Marcador["tipo"]; rotulo: string }> = [
  { tipo: "custo", rotulo: "Custo" },
  { tipo: "piso", rotulo: "Piso da margem" },
  { tipo: "nos", rotulo: "Venda final" },
  { tipo: "parceiro", rotulo: "Parceiro" },
  { tipo: "concorrente", rotulo: "Concorrente" },
];

/**
 * Régua única de preço: custo, piso da margem, nossa venda, parceiro e
 * concorrentes na MESMA escala. Quem está à esquerda do custo vende no
 * prejuízo; a faixa entre o custo e o piso é margem abaixo do mínimo.
 */
export function BarraDeComparacao({ marcadores, className }: { marcadores: Marcador[]; className?: string }) {
  const escala = escalaDePrecos(marcadores);
  if (!escala) {
    return <div className={cn("flex h-9 items-center text-xs text-muted-foreground", className)}>Falta preço para comparar.</div>;
  }
  const custo = escala.marcadores.find((m) => m.tipo === "custo");
  const piso = escala.marcadores.find((m) => m.tipo === "piso");
  return (
    <div className={cn("relative h-9", className)} role="img" aria-label={escala.marcadores.map((m) => `${m.rotulo} ${brl(m.valor)}`).join(", ")}>
      <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-muted" />
      {custo && piso && piso.posPct > custo.posPct && (
        <div className="absolute top-4 h-1.5 bg-warning/40" style={{ left: `${custo.posPct}%`, width: `${piso.posPct - custo.posPct}%` }} />
      )}
      {custo && <div className="absolute right-0 top-4 h-1.5 bg-success/25" style={{ left: `${(piso ?? custo).posPct}%` }} />}
      {escala.marcadores.map((m) => (
        <Dica key={m.chave} texto={`${m.rotulo}: ${brl(m.valor)}`}>
          <span className="absolute top-3 -translate-x-1/2" style={{ left: `${Math.min(97, Math.max(3, m.posPct))}%` }}>
            <span className={cn("block h-3.5 w-3.5 rounded-full border-2 border-card", COR[m.tipo])} />
            <span className="sr-only">{m.rotulo}</span>
          </span>
        </Dica>
      ))}
    </div>
  );
}

export function LegendaDaBarra() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {LEGENDA_DA_BARRA.map((l) => (
        <li key={l.tipo} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", COR[l.tipo])} /> {l.rotulo}
        </li>
      ))}
    </ul>
  );
}
