import { LOGO_FUNDO_ESCURO } from "@/lib/marca";
import { cn } from "@/lib/utils";

/** O que o sistema cobre, na ordem em que o trabalho anda na gráfica. */
const AREAS = [
  { nome: "Orçamentos", cor: "bg-bex-cyan" },
  { nome: "Ordens de serviço", cor: "bg-bex-magenta" },
  { nome: "Produção", cor: "bg-bex-amber" },
  { nome: "Financeiro", cor: "bg-bex-lime" },
];

/**
 * Painel escuro da marca, ao lado do formulário de entrada.
 *
 * Usa os tokens da barra lateral, que são escuros nos dois temas (regra em
 * AGENTS.md): a logo tem letras brancas, então o fundo tem de continuar
 * escuro mesmo com o conteúdo no tema claro. No celular vira uma faixa curta
 * em cima, só com a logo — o espaço é do formulário.
 */
export function PainelDaMarca() {
  return (
    <aside className="relative overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:w-[46%] lg:max-w-2xl lg:flex-col lg:justify-between">
      {/* Pontilhado e brilhos: cores da marca com transparência, nunca cor fixa. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(color-mix(in oklab, var(--sidebar-foreground) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-bex-cyan/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-bex-magenta/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: "var(--gradient-cmyk)" }}
      />

      <div className="relative flex items-center justify-center px-6 py-6 lg:items-start lg:justify-start lg:px-12 lg:pt-14">
        <img
          src={LOGO_FUNDO_ESCURO}
          alt="Bex Print"
          width={1165}
          height={532}
          className="h-auto w-40 max-w-full lg:w-56"
        />
      </div>

      <div className="relative hidden px-12 pb-14 lg:block">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-sidebar-foreground/70">
          Sistema da gráfica
        </p>
        <p className="mt-3 max-w-md text-3xl font-semibold leading-tight text-sidebar-accent-foreground">
          Do orçamento à entrega, tudo em um lugar só.
        </p>
        <ul className="mt-8 grid max-w-md grid-cols-2 gap-3 text-sm">
          {AREAS.map((area) => (
            <li key={area.nome} className="flex items-center gap-2.5">
              <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", area.cor)} />
              {area.nome}
            </li>
          ))}
        </ul>
        <p className="mt-10 text-xs text-sidebar-foreground/70">Bex Print · Macapá, Amapá</p>
      </div>
    </aside>
  );
}
