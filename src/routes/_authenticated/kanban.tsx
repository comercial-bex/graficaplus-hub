import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState, useMemo } from "react";
import {
  Search,
  AlertTriangle,
  X,
  Package,
  Factory,
  Palette,
  Paperclip,
  Clock,
  DollarSign,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Kanban — BEX PRINT OS" }] }),
  component: KanbanPage,
});

type ColunaKanban = { id: string; label: string; setor: string };

const COLUNAS: ColunaKanban[] = [
  { id: "entrada", label: "Entrada", setor: "Atendimento" },
  { id: "aguardando_briefing", label: "Aguardando briefing", setor: "Atendimento" },
  { id: "briefing_ok", label: "Briefing OK", setor: "Atendimento" },
  { id: "design", label: "Design", setor: "Design" },
  { id: "aguardando_aprovacao_arte", label: "Aprovação de arte", setor: "Design" },
  { id: "arte_aprovada", label: "Arte aprovada", setor: "Design" },
  { id: "arte_rejeitada", label: "Arte rejeitada", setor: "Design" },
  { id: "aguardando_producao", label: "Aguardando produção", setor: "PCP" },
  { id: "producao", label: "Produção", setor: "Produção" },
  { id: "em_impressao", label: "Impressão", setor: "Produção" },
  { id: "em_corte", label: "Corte", setor: "Produção" },
  { id: "em_acabamento", label: "Acabamento", setor: "Produção" },
  { id: "em_uv", label: "UV", setor: "Produção" },
  { id: "em_laser_cnc", label: "Laser/CNC", setor: "Produção" },
  { id: "em_3d", label: "3D", setor: "Produção" },
  { id: "controle_qualidade", label: "Controle de qualidade", setor: "Qualidade" },
  { id: "aguardando_retirada", label: "Aguardando retirada", setor: "Expedição" },
  { id: "aguardando_entrega", label: "Aguardando entrega", setor: "Expedição" },
  { id: "em_entrega", label: "Em entrega", setor: "Logística" },
  { id: "em_instalacao", label: "Instalação", setor: "Instalação" },
  { id: "concluido", label: "Concluído", setor: "Finalização" },
  { id: "faturado", label: "Faturado", setor: "Financeiro" },
  { id: "cancelado", label: "Cancelado", setor: "Cancelado" },
  { id: "retrabalho", label: "Retrabalho", setor: "Qualidade" },
  { id: "pausado", label: "Pausado", setor: "Pendência" },
];

const COLUNAS_BY_ID = Object.fromEntries(COLUNAS.map((c) => [c.id, c]));

const PRIORIDADES = [
  { v: "1", label: "Urgente" },
  { v: "2", label: "Alta" },
  { v: "3", label: "Normal" },
  { v: "4", label: "Baixa" },
  { v: "5", label: "Mínima" },
];

