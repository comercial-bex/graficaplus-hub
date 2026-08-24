import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingDown } from "lucide-react";

export type Faixa = {
  preco_unitario: number;
  preco_m2_referencia: number | null;
  quantidade_minima: number;
  proxima_faixa: number | null;
  economia_na_proxima: number | null;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const milhar = (n: number) => n.toLocaleString("pt-BR");

/**
 * Preço do produto na quantidade pedida, quando ele tem tabela por faixa.
 *
 * O catálogo de campanha vende por peça com quatro a seis faixas por produto.
 * Sem isto, o vendedor abre o PDF e digita o preço — que é onde entra erro de
 * digitação e desconto sem querer.
 */
export function useFaixaDePreco(produtoId: string | null, quantidade: number) {
  return useQuery({
    queryKey: ["faixa-preco", produtoId, quantidade],
    enabled: !!produtoId && quantidade > 0,
    queryFn: async (): Promise<Faixa | null> => {
      const { data, error } = await (supabase.rpc as any)("preco_da_faixa", {
        p_produto_id: produtoId,
        p_quantidade: quantidade,
      });
      if (error) throw error;
      const linha = Array.isArray(data) ? data[0] : data;
      // Sem linha ou sem preço = quantidade abaixo do pedido mínimo. Devolver
      // null é proposital: inventar um preço ali esconderia que não se vende.
      if (!linha || linha.preco_unitario == null) return null;
      return {
        preco_unitario: Number(linha.preco_unitario),
        preco_m2_referencia:
          linha.preco_m2_referencia != null ? Number(linha.preco_m2_referencia) : null,
        quantidade_minima: Number(linha.quantidade_minima),
        proxima_faixa: linha.proxima_faixa != null ? Number(linha.proxima_faixa) : null,
        economia_na_proxima:
          linha.economia_na_proxima != null ? Number(linha.economia_na_proxima) : null,
      };
    },
  });
}

/** Menor quantidade vendável do produto — a primeira faixa da tabela. */
export function usePedidoMinimo(produtoId: string | null) {
  return useQuery({
    queryKey: ["pedido-minimo", produtoId],
    enabled: !!produtoId,
    queryFn: async (): Promise<number | null> => {
      const { data } = await (supabase as any)
        .from("produto_faixas_preco")
        .select("quantidade_minima")
        .eq("produto_id", produtoId)
        .order("quantidade_minima")
        .limit(1);
      return data?.[0]?.quantidade_minima ?? null;
    },
  });
}

export function FaixaDePrecoAviso({
  faixa,
  pedidoMinimo,
  quantidade,
  aoAplicar,
  aoSubirFaixa,
}: {
  faixa: Faixa | null | undefined;
  pedidoMinimo: number | null | undefined;
  quantidade: number;
  aoAplicar: (preco: number) => void;
  aoSubirFaixa: (quantidade: number) => void;
}) {
  // Aplica sozinho ao entrar na faixa: o preço de tabela é o padrão, e obrigar
  // um clique a cada mudança de quantidade convida a esquecer de atualizar.
  useEffect(() => {
    if (faixa) aoAplicar(faixa.preco_unitario);
    // aoAplicar muda a cada render do pai; seguir só o preço evita laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faixa?.preco_unitario]);

  if (!pedidoMinimo) return null;

  if (!faixa) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          Este produto tem pedido mínimo de <strong>{milhar(pedidoMinimo)}</strong> unidades por
          arte.{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => aoSubirFaixa(pedidoMinimo)}
          >
            Usar {milhar(pedidoMinimo)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal">
          tabela · faixa de {milhar(faixa.quantidade_minima)}
        </Badge>
        <span className="font-mono">{brl(faixa.preco_unitario)}/un</span>
        <span className="text-muted-foreground">
          · total {brl(faixa.preco_unitario * quantidade)}
        </span>
        {faixa.preco_m2_referencia != null && (
          <span className="text-xs text-muted-foreground">
            (régua de {brl(faixa.preco_m2_referencia)}/m² sobre a bobina consumida)
          </span>
        )}
      </div>

      {/* O argumento que o catálogo faz no papel e a tela não fazia. */}
      {faixa.proxima_faixa != null && faixa.economia_na_proxima != null && faixa.economia_na_proxima > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <TrendingDown className="h-3.5 w-3.5" />
          <span>
            Em {milhar(faixa.proxima_faixa)} un o cliente economiza{" "}
            <strong className="text-foreground">{brl(faixa.economia_na_proxima)}</strong> no total.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 text-xs"
            onClick={() => aoSubirFaixa(faixa.proxima_faixa!)}
          >
            Subir para {milhar(faixa.proxima_faixa)}
          </Button>
        </div>
      )}
    </div>
  );
}
