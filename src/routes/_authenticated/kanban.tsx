import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useState, useMemo } from "react";
import { Search, AlertTriangle, X } from "lucide-react";

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

const PRIORIDADES = [
  { v: "1", label: "Urgente" }, { v: "2", label: "Alta" },
  { v: "3", label: "Normal" }, { v: "4", label: "Baixa" }, { v: "5", label: "Mínima" },
];

function isOverdue(prazo?: string | null) {
  if (!prazo) return false;
  return new Date(prazo) < new Date(new Date().toDateString());
}

function KanbanPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [activeOs, setActiveOs] = useState<any>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [search, setSearch] = useState("");
  const [fCliente, setFCliente] = useState("todos");
  const [fResp, setFResp] = useState("todos");
  const [fPrio, setFPrio] = useState("todos");
  const [soAtrasadas, setSoAtrasadas] = useState(false);

  const { data: os = [] } = useQuery({
    queryKey: ["kanban-os"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("*, clientes(id, nome, logo_url), designer:usuarios!ordens_servico_designer_id_fkey(id, nome, avatar_url), operador:usuarios!ordens_servico_operador_id_fkey(id, nome, avatar_url)")
        .not("status", "in", "(faturado,cancelado)")
        .order("ordem_kanban");
      if (error) {
        // fallback sem joins de usuário se FK names diferirem
        const r = await supabase.from("ordens_servico").select("*, clientes(id, nome, logo_url)").not("status", "in", "(faturado,cancelado)").order("ordem_kanban");
        if (r.error) throw r.error;
        return r.data;
      }
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["kanban-filtro-clientes"],
    queryFn: async () => (await supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ["kanban-filtro-usuarios"],
    queryFn: async () => (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
  });

  const filtered = useMemo(() => {
    return (os as any[]).filter((o) => {
      if (fCliente !== "todos" && o.cliente_id !== fCliente) return false;
      if (fResp !== "todos" && o.responsavel_id !== fResp && o.designer_id !== fResp && o.operador_id !== fResp && o.vendedor_id !== fResp) return false;
      if (fPrio !== "todos" && String(o.prioridade) !== fPrio) return false;
      if (soAtrasadas && !isOverdue(o.prazo_entrega)) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!o.titulo?.toLowerCase().includes(s) && !String(o.numero).includes(s) && !o.clientes?.nome?.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [os, fCliente, fResp, fPrio, soAtrasadas, search]);

  const atrasadasCount = useMemo(() => (os as any[]).filter((o) => isOverdue(o.prazo_entrega)).length, [os]);

  async function mover(osId: string, novoStatus: string) {
    qc.setQueryData(["kanban-os"], (prev: any) =>
      prev?.map((o: any) => o.id === osId ? { ...o, status: novoStatus } : o));
    const { error } = await supabase.rpc("avancar_os_status", {
      os_id: osId,
      novo_status: novoStatus as any,
    });
    if (error) { toast.error(error.message); qc.invalidateQueries({ queryKey: ["kanban-os"] }); return; }
    toast.success("Status atualizado");
  }

  function onDragStart(e: DragStartEvent) {
    setActiveOs((os as any[]).find((o) => o.id === e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveOs(null);
    if (!e.over) return;
    const osId = String(e.active.id);
    const novoStatus = String(e.over.id);
    const current = (os as any[]).find((o) => o.id === osId);
    if (!current || current.status === novoStatus) return;
    mover(osId, novoStatus);
  }

  function limparFiltros() {
    setSearch(""); setFCliente("todos"); setFResp("todos"); setFPrio("todos"); setSoAtrasadas(false);
  }

  const ativosFiltros = fCliente !== "todos" || fResp !== "todos" || fPrio !== "todos" || soAtrasadas || search;

  return (
    <div className="space-y-4 h-full">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kanban de Produção</h1>
          <p className="text-muted-foreground">
            {filtered.length} de {os.length} OS{atrasadasCount > 0 && <span className="text-destructive ml-2">· {atrasadasCount} atrasada(s)</span>}
          </p>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar título, nº ou cliente..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={fCliente} onValueChange={setFCliente}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              {clientes.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fResp} onValueChange={setFResp}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos responsáveis</SelectItem>
              {usuarios.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fPrio} onValueChange={setFPrio}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Prioridade</SelectItem>
              {PRIORIDADES.map((p) => <SelectItem key={p.v} value={p.v}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={soAtrasadas ? "destructive" : "outline"} size="sm" onClick={() => setSoAtrasadas(!soAtrasadas)} className="h-9">
            <AlertTriangle className="h-4 w-4 mr-1" /> Atrasadas
          </Button>
          {ativosFiltros && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-9">
              <X className="h-4 w-4 mr-1" /> Limpar
            </Button>
          )}
        </div>
      </Card>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUNAS.map((col) => (
            <Coluna key={col.id} id={col.id} label={col.label}
              itens={filtered.filter((o: any) => o.status === col.id)}
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
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? "opacity-30" : ""}>
      <OSCard os={os} canSeeFinancials={canSeeFinancials} />
    </div>
  );
}

const PRIO_COLOR: Record<number, string> = {
  1: "bg-destructive", 2: "bg-orange-500", 3: "bg-blue-500", 4: "bg-muted-foreground/40", 5: "bg-muted-foreground/30",
};

function OSCard({ os, canSeeFinancials, dragging }: any) {
  const overdue = isOverdue(os.prazo_entrega);
  const responsaveis = [os.designer, os.operador].filter(Boolean);
  return (
    <Card className={`relative p-3 cursor-grab active:cursor-grabbing hover:border-accent transition-colors overflow-hidden ${dragging ? "shadow-lg rotate-2" : ""} ${overdue ? "border-destructive/60" : ""}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${PRIO_COLOR[os.prioridade] || "bg-muted"}`} />
      <div className="pl-1">
        <div className="flex items-center justify-between">
          <Link to="/os/$id" params={{ id: os.id }} className="text-xs text-muted-foreground hover:text-accent" onPointerDown={(e) => e.stopPropagation()}>
            #{os.numero}
          </Link>
          {overdue && <Badge variant="destructive" className="text-[10px] h-4">ATRASADA</Badge>}
          {!overdue && os.prioridade <= 2 && <Badge variant="destructive" className="text-[10px] h-4">URG</Badge>}
        </div>
        <div className="font-medium text-sm mt-1 line-clamp-2">{os.titulo}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
          {os.clientes?.logo_url && (
            <Avatar className="h-4 w-4">
              <AvatarImage src={os.clientes.logo_url} />
              <AvatarFallback className="text-[8px]">{os.clientes.nome?.charAt(0)}</AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">{os.clientes?.nome}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="flex -space-x-1.5">
            {responsaveis.map((r: any) => (
              <Avatar key={r.id} className="h-5 w-5 border border-background" title={r.nome}>
                <AvatarImage src={r.avatar_url ?? undefined} />
                <AvatarFallback className="text-[9px]">{r.nome?.charAt(0)}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          {os.prazo_entrega && (
            <span className={`text-[11px] ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
              {new Date(os.prazo_entrega).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
        </div>
        {canSeeFinancials && Number(os.valor_total) > 0 && (
          <div className="text-xs font-medium mt-1">R$ {Number(os.valor_total).toFixed(2)}</div>
        )}
      </div>
    </Card>
  );
}
