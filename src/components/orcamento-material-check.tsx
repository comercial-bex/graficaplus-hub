import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Boxes, AlertTriangle, Check } from "lucide-react";

type LinhaMaterial = {
  id: string;
  nome: string;
  unidade: string;
  estoque: number;
  necessario: number;
};

/**
 * Conferência de material antes de prometer prazo: mostra quanto o item pedido
 * consome de cada material do produto e quanto existe em estoque. É só aviso —
 * o lançamento nunca é bloqueado, porque o vendedor pode estar orçando algo que
 * ainda vai ser comprado.
 */
export function OrcamentoMaterialCheck({
  produtoId,
  baseDeConsumo,
}: {
  produtoId: string | null;
  /** quantidade que multiplica o consumo por unidade (peças ou m² cobrados) */
  baseDeConsumo: number;
}) {
  const { data: linhas = [] } = useQuery({
    queryKey: ["produto-materiais-check", produtoId],
    enabled: !!produtoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("produto_materiais")
        .select("quantidade_por_unidade, materiais(id, nome, unidade, estoque)")
        .eq("produto_id", produtoId);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((l) => l.materiais)
        .map((l) => ({
          id: l.materiais.id,
          nome: l.materiais.nome,
          unidade: l.materiais.unidade,
          estoque: Number(l.materiais.estoque ?? 0),
          necessario: Number(l.quantidade_por_unidade ?? 0),
        })) as LinhaMaterial[];
    },
  });

  if (!produtoId || linhas.length === 0) return null;

  const numero = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" /> Material necessário
      </div>
      <div className="space-y-1">
        {linhas.map((m) => {
          const precisa = m.necessario * (baseDeConsumo > 0 ? baseDeConsumo : 0);
          const sobra = m.estoque - precisa;
          const estado =
            precisa <= 0 ? "neutro" : sobra < 0 ? "falta" : sobra <= m.estoque * 0.1 ? "apertado" : "ok";
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">{m.nome}</span>
              <span className="whitespace-nowrap font-mono text-muted-foreground">
                precisa {numero(precisa)} {m.unidade} · estoque {numero(m.estoque)} {m.unidade}
              </span>
              {estado === "falta" && (
                <span className="flex items-center gap-1 text-destructive whitespace-nowrap">
                  <AlertTriangle className="h-3 w-3" /> falta {numero(Math.abs(sobra))}
                </span>
              )}
              {estado === "apertado" && (
                <span className="flex items-center gap-1 text-amber-500 whitespace-nowrap">
                  <AlertTriangle className="h-3 w-3" /> apertado
                </span>
              )}
              {estado === "ok" && (
                <span className="flex items-center gap-1 text-accent whitespace-nowrap">
                  <Check className="h-3 w-3" /> suficiente
                </span>
              )}
              {estado === "neutro" && (
                <span className="text-muted-foreground whitespace-nowrap">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
