import { createFileRoute } from "@tanstack/react-router";
import {
  DESCRICAO_ETAPA,
  ETAPAS_QUADRO,
  ROTULO_ETAPA,
  etapaDe,
  statusPadraoDaEtapa,
  type Etapa,
} from "@/domain/os/etapas";
import { atrasado, paradaHa } from "@/domain/os/prazo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  coordenadaNaColuna,
  proximaColuna,
  type ColunaAlvo,
} from "@/domain/kanban/navegacao-teclado";
import { useState, useMemo } from "react";
import { Search, AlertTriangle, X, Pause } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { StatusChip } from "@/components/bex/StatusChip";
import { mensagemErro } from "@/lib/erros";
import { CartaoOs, type BloqueioOs } from "@/components/kanban/cartao-os";
import { FichaDaOs } from "@/components/kanban/ficha-da-os";
import { IconeDaMaquina } from "@/components/kanban/icone-da-maquina";
import { legendaDeMaquinas } from "@/domain/producao/identidade-da-maquina";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Kanban — BEX PRINT OS" }] }),
  component: KanbanPage,
});

/**
 * UMA COLUNA POR ETAPA — cinco, não vinte e cinco.
 *
 * A versão anterior transformava cada status numa coluna e depois empilhava as
 * vinte e cinco em cinco faixas, cada faixa com a própria rolagem horizontal.
 * Continuava sendo lista deitada: para achar uma OS era preciso rolar duas
 * dimensões. A literatura de Kanban converge em três a cinco colunas, e o teste
 * prático é o mesmo: se não dá para entender o quadro num olhar, é complexidade
 * demais.
 *
 * O status detalhado não sumiu — desceu para dentro do cartão, que é onde ele
 * responde "em qual máquina" sem custar uma coluna vazia na tela.
 */
const COLUNAS_BY_ID = Object.fromEntries(ETAPAS_QUADRO.map((e) => [e, true]));

/**
 * Seta horizontal salta uma coluna inteira. A aritmética vive em
 * @/domain/kanban/navegacao-teclado (testada sem navegador); aqui fica apenas a
 * extração dos retângulos do contexto do dnd-kit.
 */
const saltarEntreColunas: KeyboardCoordinateGetter = (
  event,
  { context: { active, collisionRect, droppableRects, droppableContainers } },
) => {
  if (!active || !collisionRect) return;
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return;
  event.preventDefault();

  const colunas: ColunaAlvo[] = [];
  for (const container of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(container.id);
    if (rect && COLUNAS_BY_ID[String(container.id)]) {
      colunas.push({
        id: String(container.id),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        top: rect.top,
      });
    }
  }

  const destino = proximaColuna(
    colunas,
    collisionRect.left + collisionRect.width / 2,
    event.code === KeyboardCode.Right ? 1 : -1,
  );
  if (!destino) return;
  return coordenadaNaColuna(destino, collisionRect.width);
};

const PRIORIDADES = [
  { v: "1", label: "Urgente" },
  { v: "2", label: "Alta" },
  { v: "3", label: "Normal" },
  { v: "4", label: "Baixa" },
  { v: "5", label: "Mínima" },
];

