import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Wallet } from "lucide-react";
import { DicaIcone } from "@/components/bex/Dica";
import { dicaCampo } from "@/lib/dicas";
import { brl } from "@/domain/parceiros/preco";
import { ROTULO_DO_CREDITO, type PainelDoParceiro } from "@/domain/parceiros/painel";
import { ehPrimeiraCompra, lerEntrada } from "@/domain/parceiros/credito-de-entrada";
import { CHAVE_PROGRAMA_PUBLICO, carregarProgramaPublico } from "@/lib/parceiro-api";

/** Saldo de crédito e as últimas entradas e saídas, em linguagem de extrato. */
export function CreditoCard({ painel }: { painel: PainelDoParceiro }) {
  const [tudo, setTudo] = useState(false);
  const linhas = tudo ? painel.extrato : painel.extrato.slice(0, 4);
  const programa = useQuery({ queryKey: CHAVE_PROGRAMA_PUBLICO, queryFn: carregarProgramaPublico, staleTime: 5 * 60_000 });
  const entrada = lerEntrada(programa.data);
  const lancamento = painel.extrato.find((l) => l.tipo === "entrada");
  const mostrarEntrada = !!entrada && !!lancamento && ehPrimeiraCompra(painel.pedidos ?? []);
  const validade = (() => {
    if (!mostrarEntrada || !entrada || !lancamento) return null;
    const d = new Date(lancamento.created_at);
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + entrada.validade_dias);
    return d;
  })();

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Seu crédito
          <DicaIcone texto={dicaCampo("/parceiro", "seu credito")} rotulo="Seu crédito" />
        </p>
        <Wallet className="h-4 w-4 text-[color:var(--bex-cyan)]" />
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums">{brl(painel.saldo_credito)}</p>
      <p className="text-sm text-muted-foreground">
        {Number(painel.saldo_credito) > 0
          ? "Use para abater no próximo pedido."
          : "Cashback e metas batidas viram crédito aqui."}
      </p>

      {mostrarEntrada && entrada && lancamento && (
        <div className="mt-4 rounded-xl border border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <Gift className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            Crédito de entrada: {brl(Number(lancamento.valor))}
          </p>
          <p className="mt-1 text-muted-foreground">
            {validade ? `Vale até ${validade.toLocaleDateString("pt-BR")}, ` : "Vale "}
            só junto com a sua 1ª compra de pelo menos {brl(entrada.pedido_minimo)}. Nela, o crédito
            cobre até {entrada.max_pct.toLocaleString("pt-BR")}% dos produtos; o resto você paga.
          </p>
        </div>
      )}

      {painel.extrato.length > 0 && (
        <ul className="mt-4 divide-y divide-border text-sm">
          {linhas.map((l, i) => (
            <li key={`${l.created_at}-${i}`} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate">{ROTULO_DO_CREDITO[l.tipo] ?? l.tipo}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {new Date(l.created_at).toLocaleDateString("pt-BR")} · {l.descricao}
                </p>
              </div>
              <span
                className={
                  Number(l.valor) >= 0
                    ? "shrink-0 font-medium tabular-nums text-[color:var(--bex-cyan)]"
                    : "shrink-0 font-medium tabular-nums text-muted-foreground"
                }
              >
                {Number(l.valor) >= 0 ? "+" : "−"} {brl(Math.abs(Number(l.valor)))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {painel.extrato.length > 4 && (
        <button
          type="button"
          className="mt-2 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => setTudo((v) => !v)}
        >
          {tudo ? "Ver menos" : "Ver extrato completo"}
        </button>
      )}
    </section>
  );
}
