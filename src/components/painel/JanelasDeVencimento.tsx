import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Carregando } from "@/components/bex/Carregando";
import { cn } from "@/lib/utils";
import {
  COLUNAS_DA_JANELA,
  lerJanelas,
  type JanelaDoDinheiro,
  type JanelasDeVencimento as Dados,
} from "@/domain/financeiro/janelas-de-vencimento";

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Um cartão: "Total a receber" ou "Total a pagar", com hoje em destaque e o atrasado à parte. */
function CartaoDaJanela({ titulo, janela, tom }: { titulo: string; janela: JanelaDoDinheiro; tom: "receber" | "pagar" }) {
  return (
    <section aria-label={titulo} className="rounded-xl border border-border bg-card shadow-sm">
      <h3 className="border-b border-border px-5 py-3 text-base font-bold text-foreground">{titulo}</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 sm:grid-cols-4">
        {COLUNAS_DA_JANELA.map((c) => (
          <div key={c.chave} className="min-w-0">
            <p className="text-sm text-muted-foreground">{c.rotulo}</p>
            <p
              className={cn(
                "mt-1 truncate font-extrabold tabular-nums",
                c.chave === "hoje"
                  ? cn("text-2xl", tom === "receber" ? "text-success" : "text-destructive")
                  : "text-lg text-foreground",
              )}
            >
              {moeda(janela[c.chave])}
            </p>
          </div>
        ))}
      </div>
      <p
        className={cn(
          "border-t border-border px-5 py-3 text-sm",
          janela.atrasado > 0 ? "font-semibold text-destructive" : "text-muted-foreground",
        )}
      >
        {janela.atrasado > 0 ? `Atrasado: ${moeda(janela.atrasado)}` : "Nada atrasado"}
      </p>
    </section>
  );
}

/** A parte que só desenha: recebe os números prontos (e é o que os testes olham). */
export function JanelasDeVencimentoView({ dados }: { dados: Dados }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2" aria-label="Dinheiro a vencer">
      <CartaoDaJanela titulo="Total a receber" janela={dados.receber} tom="receber" />
      <CartaoDaJanela titulo="Total a pagar" janela={dados.pagar} tom="pagar" />
    </div>
  );
}

/**
 * Dinheiro a vencer: hoje, amanhã, 7 e 30 dias, para receber e para pagar (o painel
 * inicial do Holdprint que o dono aprovou, 31/10/2026). Quem chama só monta isto
 * para quem vê financeiro: a função recusa os outros com 42501.
 */
export function JanelasDeVencimento() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["vencimentos-por-janela"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: r, error } = await (supabase as any).rpc("vencimentos_por_janela");
      if (error) throw error;
      return lerJanelas(r);
    },
  });
  if (isLoading) return <Carregando />;
  // Falha não se disfarça de zero: R$ 0,00 a pagar lido como "tudo em dia" seria mentira.
  if (isError || !data) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-5 py-4 text-sm text-destructive">
        Não consegui ler o dinheiro a vencer agora. Recarregue a tela; se continuar, avise a gerência.
      </p>
    );
  }
  return <JanelasDeVencimentoView dados={data} />;
}
