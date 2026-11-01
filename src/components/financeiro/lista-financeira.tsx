import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TotaisDaLista } from "@/domain/financeiro/lista-de-contas";

/**
 * Peças da lista financeira no desenho do Holdprint (31/10/2026), Onda 3 do plano
 * `docs/plano-interface-holdprint-31-10-2026.md`: busca, chips, aviso de recorte e rodapé
 * de totais. A conta fica em `src/domain/financeiro/lista-de-contas.ts`.
 */

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface OpcaoDeChip<Id extends string> {
  id: Id;
  rotulo: string;
  quantidade?: number;
}

/** Escolha de uma opção entre poucas. Leitor de tela anuncia "grupo de opções" e a marcada. */
export function GrupoDeChips<Id extends string>({
  rotulo,
  opcoes,
  valor,
  onChange,
}: {
  rotulo: string;
  opcoes: ReadonlyArray<OpcaoDeChip<Id>>;
  valor: Id;
  onChange: (id: Id) => void;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativo
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {o.rotulo}
            {o.quantidade !== undefined && <span className="tabular-nums">{o.quantidade}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function CampoDeBusca({
  rotulo,
  placeholder,
  valor,
  onChange,
}: {
  rotulo: string;
  placeholder: string;
  valor: string;
  onChange: (texto: string) => void;
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={rotulo}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 pl-10 text-base"
      />
    </div>
  );
}

/** Quando a lista mostra só parte, diz quanto e dá o caminho de volta. */
export function AvisoDeFiltro({
  mostrando,
  total,
  onLimpar,
}: {
  mostrando: number;
  total: number;
  onLimpar: () => void;
}) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>
        Mostrando <strong className="text-foreground">{mostrando}</strong> de {total}
      </span>
      <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={onLimpar}>
        Limpar filtros
      </Button>
    </p>
  );
}

const CELULAS: ReadonlyArray<{ chave: keyof Omit<TotaisDaLista, "quantidade">; rotulo: string; ponto: string }> = [
  { chave: "aVencer", rotulo: "A vencer", ponto: "bg-[color:var(--bex-amber)]" },
  { chave: "vencidas", rotulo: "Vencidas", ponto: "bg-[color:var(--bex-magenta)]" },
  { chave: "pagas", rotulo: "Pagas", ponto: "bg-[color:var(--bex-lime)]" },
  { chave: "total", rotulo: "Total", ponto: "bg-foreground" },
];

/** Totais do que está na tela. O ponto colorido enfeita; quem diz a situação é o texto. */
export function RodapeDeTotais({
  totais,
  rotuloPagas = "Pagas",
}: {
  totais: TotaisDaLista;
  /** Na lista de contas a receber o dinheiro que entrou se chama "Recebidas". */
  rotuloPagas?: string;
}) {
  return (
    <dl
      aria-label="Totais da lista"
      className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4"
    >
      {CELULAS.map((c) => (
        <div key={c.chave} className="bg-muted px-4 py-3">
          <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", c.ponto)} />
            {c.chave === "pagas" ? rotuloPagas : c.rotulo}
          </dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{moeda(totais[c.chave])}</dd>
        </div>
      ))}
    </dl>
  );
}
