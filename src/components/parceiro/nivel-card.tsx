import { useState } from "react";
import { Check, ChevronDown, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl } from "@/domain/parceiros/preco";
import { progressoDoNivel, type PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * O nível do parceiro e o caminho até o próximo.
 *
 * A barra mede do piso do nível atual ao piso do próximo — começar do zero faria
 * um parceiro Prata olhar uma barra quase cheia e achar que falta pouco para Ouro.
 */
export function NivelCard({ painel }: { painel: PainelDoParceiro }) {
  const [regua, setRegua] = useState(false);
  const { nivel, niveis } = painel;
  const progresso = progressoDoNivel(nivel, niveis);
  const cor = nivel.cor ?? "#35c9ec";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-2xl"
        style={{ background: cor }}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Seu nível</p>
          <h2 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight" style={{ color: cor }}>
            <Crown className="h-6 w-6" />
            {nivel.nome ?? "—"}
          </h2>
          {nivel.fixado && (
            <p className="mt-1 text-xs text-muted-foreground">Nível garantido pela gráfica.</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Desconto</p>
          <p className="text-2xl font-bold tabular-nums">{fmtPct(nivel.desconto_pct)}</p>
          {Number(nivel.cashback_pct) > 0 && (
            <p className="text-xs text-muted-foreground">+ {fmtPct(nivel.cashback_pct)} de volta</p>
          )}
        </div>
      </div>

      <div className="relative mt-5">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${progresso.pct}%`, background: cor }}
          />
        </div>
        <p className="mt-3 font-semibold text-balance">{progresso.titulo}</p>
        <p className="text-sm text-muted-foreground">{progresso.detalhe}</p>
      </div>

      {nivel.beneficios.length > 0 && (
        <ul className="relative mt-4 flex flex-wrap gap-2">
          {nivel.beneficios.map((b) => (
            <li
              key={b}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-xs"
            >
              <Check className="h-3 w-3" style={{ color: cor }} />
              {b}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setRegua((v) => !v)}
        className="relative mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        aria-expanded={regua}
      >
        Como subir de nível
        <ChevronDown className={cn("h-4 w-4 transition-transform", regua && "rotate-180")} />
      </button>

      {regua && (
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Nível</th>
                <th className="py-2 pr-3 font-medium">Compras em 90 dias</th>
                <th className="py-2 pr-3 text-right font-medium">Desconto</th>
                <th className="py-2 text-right font-medium">Volta em crédito</th>
              </tr>
            </thead>
            <tbody>
              {niveis.map((n) => (
                <tr
                  key={n.id}
                  className={cn("border-t border-border", n.id === nivel.id && "bg-foreground/5 font-semibold")}
                >
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: n.cor }} />
                      {n.nome}
                    </span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {Number(n.compra_minima_90d) > 0 ? `a partir de ${brl(n.compra_minima_90d)}` : "entrada"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(n.desconto_pct)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(n.cashback_pct) > 0 ? fmtPct(n.cashback_pct) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Conta o valor dos pedidos feitos nos últimos 90 dias, exceto os cancelados. O nível é
            recalculado sozinho a cada acesso.
          </p>
        </div>
      )}
    </section>
  );
}

const fmtPct = (v: number | string) =>
  `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