function KanbanPage() {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [activeOs, setActiveOs] = useState<any>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  // KeyboardSensor não é opcional: o dnd-kit anuncia ao leitor de tela "To pick
  // up a draggable item, press the space bar", e sem este sensor a instrução era
  // falsa. A distância de 5px no PointerSensor é o que deixa o cartão ser
  // clicável E arrastável: clique parado nunca vira arrasto.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: saltarEntreColunas, scrollBehavior: "smooth" }),
  );

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

      const ordens = (data ?? []) as Record<string, unknown>[];
      const ids = ordens.map((o) => o.id as string);
      if (ids.length === 0) return ordens;

      // A leitura vem de uma VIEW, e view não tem FK declarada — logo o embed do
      // PostgREST não funciona e estas relações chegavam sempre undefined.
      // Buscar em paralelo e agrupar por os_id resolve sem abrir mão das views.
      const [arquivos, tarefas, itens, maquinas, pessoas] = await Promise.all([
        supabase.from("arquivos").select("os_id").in("os_id", ids),
        supabase.from("os_tarefas").select("os_id, status, prazo").in("os_id", ids),
        // Os itens são o que a OS manda produzir. Faltavam no cartão, que
        // preferia anunciar "Produto não definido".
        supabase
          .from("itens_os")
          .select("id, os_id, descricao, quantidade, unidade, largura, altura, area_total, acabamento, valor_total")
          .in("os_id", ids)
          .order("ordem"),
        // Cinco linhas: cabe inteira, e resolver por id no cliente é o único
        // caminho — view não tem FK, então o embed do PostgREST não existe.
        supabase.from("maquinas").select("id, nome, tipo"),
        supabase.from("usuarios").select("id, nome, avatar_url"),
      ]);

      const agrupar = <T extends { os_id?: string | null }>(linhas: T[] | null) => {
        const mapa = new Map<string, T[]>();
        for (const linha of linhas ?? []) {
          const chave = linha.os_id;
          if (!chave) continue;
          const lista = mapa.get(chave);
          if (lista) lista.push(linha);
          else mapa.set(chave, [linha]);
        }
        return mapa;
      };
      const porOs = {
        arquivos: agrupar(arquivos.data as { os_id?: string | null }[] | null),
        tarefas: agrupar(tarefas.data as { os_id?: string | null }[] | null),
        itens: agrupar(itens.data as { os_id?: string | null }[] | null),
      };
      // `os.maquinas`, `os.designer` e `os.operador` eram lidos de objetos que a
      // consulta nunca trouxe: a view não declara FK, logo não há embed. O
      // cartão anunciava "Máquina não definida" e "sem equipe" em toda OS, e
      // não era falta de cadastro — era promessa impossível.
      const porId = <T extends { id: string }>(linhas: T[] | null) =>
        new Map((linhas ?? []).map((l) => [l.id, l]));
      const mapaMaquinas = porId(maquinas.data as { id: string }[] | null);
      const mapaPessoas = porId(pessoas.data as { id: string }[] | null);

      return ordens.map((o) => ({
        ...o,
        arquivos: porOs.arquivos.get(o.id as string) ?? [],
        tarefas: porOs.tarefas.get(o.id as string) ?? [],
        itens: porOs.itens.get(o.id as string) ?? [],
        maquinas: o.maquina_id ? (mapaMaquinas.get(o.maquina_id as string) ?? null) : null,
        responsavel: o.responsavel_id ? (mapaPessoas.get(o.responsavel_id as string) ?? null) : null,
        designer: o.designer_id ? (mapaPessoas.get(o.designer_id as string) ?? null) : null,
        operador: o.operador_id ? (mapaPessoas.get(o.operador_id as string) ?? null) : null,
      }));
    },
  });

  /**
   * As travas de produção, numa chamada só.
   *
   * São as MESMAS regras que `avancar_os_status` aplica — a RPC e esta consulta
   * chamam a mesma função no banco. Enquanto isso morava só dentro do RAISE, a
   * única forma de descobrir um impedimento era arrastar o cartão e tomar erro,
   * um impedimento por arrasto.
   */
  const { data: bloqueios = new Map<string, BloqueioOs[]>() } = useQuery({
    queryKey: ["kanban-bloqueios"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("os_bloqueios_do_quadro");
      if (error) throw error;
      const mapa = new Map<string, BloqueioOs[]>();
      for (const linha of (data ?? []) as { os_id: string; bloqueios: BloqueioOs[] }[]) {
        mapa.set(linha.os_id, linha.bloqueios ?? []);
      }
      return mapa;
    },
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ["kanban-filtro-clientes"],
    queryFn: async () =>
      (await supabase.from("clientes").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ["kanban-filtro-usuarios"],
    queryFn: async () =>
      (await supabase.from("usuarios").select("id, nome").eq("ativo", true).order("nome")).data ?? [],
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
      if (soAtrasadas && !atrasado(o.prazo_entrega)) return false;
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
    () => (os as any[]).filter((o) => atrasado(o.prazo_entrega)).length,
    [os],
  );

  // Pausadas não ocupam coluna: não são estágio da produção, são exceção. Ficam
  // numa faixa própria, embaixo, onde não atrapalham a leitura do fluxo.
  const noQuadro = filtered.filter((o: any) => etapaDe(o.status) !== "fora_do_fluxo");
  const foraDoFluxo = filtered.filter((o: any) => etapaDe(o.status) === "fora_do_fluxo");
  const fichaOs = useMemo(
    () => (os as any[]).find((o) => o.id === fichaId) ?? null,
    [os, fichaId],
  );

  async function mover(osId: string, novoStatus: string) {
    const novaOrdem =
      Math.max(
        -1,
        ...(os as any[])
          .filter((o) => o.status === novoStatus && o.id !== osId)
          .map((o) => Number(o.ordem_kanban) || 0),
      ) + 1;

    // A assinatura real é avancar_os_status(os_id, novo_status) — sem prefixo p_.
    const { error } = await (supabase.rpc as any)("avancar_os_status", {
      os_id: osId,
      novo_status: novoStatus,
    });
    if (error) {
      toast.error(mensagemErro(error));
      qc.invalidateQueries({ queryKey: ["kanban-os"] });
      return;
    }

    // A própria RPC grava o log de auditoria. ordem_kanban não é tocada por ela.
    const { error: erroOrdem } = await supabase
      .from("ordens_servico")
      .update({ ordem_kanban: novaOrdem })
      .eq("id", osId);
    if (erroOrdem) toast.warning("Status alterado, mas a posição no quadro não foi salva.");

    qc.invalidateQueries({ queryKey: ["kanban-os"] });
    qc.invalidateQueries({ queryKey: ["kanban-bloqueios"] });
    toast.success("Status atualizado");
  }

  function onDragStart(e: DragStartEvent) {
    setActiveOs((os as any[]).find((o) => o.id === e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveOs(null);
    if (!e.over) return;
    const osId = String(e.active.id);
    const etapa = String(e.over.id) as Etapa;
    if (!COLUNAS_BY_ID[etapa]) return;
    const atual = (os as any[]).find((o) => o.id === osId);
    if (!atual) return;
    // Soltar na coluna onde já está não é movimento. Sem esta guarda, largar o
    // cartão de volta rebaixaria uma OS "Em impressão" para "Em produção".
    if (etapaDe(atual.status) === etapa) return;
    mover(osId, statusPadraoDaEtapa(etapa, atual));
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
    <div className="h-full space-y-4">
      <SectionHeader
        ajuda={dicaTela("/kanban")}
        breadcrumb="Print OS · Operação · Kanban"
        title="Kanban de Produção"
        description="Uma coluna por etapa. Arraste para mudar de etapa; clique no cartão para ver a ficha e escolher o passo exato."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip label={`${filtered.length}/${os.length} OS`} tone="cyan" />
            {atrasadasCount > 0 && <StatusChip label={`${atrasadasCount} atrasada(s)`} tone="magenta" />}
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar título, nº ou cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          <Select value={fCliente} onValueChange={setFCliente}>
            <SelectTrigger className="h-9 w-[180px]">
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
            <SelectTrigger className="h-9 w-[180px]">
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
            <SelectTrigger className="h-9 w-[140px]">
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
            <AlertTriangle className="mr-1 h-4 w-4" /> Atrasadas
          </Button>
          {ativosFiltros && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-9">
              <X className="mr-1 h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Uma rolagem horizontal para o quadro inteiro — o padrão de todo
            Kanban. A versão anterior tinha CINCO barras de rolagem, uma por
            faixa empilhada, e ainda exigia rolar na vertical para achar a
            etapa. */}
        <div className="grid grid-cols-[repeat(5,minmax(220px,1fr))] gap-3 overflow-x-auto pb-2">
          {ETAPAS_QUADRO.map((etapa) => (
            <Coluna
              key={etapa}
              etapa={etapa}
              itens={noQuadro.filter((o: any) => etapaDe(o.status) === etapa)}
              bloqueios={bloqueios}
              canSeeFinancials={canSeeFinancials}
              onAbrir={setFichaId}
            />
          ))}
        </div>

        {foraDoFluxo.length > 0 && (
          <section className="mt-4 rounded-xl border border-dashed border-border bg-muted/20 p-3">
            <h2 className="mb-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <Pause className="h-3 w-3" />
              Fora do fluxo · {foraDoFluxo.length}
              <span className="ml-1 font-sans normal-case tracking-normal">
                Pausadas — não contam como fila. Arraste de volta para retomar.
              </span>
            </h2>
            <div className="flex gap-3 overflow-x-auto">
              {foraDoFluxo.map((o: any) => (
                <div key={o.id} className="w-64 shrink-0">
                  <CartaoArrastavel
                    os={o}
                    bloqueios={bloqueios.get(o.id) ?? []}
                    canSeeFinancials={canSeeFinancials}
                    onAbrir={() => setFichaId(o.id)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <DragOverlay>
          {activeOs && (
            <CartaoOs
              os={activeOs}
              bloqueios={bloqueios.get(activeOs.id) ?? []}
              canSeeFinancials={canSeeFinancials}
              dragging
            />
          )}
        </DragOverlay>
      </DndContext>

      <FichaDaOs
        os={fichaOs}
        bloqueios={fichaId ? (bloqueios.get(fichaId) ?? []) : []}
        canSeeFinancials={canSeeFinancials}
        aberto={fichaId !== null}
        onFechar={() => setFichaId(null)}
        onMudarStatus={(osId, novo) => mover(osId, novo)}
      />
    </div>
  );
}

function Coluna({
  etapa,
  itens,
  bloqueios,
  canSeeFinancials,
  onAbrir,
}: {
  etapa: Etapa;
  itens: any[];
  bloqueios: Map<string, BloqueioOs[]>;
  canSeeFinancials?: boolean;
  onAbrir: (id: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: etapa });

  // A OS parada há mais tempo nesta etapa. É a pergunta que o quadro existe
  // para responder — onde está encalhado — e não precisa de configuração
  // nenhuma para ser respondida.
  const maisAntiga = itens.reduce<string | null>((pior, o) => {
    if (!o.updated_at) return pior;
    return !pior || o.updated_at < pior ? o.updated_at : pior;
  }, null);
  const encalhe = itens.length > 0 ? paradaHa(maisAntiga) : null;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/80">
            {ROTULO_ETAPA[etapa]}
          </h3>
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
            {itens.length.toString().padStart(2, "0")}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
          {DESCRICAO_ETAPA[etapa]}
        </p>
        {/* A legenda mora aqui e só aqui: é na Produção que o ícone do cartão
            precisa ser lido, e uma legenda no topo do quadro estaria longe
            justamente de onde ela é usada. */}
        {etapa === "producao" && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {legendaDeMaquinas().map((m) => (
              <span
                key={m.chave}
                className="flex items-center gap-0.5 text-[9px]"
                style={{ color: m.cor }}
                title={m.curto}
              >
                <IconeDaMaquina identidade={m} className="h-2.5 w-2.5" />
                {m.curto}
              </span>
            ))}
          </div>
        )}
        {encalhe && encalhe !== "agora" && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
            mais antiga: {encalhe}
          </p>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[240px] flex-1 space-y-2 rounded-lg border p-2 transition-colors ${
          isOver
            ? "border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/5"
            : "border-border/50 bg-muted/30"
        }`}
      >
        {itens.map((o) => (
          <CartaoArrastavel
            key={o.id}
            os={o}
            bloqueios={bloqueios.get(o.id) ?? []}
            canSeeFinancials={canSeeFinancials}
            onAbrir={() => onAbrir(o.id)}
          />
        ))}
        {itens.length === 0 && (
          <div className="py-6 text-center font-mono text-[11px] text-muted-foreground/60">
            — vazio —
          </div>
        )}
      </div>
    </div>
  );
}

function CartaoArrastavel({
  os,
  bloqueios,
  canSeeFinancials,
  onAbrir,
}: {
  os: any;
  bloqueios: BloqueioOs[];
  canSeeFinancials?: boolean;
  onAbrir: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: os.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? "opacity-30" : ""}>
      <CartaoOs
        os={os}
        bloqueios={bloqueios}
        canSeeFinancials={canSeeFinancials}
        onAbrir={onAbrir}
      />
    </div>
  );
}
