import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";

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
  { id: "aguardando_producao", label: "Aguardando produção" },
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
  const { canSeeFinancials, user } = useAuth();
  const [activeOs, setActiveOs] = useState<any>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
    qc.setQueryData(["kanban-os"], (prev: any) =>
      prev?.map((o: any) => o.id === osId ? { ...o, status: novoStatus } : o));
    const { error } = await supabase.from("ordens_servico").update({ status: novoStatus as any }).eq("id", osId);
    if (error) { toast.error(error.message); qc.invalidateQueries({ queryKey: ["kanban-os"] }); return; }
    await supabase.from("logs_auditoria").insert({
      entidade: "ordens_servico", entidade_id: osId, acao: "status_change",
      detalhes: { novo: novoStatus }, usuario_id: user?.id,
    });
    toast.success("Status atualizado");
  }

  function onDragStart(e: DragStartEvent) {
    setActiveOs(os.find((o: any) => o.id === e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveOs(null);
    if (!e.over) return;
    const osId = String(e.active.id);
    const novoStatus = String(e.over.id);
    const current = os.find((o: any) => o.id === osId);
    if (!current || current.status === novoStatus) return;
    mover(osId, novoStatus);
  }

  return (
    <div className="space-y-4 h-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kanban de Produção</h1>
        <p className="text-muted-foreground">Arraste cards entre colunas para alterar o status</p>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUNAS.map((col) => (
            <Coluna key={col.id} id={col.id} label={col.label}
              itens={os.filter((o: any) => o.status === col.id)}
              canSeeFinancials={canSeeFinancials} />
          ))}
        </div>
        <DragOverlay>{activeOs && <OSCard os={activeOs} canSeeFinancials={canSeeFinancials} dragging />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Coluna({ id, label, itens, canSeeFinancials }: any) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div className="w-72 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Badge variant="secondary" className="text-xs">{itens.length}</Badge>
      </div>
      <div ref={setNodeRef}
        className={`space-y-2 p-2 rounded-lg min-h-[200px] transition-colors ${isOver ? "bg-accent/20" : "bg-muted/40"}`}>
        {itens.map((o: any) => <DraggableCard key={o.id} os={o} canSeeFinancials={canSeeFinancials} />)}
      </div>
    </div>
  );
}

function DraggableCard({ os, canSeeFinancials }: any) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: os.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={isDragging ? "opacity-30" : ""}>
      <OSCard os={os} canSeeFinancials={canSeeFinancials} />
    </div>
  );
}

function OSCard({ os, canSeeFinancials, dragging }: any) {
  return (
    <Card className={`p-3 cursor-grab active:cursor-grabbing hover:border-accent transition-colors ${dragging ? "shadow-lg rotate-2" : ""}`}>
      <div className="flex items-center justify-between">
        <Link to="/os/$id" params={{ id: os.id }} className="text-xs text-muted-foreground hover:text-accent" onPointerDown={(e) => e.stopPropagation()}>
          #{os.numero}
        </Link>
        {os.prioridade <= 2 && <Badge variant="destructive" className="text-[10px] h-4">URG</Badge>}
      </div>
      <div className="font-medium text-sm mt-1">{os.titulo}</div>
      <div className="text-xs text-muted-foreground mt-1">{os.clientes?.nome}</div>
      {os.prazo_entrega && <div className="text-xs text-accent mt-1">Prazo: {os.prazo_entrega}</div>}
      {canSeeFinancials && Number(os.valor_total) > 0 && (
        <div className="text-xs font-medium mt-1">R$ {Number(os.valor_total).toFixed(2)}</div>
      )}
    </Card>
  );
}
