import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/bex/StatusChip";
import { Package } from "lucide-react";

type Linha = {
  material_id: string;
  nome: string;
  unidade: string;
  previsto: number;
  consumido: number;
};

/** Compara o consumo previsto (receitas dos produtos) com o que já foi baixado do estoque. */
export function MateriaisPrevistosCard({ osId }: { osId: string }) {
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["os-materiais-previstos", osId],
    queryFn: async () => {
      const [previstosRes, movRes] = await Promise.all([
        supabase
          .from("os_materiais_previstos" as never)
          .select("material_id, quantidade_prevista, materiais(nome, unidade)")
          .eq("os_id", osId),
        supabase
          .from("movimentacoes_estoque" as never)
          .select("material_id, quantidade, tipo")
          .eq("os_id", osId),
      ]);

      const mapa = new Map<string, Linha>();
      for (const p of (previstosRes.data ?? []) as any[]) {
        mapa.set(p.material_id, {
          material_id: p.material_id,
          nome: p.materiais?.nome ?? "Material",
          unidade: p.materiais?.unidade ?? "un",
          previsto: Number(p.quantidade_prevista ?? 0),
          consumido: 0,
        });
      }
      for (const m of (movRes.data ?? []) as any[]) {
        const atual = mapa.get(m.material_id);
        const qtd = Math.abs(Number(m.quantidade ?? 0)) * (m.tipo === "entrada" ? -1 : 1);
        if (atual) atual.consumido += qtd;
        else
          mapa.set(m.material_id, {
            material_id: m.material_id,
            nome: "Material fora da previsão",
            unidade: "un",
            previsto: 0,
            consumido: qtd,
          });
      }
      return [...mapa.values()];
    },
  });

  if (isLoading || linhas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          Materiais previstos × consumidos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {linhas.map((l) => {
          const desvio = l.consumido - l.previsto;
          const tone = Math.abs(desvio) < 0.001 ? "lime" : desvio > 0 ? "magenta" : "amber";
          return (
            <div
              key={l.material_id}
              className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm"
            >
              <span className="font-medium">{l.nome}</span>
              <span className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>
                  prev. {l.previsto.toFixed(2)} {l.unidade}
                </span>
                <span>
                  cons. {l.consumido.toFixed(2)} {l.unidade}
                </span>
                <StatusChip
                  label={`${desvio > 0 ? "+" : ""}${desvio.toFixed(2)}`}
                  tone={tone as "lime" | "magenta" | "amber"}
                />
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
