import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mensagemErro } from "@/lib/erros";
import { conquistasPendentes, entregarConquista } from "@/lib/parceiro-api";

/**
 * Prêmios de meta que dependem da equipe (produto, brinde). Crédito não passa por
 * aqui: entra no saldo do parceiro na hora em que a meta é batida.
 */
export function RecompensasTab({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const [observacao, setObservacao] = useState<Record<string, string>>({});
  const [entregando, setEntregando] = useState<string | null>(null);
  const { data: pendentes = [], isLoading } = useQuery({
    queryKey: ["parceiros-conquistas-pendentes"],
    queryFn: conquistasPendentes,
  });

  async function entregar(id: string) {
    setEntregando(id);
    try {
      await entregarConquista(id, observacao[id]?.trim() || null);
      toast.success("Recompensa marcada como entregue — o parceiro vê no painel");
      qc.invalidateQueries({ queryKey: ["parceiros-conquistas-pendentes"] });
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEntregando(null);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (pendentes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <Trophy className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 font-medium">Nenhuma recompensa esperando entrega</p>
        <p className="text-sm text-muted-foreground">Quando um parceiro bater meta de produto ou brinde, aparece aqui.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {pendentes.map((p) => (
        <li key={p.id} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="font-semibold">{p.recompensa}</p>
            <p className="text-sm text-muted-foreground">
              {p.parceiro_nome} · meta “{p.campanha}” batida em {new Date(p.alcancado_em).toLocaleDateString("pt-BR")}
            </p>
          </div>
          {podeEditar && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={observacao[p.id] ?? ""}
                onChange={(e) => setObservacao((o) => ({ ...o, [p.id]: e.target.value }))}
                placeholder="Observação (opcional)"
                className="sm:w-56"
                aria-label="Observação da entrega"
              />
              <Button onClick={() => entregar(p.id)} disabled={entregando === p.id}>
                <PackageCheck className="mr-1 h-4 w-4" />
                {entregando === p.id ? "Salvando…" : "Entreguei"}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
