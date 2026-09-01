import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Package, PackageCheck } from "lucide-react";
import { toast } from "sonner";

type Falta = {
  material_id: string;
  material: string;
  unidade: string;
  necessario: number;
  disponivel: number;
  faltante: number;
};

type Consumo = { material_id: string; consumido: number; reservado: number };

const n2 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Materiais da OS: o que a ficha técnica pede, o que já está reservado, o que já
 * saiu do estoque e o que falta comprar.
 *
 * A falta precisa aparecer ANTES de separar — descobrir que acabou a lona na hora
 * de imprimir é tarde para comprar. Por isso o card mostra necessário × disponível
 * mesmo antes de qualquer reserva.
 */
export function MateriaisPrevistosCard({ osId }: { osId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeReservar = hasPermission("estoque.reserve");

  const { data, isLoading } = useQuery({
    queryKey: ["os-materiais", osId],
    queryFn: async () => {
      const [faltaRes, movRes, resRes] = await Promise.all([
        (supabase.rpc as any)("materiais_faltantes_os", { p_os_id: osId }),
        // Coluna `quantidade` — a versão anterior pedia `quantidade_prevista`, que
        // não existe, e o PostgREST derruba a consulta inteira: o card nunca
        // mostrou nada e não havia erro na tela.
        (supabase as any)
          .from("movimentacoes_estoque")
          .select("material_id, quantidade, tipo")
          .eq("os_id", osId),
        (supabase as any)
          .from("estoque_reservas")
          .select("material_id, quantidade, quantidade_baixada, status")
          .eq("os_id", osId),
      ]);

      const faltas = (faltaRes.data ?? []) as Falta[];
      const porMaterial = new Map<string, Consumo>();
      for (const m of (movRes.data ?? []) as any[]) {
        const atual = porMaterial.get(m.material_id) ?? {
          material_id: m.material_id,
          consumido: 0,
          reservado: 0,
        };
        if (m.tipo === "saida") atual.consumido += Number(m.quantidade ?? 0);
        porMaterial.set(m.material_id, atual);
      }
      for (const r of (resRes.data ?? []) as any[]) {
        const atual = porMaterial.get(r.material_id) ?? {
          material_id: r.material_id,
          consumido: 0,
          reservado: 0,
        };
        atual.reservado += Number(r.quantidade ?? 0) - Number(r.quantidade_baixada ?? 0);
        porMaterial.set(r.material_id, atual);
      }
      return { faltas, porMaterial };
    },
  });

  const reservar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("reservar_materiais_os", {
        p_os_id: osId,
      });
      if (error) throw error;
      return data as { status: string; faltantes: { faltante: number }[] };
    },
    onSuccess: (r) => {
      if (r.status === "parcial") {
        toast.warning(
          `Reserva parcial: ${r.faltantes.length} material sem saldo suficiente. Compre o que falta antes de produzir.`,
        );
      } else {
        toast.success("Material reservado para esta OS");
      }
      qc.invalidateQueries({ queryKey: ["os-materiais", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao reservar"),
  });

  const faltas = data?.faltas ?? [];
  if (isLoading || faltas.length === 0) return null;

  const semSaldo = faltas.filter((f) => Number(f.faltante) > 0);
  const jaReservado = [...(data?.porMaterial.values() ?? [])].some((c) => c.reservado > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Package className="h-4 w-4 text-[color:var(--bex-cyan)]" />
            Materiais da OS
          </CardTitle>
          {podeReservar && !jaReservado && (
            <Button size="sm" variant="outline" disabled={reservar.isPending} onClick={() => reservar.mutate()}>
              <PackageCheck className="h-4 w-4 mr-1" />
              {reservar.isPending ? "Reservando…" : "Reservar estoque"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {semSaldo.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              {semSaldo.length === 1
                ? "Falta material para esta OS:"
                : `Faltam ${semSaldo.length} materiais para esta OS:`}{" "}
              {semSaldo.map((f) => `${f.material} (${n2(Number(f.faltante))} ${f.unidade})`).join(" · ")}.
              Compre antes de produzir — a baixa não vai conseguir tirar o que não existe.
            </div>
          </div>
        )}

        {faltas.map((f) => {
          const c = data?.porMaterial.get(f.material_id);
          const falta = Number(f.faltante);
          return (
            <div
              key={f.material_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm"
            >
              <span className="font-medium">{f.material}</span>
              <span className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                <span>precisa {n2(Number(f.necessario))} {f.unidade}</span>
                {c && c.reservado > 0 && <span>reservado {n2(c.reservado)}</span>}
                {c && c.consumido > 0 && <span>baixado {n2(c.consumido)}</span>}
                {falta > 0 ? (
                  <Badge variant="destructive" className="font-normal">
                    falta {n2(falta)}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="font-normal">
                    em estoque
                  </Badge>
                )}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
