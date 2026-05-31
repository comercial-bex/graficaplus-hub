import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Kanban — BEX PRINT OS" }] }),
  component: KanbanPage,
});

const COLUNAS: { id: string; label: string }[] = [
  { id: "novo", label: "Novo" },
  { id: "aguardando_briefing", label: "Aguardando briefing" },
  { id: "em_design", label: "Em design" },
  { id: "aguardando_aprovacao_arte", label: "Aprovação de arte" },
  { id: "arte_aprovada", label: "Arte aprovada" },
  { id: "em_producao", label: "Em produção" },
  { id: "em_impressao", label: "Impressão" },
  { id: "em_acabamento", label: "Acabamento" },
  { id: "controle_qualidade", label: "QA" },
  { id: "aguardando_entrega", label: "Aguardando entrega" },
  { id: "em_instalacao", label: "Instalação" },
  { id: "concluido", label: "Concluído" },
];

function KanbanPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();

  const { data: os = [] } = useQuery({
    queryKey: ["kanban-os"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("*, clientes(nome)")
        .not("status", "in", "(faturado,cancelado)")
        .order("ordem_kanban");
      if (error) throw error;
      return data;
    },
  });

  async function mover(osId: string, novoStatus: string) {
    const { error } = await supabase.from("ordens_servico").update({ status: novoStatus as any }).eq("id", osId);
    if (error) return toast.error(error.message);
    await supabase.from("logs_auditoria").insert({
      entidade: "ordens_servico", entidade_id: osId, acao: "status_change",
      detalhes: { novo: novoStatus },
    });
    toast.success("Status atualizado");
    qc.invalidateQueries({ queryKey: ["kanban-os"] });
  }

  return (
    <div className="space-y-4 h-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kanban de Produção</h1>
        <p className="text-muted-foreground">Arraste cards para alterar o status (drag-and-drop na Fase 2)</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUNAS.map((col) => {
          const itens = os.filter((o: any) => o.status === col.id);
          return (
            <div key={col.id} className="w-72 shrink-0">
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-sm font-semibold">{col.label}</h3>
                <Badge variant="secondary" className="text-xs">{itens.length}</Badge>
              </div>
              <div className="space-y-2 bg-muted/40 p-2 rounded-lg min-h-[200px]">
                {itens.map((o: any) => (
                  <Card key={o.id} className="p-3 cursor-pointer hover:border-accent transition-colors">
                    <div className="text-xs text-muted-foreground">#{o.numero}</div>
                    <div className="font-medium text-sm">{o.titulo}</div>
                    <div className="text-xs text-muted-foreground mt-1">{o.clientes?.nome}</div>
                    {o.prazo_entrega && <div className="text-xs text-accent mt-1">Prazo: {o.prazo_entrega}</div>}
                    {canSeeFinancials && Number(o.valor_total) > 0 && (
                      <div className="text-xs font-medium mt-1">R$ {Number(o.valor_total).toFixed(2)}</div>
                    )}
                    <select
                      className="mt-2 w-full text-xs bg-background border rounded px-1 py-1"
                      value={o.status}
                      onChange={(e) => mover(o.id, e.target.value)}
                    >
                      {COLUNAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