function isOverdue(prazo?: string | null) {
  if (!prazo) return false;
  return new Date(prazo) < new Date(new Date().toDateString());
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusFinanceiro(os: any) {
  const pagamentos = os.pagamentos ?? [];
  if (pagamentos.length === 0) return "Não lançado";
  if (
    pagamentos.some(
      (p: any) => p.status === "atrasado" || (p.status !== "pago" && isOverdue(p.data_vencimento)),
    )
  )
    return "Atrasado";
  if (pagamentos.every((p: any) => p.status === "pago")) return "Pago";
  if (pagamentos.some((p: any) => p.status === "parcial" || p.status === "pago")) return "Parcial";
  return "Pendente";
}

function getStatusArte(os: any) {
  if (os.status === "arte_aprovada") return "Aprovada";
  if (os.status === "arte_rejeitada") return "Rejeitada";
  if (os.status === "aguardando_aprovacao_arte") return "Em aprovação";
  const aprovacoes = [...(os.aprovacoes ?? [])].sort(
    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  if (aprovacoes[0]?.aprovado === true) return "Aprovada";
  if (aprovacoes[0]?.aprovado === false) return "Rejeitada";
  return os.status === "design" ? "Em design" : "Pendente";
}

function hasPendencia(os: any) {
  const tarefas = os.tarefas ?? [];
  return (
    os.status === "pausado" ||
    os.status === "arte_rejeitada" ||
    tarefas.some((t: any) => !t.concluida && isOverdue(t.prazo))
  );
}

function KanbanPage() {
  const qc = useQueryClient();
  const { canSeeFinancials, user } = useAuth();
  const [activeOs, setActiveOs] = useState<any>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [search, setSearch] = useState("");
  const [fCliente, setFCliente] = useState("todos");
  const [fResp, setFResp] = useState("todos");
  const [fPrio, setFPrio] = useState("todos");
  const [soAtrasadas, setSoAtrasadas] = useState(false);

  const { data: os = [] } = useQuery({
    queryKey: ["kanban-os", canSeeFinancials ? "financeiro" : "operacional"],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("ordens_servico", canSeeFinancials)
        .select("*")
        .not("status", "in", "(faturado,cancelado)")
        .order("ordem_kanban");
      if (error) throw error;
      return data;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["kanban-filtro-clientes"],
    queryFn: async () =>
      (await supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome")).data ??
      [],
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ["kanban-filtro-usuarios"],
    queryFn: async () =>
      (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ??
      [],
  });

  const filtered = useMemo(() => {
    return (os as any[]).filter((o) => {
      if (fCliente !== "todos" && o.cliente_id !== fCliente) return false;
      if (
        fResp !== "todos" &&
        o.responsavel_id !== fResp &&
        o.designer_id !== fResp &&
        o.operador_id !== fResp &&
        o.vendedor_id !== fResp
      )
        return false;
      if (fPrio !== "todos" && String(o.prioridade) !== fPrio) return false;
      if (soAtrasadas && !isOverdue(o.prazo_entrega)) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !o.titulo?.toLowerCase().includes(s) &&
          !String(o.numero).includes(s) &&
          !o.cliente_nome?.toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [os, fCliente, fResp, fPrio, soAtrasadas, search]);

  const atrasadasCount = useMemo(
    () => (os as any[]).filter((o) => isOverdue(o.prazo_entrega)).length,
    [os],
  );

  async function mover(osId: string, novoStatus: string) {
    const coluna = COLUNAS_BY_ID[novoStatus];
    const atual = (os as any[]).find((o) => o.id === osId);
    const novaOrdem =
      Math.max(
        -1,
        ...(os as any[])
          .filter((o) => o.status === novoStatus && o.id !== osId)
          .map((o) => Number(o.ordem_kanban) || 0),
      ) + 1;
    qc.setQueryData(["kanban-os"], (prev: any) =>
      prev?.map((o: any) => (o.id === osId ? { ...o, status: novoStatus } : o)),
    );
    const { error } = await (supabase.rpc as any)("avancar_os_status", {
      p_os_id: osId,
      p_novo_status: novoStatus,
      p_justificativa: `Movido para ${coluna?.label ?? novoStatus} no Kanban`,
    });
    if (error) {
      toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["kanban-os"] });
      return;
    }
    await supabase.from("logs_auditoria").insert({
      entidade: "ordens_servico",
      entidade_id: osId,
      acao: "status_change",
      detalhes: { novo: novoStatus },
      usuario_id: user?.id,
    });
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
    if (!current || current.status === novoStatus || !COLUNAS_BY_ID[novoStatus]) return;
    mover(osId, novoStatus);
  }

  function limparFiltros() {
    setSearch("");
    setFCliente("todos");
    setFResp("todos");
    setFPrio("todos");
    setSoAtrasadas(false);
  }

  const ativosFiltros =
    fCliente !== "todos" || fResp !== "todos" || fPrio !== "todos" || soAtrasadas || search;

  return (
    <div className="space-y-4 h-full">
      <SectionHeader
        breadcrumb="Print OS · Operação · Kanban"
        title="Kanban de Produção"
        description="Arraste e solte cartões entre estágios. As mudanças são registradas no histórico."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip label={`${filtered.length}/${os.length} OS`} tone="cyan" />
            {atrasadasCount > 0 && (
              <StatusChip label={`${atrasadasCount} atrasada(s)`} tone="magenta" />
            )}
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card/60 p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar título, nº ou cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={fCliente} onValueChange={setFCliente}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os clientes</SelectItem>
              {clientes.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fResp} onValueChange={setFResp}>
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos responsáveis</SelectItem>
              {usuarios.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fPrio} onValueChange={setFPrio}>
            <SelectTrigger className="w-[140px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Prioridade</SelectItem>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p.v} value={p.v}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={soAtrasadas ? "destructive" : "outline"}
            size="sm"
            onClick={() => setSoAtrasadas(!soAtrasadas)}
            className="h-9"
          >
            <AlertTriangle className="h-4 w-4 mr-1" /> Atrasadas
          </Button>
          {ativosFiltros && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-9">
              <X className="h-4 w-4 mr-1" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUNAS.map((col) => (
            <Coluna
              key={col.id}
              id={col.id}
              label={col.label}
              itens={filtered.filter((o: any) => o.status === col.id)}
              canSeeFinancials={canSeeFinancials}
            />
          ))}
        </div>
        <DragOverlay>
          {activeOs && <OSCard os={activeOs} canSeeFinancials={canSeeFinancials} dragging />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Coluna({ id, label, itens, canSeeFinancials }: any) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div className="w-80 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Badge variant="secondary" className="text-xs">
          {itens.length}
        </Badge>
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 p-2 rounded-lg min-h-[200px] transition-colors ${isOver ? "bg-accent/20" : "bg-muted/40"}`}
      >
        {itens.map((o: any) => (
          <DraggableCard key={o.id} os={o} canSeeFinancials={canSeeFinancials} />
        ))}
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
  1: "bg-destructive",
  2: "bg-orange-500",
  3: "bg-blue-500",
  4: "bg-muted-foreground/40",
  5: "bg-muted-foreground/30",
};

function OSCard({ os, canSeeFinancials, dragging }: any) {
  const overdue = isOverdue(os.prazo_entrega);
  const urgent = Number(os.prioridade) <= 2;
  const pending = hasPendencia(os);
  const responsaveis = [os.designer, os.operador].filter(Boolean);
  const setor = os.setor_atual || COLUNAS_BY_ID[os.status]?.setor || "—";
  const anexos = os.arquivos?.length ?? 0;
  const financeiro = getStatusFinanceiro(os);
  const arte = getStatusArte(os);
  return (
    <Card
      className={`relative p-3 cursor-grab active:cursor-grabbing hover:border-accent transition-colors overflow-hidden ${dragging ? "shadow-lg rotate-2" : ""} ${overdue ? "border-destructive/60" : ""}`}
    >
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 ${PRIO_COLOR[os.prioridade] || "bg-muted"}`}
      />
      <div className="pl-1">
        <div className="flex items-center justify-between">
          <Link
            to="/os/$id"
            params={{ id: os.id }}
            className="text-xs text-muted-foreground hover:text-accent"
            onPointerDown={(e) => e.stopPropagation()}
          >
            #{os.numero}
          </Link>
          {overdue && (
            <Badge variant="destructive" className="text-[10px] h-4">
              ATRASADA
            </Badge>
          )}
          {!overdue && os.prioridade <= 2 && (
            <Badge variant="destructive" className="text-[10px] h-4">
              URG
            </Badge>
          )}
        </div>
        <div className="font-medium text-sm mt-1 line-clamp-2">{os.titulo}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
          {os.cliente_logo_url && (
            <Avatar className="h-4 w-4">
              <AvatarImage src={os.cliente_logo_url} />
              <AvatarFallback className="text-[8px]">{os.cliente_nome?.charAt(0)}</AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">{os.cliente_nome}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 min-w-0">
            <Package className="h-3 w-3 shrink-0" />
            <span className="truncate">{os.produtos?.nome ?? "Produto não definido"}</span>
          </span>
          <span className="flex items-center gap-1 min-w-0">
            <Factory className="h-3 w-3 shrink-0" />
            <span className="truncate">{os.maquinas?.nome ?? "Máquina não definida"}</span>
          </span>
          <span className="truncate">
            Setor: <strong className="font-medium text-foreground/80">{setor}</strong>
          </span>
          <span className="flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            {anexos} anexo(s)
          </span>
          <span className="flex items-center gap-1 min-w-0">
            <Palette className="h-3 w-3 shrink-0" />
            <span className="truncate">Arte: {arte}</span>
          </span>
          {canSeeFinancials && (
            <span className="flex items-center gap-1 min-w-0">
              <DollarSign className="h-3 w-3 shrink-0" />
              <span className="truncate">Fin.: {financeiro}</span>
            </span>
          )}
          <span className="flex items-center gap-1 col-span-2">
            <Clock className="h-3 w-3" />
            Última mov.: {formatDateTime(os.updated_at)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {responsaveis.map((r: any) => (
              <Avatar key={r.id} className="h-5 w-5 border border-background" title={r.nome}>
                <AvatarImage src={r.avatar_url ?? undefined} />
                <AvatarFallback className="text-[9px]">{r.nome?.charAt(0)}</AvatarFallback>
              </Avatar>
            ))}
          </div>
          {os.prazo_entrega && (
            <span
              className={`text-[11px] ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}
            >
              {new Date(os.prazo_entrega).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
          )}
        </div>
        {canSeeFinancials && Number(os.valor_total) > 0 && (
          <div className="text-xs font-medium">R$ {Number(os.valor_total).toFixed(2)}</div>
        )}
      </div>
    </Card>
  );
}
