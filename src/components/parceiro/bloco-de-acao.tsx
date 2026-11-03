import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DicaIcone } from "@/components/bex/Dica";
import { ArrowRight, type LucideIcon } from "lucide-react";

/** Número que sobe contando ao abrir; respeita quem pediu menos movimento. */
export function Contador({ valor, formato }: { valor: number; formato?: (v: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(valor);
    let raf = 0;
    const inicio = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - inicio) / 700);
      setV(valor * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return <>{formato ? formato(v) : Math.round(v)}</>;
}

export type LinhaDoBloco = { id: string; titulo: string; detalhe: string; valor?: string; selo?: string; para: string };

export function BlocoDeAcao(props: {
  cor: "venda" | "orcamento";
  icone: LucideIcon;
  sobretitulo: string;
  titulo: string;
  dica?: string;
  tour?: string;
  acao: ReactNode;
  numeros: { rotulo: string; valor: number; formato?: (v: number) => string; dica?: string }[];
  linhas: LinhaDoBloco[];
  vazio: string;
  verTodos: { rotulo: string; para: string };
  atraso?: number;
}) {
  const c = `var(--${props.cor})`;
  const Icone = props.icone;
  return (
    <section
      data-testid={`bloco-${props.cor}`}
      data-tour={props.tour}
      className="bloco-entra group relative flex flex-col overflow-hidden rounded-3xl border bg-card p-5 transition-all duration-300 hover:-translate-y-1 md:p-6"
      style={{
        animationDelay: `${props.atraso ?? 0}ms`,
        borderColor: `color-mix(in oklab, ${c} 30%, var(--border))`,
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, ${c} 16%, transparent), transparent 60%)`,
        boxShadow: `0 18px 40px -28px color-mix(in oklab, ${c} 70%, transparent)`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: c }} />
      <div className="flex items-start gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-110"
          style={{ background: `color-mix(in oklab, ${c} 18%, transparent)`, color: c }}
        >
          <Icone className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: c }}>
            {props.sobretitulo}
          </p>
          <h2 className="flex items-center gap-1 text-xl font-bold leading-tight md:text-2xl">
            {props.titulo}
            <DicaIcone texto={props.dica} rotulo={props.titulo} />
          </h2>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {props.numeros.map((n) => (
          <div key={n.rotulo} className="rounded-2xl border border-border/60 bg-background/60 p-3">
            <p className="truncate text-lg font-bold tabular-nums md:text-2xl">
              <Contador valor={n.valor} formato={n.formato} />
            </p>
            <p className="flex items-center gap-0.5 text-xs leading-tight text-muted-foreground">
              {n.rotulo}
              <DicaIcone texto={n.dica} rotulo={n.rotulo} className="h-3.5 w-3.5" />
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 [&_button]:h-12 [&_button]:w-full [&_button]:text-base [&_button]:transition-transform [&_button:active]:scale-[0.97] [&_a]:w-full">
        {props.acao}
      </div>

      <ul className="mt-4 flex-1 divide-y divide-border/60">
        {props.linhas.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">{props.vazio}</li>}
        {props.linhas.map((l) => (
          <li key={l.id}>
            <Link to={l.para} className="flex items-center gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-foreground/5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.titulo}</p>
                <p className="truncate text-xs text-muted-foreground">{l.detalhe}</p>
              </div>
              {l.selo && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ background: `color-mix(in oklab, ${c} 14%, transparent)`, color: c }}
                >
                  {l.selo}
                </span>
              )}
              {l.valor && <span className="shrink-0 text-sm font-semibold tabular-nums">{l.valor}</span>}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to={props.verTodos.para}
        className="mt-3 inline-flex items-center gap-1 self-start text-sm font-semibold"
        style={{ color: c }}
      >
        {props.verTodos.rotulo}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </Link>
    </section>
  );
}
