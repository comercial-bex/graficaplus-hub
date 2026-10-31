import { createFileRoute } from "@tanstack/react-router";
import {
  DESCRICAO_ETAPA,
  ETAPAS_QUADRO,
  ROTULO_ETAPA,
  etapaDe,
  statusPadraoDaEtapa,
  traduzirBloqueios,
  type Etapa,
} from "@/domain/os/etapas";
import { atrasado, paradaHa } from "@/domain/os/prazo";
import {
  fraseDoAviso,
  passoDoMovimento,
  rotuloDoMovimento,
  ultimoMovimentoPorOs,
  type MovimentoDaOs,
} from "@/domain/os/movimentos";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView } from "@/lib/supabase-financial-views";
import { nomesDaEquipe } from "@/lib/api/equipe";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { bloqueiosSemDinheiro } from "@/domain/os/bloqueio-sem-dinheiro";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { useState, useMemo, useRef, useCallback } from "react";
import { Search, AlertTriangle, X, Pause, SlidersHorizontal } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { dicaTela } from "@/lib/dicas";
import { StatusChip } from "@/components/bex/StatusChip";
import { mensagemErro } from "@/lib/erros";
import { CartaoOs, type BloqueioOs } from "@/components/kanban/cartao-os";
import { FichaDaOs } from "@/components/kanban/ficha-da-os";
import { escolherCapa, type ArquivoDaOs } from "@/domain/os/arquivos-da-os";
import { urlsAssinadas } from "@/lib/urls-dos-arquivos";
import { IconeDaMaquina } from "@/components/kanban/icone-da-maquina";
import { legendaDeMaquinas } from "@/domain/producao/identidade-da-maquina";
import { FalhaDeConsulta } from "@/components/whatsapp/falha-de-consulta";

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Quadro de produção — BEX PRINT OS" }] }),
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
  // canSeePrices: vê preço de venda (vendedor, gestão, financeiro). O quadro só
  // mostra valor da OS e dos itens — preço, nunca custo nem margem — então a
  // leitura segue o nível de visão, não o flag de financeiro.
  const { canSeePrices, canSeeFinancials, nivelDeVisao } = useAuth();
  const [activeOs, setActiveOs] = useState<any>(null);
  const [cancelando, setCancelando] = useState<{ id: string; numero: number | null } | null>(null);
  const [motivoDoCancelamento, setMotivoDoCancelamento] = useState("");
  const [fichaId, setFichaId] = useState<string | null>(null);

  // Mouse e toque têm regras diferentes de propósito. No mouse, 5px de
  // movimento levantam o cartão e clique parado nunca vira arrasto. No toque,
  // o quadro rola na horizontal com o dedo em cima dos cartões: segurar 250 ms
  // levanta o cartão; mover antes disso rola o quadro (a tolerância de 8px
  // perdoa o tremor do dedo enquanto segura). Um PointerSensor único não
  // distingue os dois e o arrasto no celular era loteria.
  // KeyboardSensor não é opcional: o dnd-kit anuncia ao leitor de tela "To pick
  // up a draggable item, press the space bar", e sem este sensor a instrução era
  // falsa.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: saltarEntreColunas, scrollBehavior: "smooth" }),
  );

  // Refs das colunas para o chip de etapa (celular) rolar até a coluna.
  const colunaRefs = useRef<Partial<Record<Etapa, HTMLDivElement | null>>>({});
  const quadroRef = useRef<HTMLDivElement | null>(null);
  // Qual coluna está na tela no celular — só para destacar o chip.
  const [etapaVisivel, setEtapaVisivel] = useState<Etapa>(ETAPAS_QUADRO[0]);
  const irParaColuna = useCallback((etapa: Etapa) => {
    colunaRefs.current[etapa]?.scrollIntoView({
      inline: "start",
      block: "nearest",
      behavior: "smooth",
    });
  }, []);
  // Calcula a coluna mais próxima do início da rolagem. Só importa no celular
  // (no desktop cabem todas na linha); sem rolagem o scrollLeft é 0 e o resultado é a 1ª.
  const aoRolarQuadro = useCallback(() => {
    const el = quadroRef.current;
    if (!el) return;
    let melhor: Etapa = ETAPAS_QUADRO[0];
    let menor = Infinity;
    for (const etapa of ETAPAS_QUADRO) {
      const col = colunaRefs.current[etapa];
      if (!col) continue;
      const dist = Math.abs(col.offsetLeft - el.scrollLeft);
      if (dist < menor) {
        menor = dist;
        melhor = etapa;
      }
    }
    setEtapaVisivel((atual) => (atual === melhor ? atual : melhor));
  }, []);

  const [search, setSearch] = useState("");
  const [fCliente, setFCliente] = useState("todos");
  const [fResp, setFResp] = useState("todos");
  const [fPrio, setFPrio] = useState("todos");
  const [soAtrasadas, setSoAtrasadas] = useState(false);

  // Carregando e falha não podem se ler como quadro vazio: o quadro dizia
  // "0/0 OS" e "— vazio —" nas colunas enquanto a consulta ainda corria
  // (visto ao vivo em 21/10/2026, ~1,5 s), e diria o mesmo se ela falhasse.
  const {
    data: os = [],
    isLoading: carregandoOs,
    isError: osFalhou,
    error: erroDasOs,
    refetch: recarregarOs,
  } = useQuery({
    queryKey: ["kanban-os", nivelDeVisao],
    queryFn: async () => {
      const { data, error } = await fromFinancialView("ordens_servico", nivelDeVisao)
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
      const [arquivos, internas, tarefas, itens, maquinas, pessoas, movimentos] = await Promise.all([
        // Os arquivos de cada OS: o cartão mostra a capa (a imagem do que vai ser
        // impresso) e a ficha lista todos. Só colunas, nunca o conteúdo.
        supabase
          .from("arquivos")
          .select("id, os_id, nome, caminho, mime_type, final_producao, created_at, tipo, status, ativo, substituido_por, os_item_id")
          .in("os_id", ids),
        // OS interna (mostruário, uso interno, reposição): vem de uma view pequena.
        // Se falhar, o cartão aparece como venda — o quadro não cai por causa do selo.
        (supabase as any)
          .from("os_finalidade_v")
          .select("id, finalidade, local_mostruario")
          .in("id", ids)
          .neq("finalidade", "venda"),
        supabase.from("os_tarefas").select("os_id, status, prazo").in("os_id", ids),
        // Os itens são o que a OS manda produzir. Faltavam no cartão, que
        // preferia anunciar "Produto não definido".
        // Lidos pela view do nível, não pela tabela-base: a base tem o SELECT
        // revogado nas colunas de dinheiro, e pedir valor_total nela derruba a
        // consulta INTEIRA — o cartão ficava sem item, em silêncio. valor_total
        // só existe nas views comercial e financeiro; a operacional não tem
        // coluna de dinheiro nenhuma, então não se pede.
        fromFinancialView("itens_os", nivelDeVisao)
          .select(
            canSeePrices
              ? "id, os_id, descricao, quantidade, unidade, largura, altura, area_total, acabamento, valor_total"
              : "id, os_id, descricao, quantidade, unidade, largura, altura, area_total, acabamento",
          )
          .in("os_id", ids)
          .order("ordem"),
        // Cinco linhas: cabe inteira, e resolver por id no cliente é o único
        // caminho — view não tem FK, então o embed do PostgREST não existe.
        supabase.from("maquinas").select("id, nome, tipo"),
        supabase.from("usuarios").select("id, nome, avatar_url"),
        // Quem moveu e quando (decisão do dono, 13/10/2026: todos movem, e o
        // cartão mostra o registro). Toda troca de status grava aqui.
        supabase
          .from("os_status_historico")
          .select("os_id, status_anterior, status_novo, mudou_em, mudou_por")
          .in("os_id", ids),
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
      // O nome de quem moveu vem de nomes_da_equipe: `usuarios` só mostra a
      // própria linha a quem não é admin nem gestor, e o cartão dizia "movida
      // por Equipe" para o resto do time. Se a função falhar, fica o que
      // `usuarios` deu — o cartão perde o nome, não o quadro.
      const nomes = new Map(
        ((pessoas.data ?? []) as { id: string; nome: string | null }[]).map((p) => [p.id, p.nome ?? ""]),
      );
      try {
        const daEquipe = await nomesDaEquipe(
          ((movimentos.data ?? []) as { mudou_por: string | null }[]).map((m) => m.mudou_por),
        );
        for (const [id, nome] of daEquipe) nomes.set(id, nome);
      } catch {
        // segue com os nomes de `usuarios`
      }
      const ultimos = ultimoMovimentoPorOs(movimentos.data as MovimentoDaOs[] | null);

      // A capa de cada OS (a regra está em domain/os/arquivos-da-os) e a URL
      // assinada dela, de uma vez só. Sem URL a capa vira ficha com o nome.
      const arquivosPorOs = porOs.arquivos as Map<string, ArquivoDaOs[]>;
      const capas = new Map<string, ArquivoDaOs>();
      for (const [osId, lista] of arquivosPorOs) {
        const capa = escolherCapa(lista);
        if (capa) capas.set(osId, capa);
      }
      const urlsDasCapas = await urlsAssinadas([...capas.values()].map((c) => c.caminho));

      const finalidades = new Map<string, { finalidade: string; local_mostruario: string | null }>(
        ((internas?.data ?? []) as { id: string; finalidade: string; local_mostruario: string | null }[]).map((r) => [r.id, r]),
      );

      return ordens.map((o) => ({
        ...o,
        finalidade: finalidades.get(o.id as string)?.finalidade ?? "venda",
        local_mostruario: finalidades.get(o.id as string)?.local_mostruario ?? null,
        arquivos: porOs.arquivos.get(o.id as string) ?? [],
        capa_url: capas.has(o.id as string) ? (urlsDasCapas.get(capas.get(o.id as string)!.caminho) ?? null) : null,
        tarefas: porOs.tarefas.get(o.id as string) ?? [],
        itens: porOs.itens.get(o.id as string) ?? [],
        maquinas: o.maquina_id ? (mapaMaquinas.get(o.maquina_id as string) ?? null) : null,
        responsavel: o.responsavel_id ? (mapaPessoas.get(o.responsavel_id as string) ?? null) : null,
        designer: o.designer_id ? (mapaPessoas.get(o.designer_id as string) ?? null) : null,
        operador: o.operador_id ? (mapaPessoas.get(o.operador_id as string) ?? null) : null,
        ultimo_movimento: (() => {
          const m = ultimos.get(o.id as string);
          return m
            ? {
                ...m,
                rotulo: rotuloDoMovimento(m, nomes),
                passo: passoDoMovimento(m),
                verbo: m.status_anterior ? "movida" : "aberta",
              }
            : null;
        })(),
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
    queryKey: ["kanban-bloqueios", canSeeFinancials, canSeePrices],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("os_bloqueios_do_quadro");
      if (error) throw error;
      const mapa = new Map<string, BloqueioOs[]>();
      for (const linha of (data ?? []) as { os_id: string; bloqueios: BloqueioOs[] }[]) {
        // Título de margem/desconto traz número: cortado aqui para quem não vê
        // custo/preço, e vale para cartão, overlay e ficha de uma vez.
        mapa.set(linha.os_id, bloqueiosSemDinheiro(linha.bloqueios, canSeeFinancials, canSeePrices));
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

  async function mover(osId: string, novoStatus: string): Promise<boolean> {
    const novaOrdem =
      Math.max(
        -1,
        ...(os as any[])
          .filter((o) => o.status === novoStatus && o.id !== osId)
          .map((o) => Number(o.ordem_kanban) || 0),
      ) + 1;

    // A hora do banco, não a do aparelho: o aviso que esta mudança enfileirar
    // nasce depois dela (folga de 5 s para relógio adiantado).
    const antes = new Date(Date.now() - 5000).toISOString();

    // A assinatura real é avancar_os_status(os_id, novo_status) — sem prefixo p_.
    const { error } = await (supabase.rpc as any)("avancar_os_status", {
      os_id: osId,
      novo_status: novoStatus,
    });
    if (error) {
      // Soltar o cartão em "Concluído" passa por `fechar_os`, e o que volta são
      // os códigos das travas. Código cru não diz nada a quem está no quadro.
      const bruto = mensagemErro(error);
      const travas = traduzirBloqueios(bruto);
      toast.error(travas ? "A OS ainda não pode fechar" : bruto, {
        description: travas ?? undefined,
      });
      qc.invalidateQueries({ queryKey: ["kanban-os"] });
      return false;
    }

    // A própria RPC grava o log de auditoria. ordem_kanban não é tocada por ela.
    const { error: erroOrdem } = await supabase
      .from("ordens_servico")
      .update({ ordem_kanban: novaOrdem })
      .eq("id", osId);
    if (erroOrdem) toast.warning("Status alterado, mas a posição no quadro não foi salva.");

    qc.invalidateQueries({ queryKey: ["kanban-os"] });
    qc.invalidateQueries({ queryKey: ["kanban-bloqueios"] });

    // O cliente foi avisado? Antes a resposta era "Status atualizado" em todo
    // caso — com aviso, sem aviso, sem telefone ou com o aviso engolido.
    const { data: avisos, error: erroAviso } = await supabase
      .from("notificacoes_fila")
      .select("evento")
      .eq("entidade", "ordem_servico")
      .eq("entidade_id", osId)
      .gte("created_at", antes)
      .limit(1);
    if (erroAviso) {
      toast.success("Etapa atualizada");
      return true;
    }
    const frase = fraseDoAviso(novoStatus, (avisos?.[0]?.evento as string | undefined) ?? null);
    toast.success(frase.titulo, { description: frase.descricao });
    return true;
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
  // Quantos dos três Selects estão em uso: é o número do chip "N filtros" no
  // celular, onde os Selects ficam escondidos atrás do botão.
  const filtrosNoPopover = [fCliente, fResp, fPrio].filter((v) => v !== "todos").length;

  // Os três Selects num lugar só: no desktop ficam na barra, no celular dentro
  // do Popover "Filtros". `largura` muda só a classe do gatilho.
  const selectsDeFiltro = (largura: { cliente: string; resp: string; prio: string }) => (
    <>
      <Select value={fCliente} onValueChange={setFCliente}>
        <SelectTrigger className={`h-11 md:h-9 ${largura.cliente}`}>
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
        <SelectTrigger className={`h-11 md:h-9 ${largura.resp}`}>
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
        <SelectTrigger className={`h-11 md:h-9 ${largura.prio}`}>
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
    </>
  );

  return (
    <div className="h-full space-y-4">
      <SectionHeader
        ajuda={dicaTela("/kanban")}
        breadcrumb="Print OS · Operação · Quadro de produção"
        // Um nome só: menu, manifest e painel já dizem "Quadro de produção".
        title="Quadro de produção"
        description="Kanban: uma coluna por etapa. Arraste para mudar de etapa; clique no cartão para ver a ficha e escolher o passo exato."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip label={carregandoOs ? "carregando…" : `${filtered.length}/${os.length} OS`} tone="cyan" />
            {atrasadasCount > 0 && <StatusChip label={`${atrasadasCount} atrasada(s)`} tone="magenta" />}
          </div>
        }
      />
      {osFalhou && (
        <FalhaDeConsulta
          titulo="Não foi possível carregar as OS do quadro"
          erro={erroDasOs}
          onTentarDeNovo={() => void recarregarOs()}
        />
      )}

      {/* No celular a barra tinha 4–5 linhas antes do quadro: o quadro
          começava abaixo da dobra. Agora: busca em linha cheia, e embaixo
          "Filtros" (os três Selects num Popover) + "Atrasadas". No desktop
          os Selects continuam na barra, como antes. */}
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Sem flex-1 abaixo de sm: `flex: 1` zera a base e o campo encolhia
              para ~80px dividindo a linha com os dois botões. Em linha cheia
              ele ocupa os 375px sozinho; a partir de sm volta a crescer. */}
          <div className="relative w-full sm:min-w-[220px] sm:flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar título, nº ou cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 pl-9 md:h-9"
            />
          </div>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            {selectsDeFiltro({
              cliente: "w-full sm:w-[180px]",
              resp: "w-full sm:w-[180px]",
              prio: "w-full sm:w-[140px]",
            })}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={filtrosNoPopover > 0 ? "secondary" : "outline"}
                size="sm"
                className="h-11 flex-1 md:hidden"
              >
                <SlidersHorizontal className="mr-1 h-4 w-4" /> Filtros
                {filtrosNoPopover > 0 && (
                  <StatusChip label={`${filtrosNoPopover} filtro(s)`} tone="cyan" className="ml-1.5" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 p-3">
              {selectsDeFiltro({ cliente: "w-full", resp: "w-full", prio: "w-full" })}
            </PopoverContent>
          </Popover>
          <Button
            variant={soAtrasadas ? "destructive" : "outline"}
            size="sm"
            onClick={() => setSoAtrasadas(!soAtrasadas)}
            className="h-11 flex-1 md:h-9 md:flex-none"
          >
            <AlertTriangle className="mr-1 h-4 w-4" /> Atrasadas
          </Button>
          {ativosFiltros && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-11 md:h-9">
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
        {/* Celular: chips de etapa com a contagem. Tocar rola até a coluna —
            sem isso se via 1,5 coluna sem saber qual era. */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 md:hidden">
          {ETAPAS_QUADRO.map((etapa) => {
            const n = noQuadro.filter((o: any) => etapaDe(o.status) === etapa).length;
            const ativa = etapa === etapaVisivel;
            return (
              <button
                key={etapa}
                type="button"
                onClick={() => irParaColuna(etapa)}
                aria-current={ativa ? "true" : undefined}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 font-mono text-xs uppercase tracking-wider transition-colors ${
                  ativa
                    ? "border-[color:var(--bex-cyan)]/50 bg-[color:var(--bex-cyan)]/15 text-foreground"
                    : "border-border bg-card/60 text-muted-foreground"
                }`}
              >
                {ROTULO_ETAPA[etapa]}
                <span className="rounded bg-muted px-1 text-[11px] text-foreground/80">{n}</span>
              </button>
            );
          })}
        </div>

        {/* Celular: flex com snap, uma coluna por tela (85vw deixa a borda da
            próxima aparecer, dica de que há mais). Desktop: uma linha só com todas as
            etapas (eram cinco no grid e a sexta, a Fila de produção, caía para a
            linha de baixo); a coluna vazia encolhe e a cheia ocupa o resto, e só
            rola de lado quando nem assim cabe. */}
        <div
          ref={quadroRef}
          onScroll={aoRolarQuadro}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:snap-none md:gap-2.5"
        >
          {ETAPAS_QUADRO.map((etapa) => (
            <Coluna
              key={etapa}
              etapa={etapa}
              itens={noQuadro.filter((o: any) => etapaDe(o.status) === etapa)}
              carregando={carregandoOs}
              bloqueios={bloqueios}
              canSeePrices={canSeePrices}
              onAbrir={setFichaId}
              containerRef={(el) => {
                colunaRefs.current[etapa] = el;
              }}
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
                    canSeePrices={canSeePrices}
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
              canSeePrices={canSeePrices}
              dragging
            />
          )}
        </DragOverlay>
      </DndContext>

      <FichaDaOs
        os={fichaOs}
        bloqueios={fichaId ? (bloqueios.get(fichaId) ?? []) : []}
        canSeePrices={canSeePrices}
        aberto={fichaId !== null}
        onFechar={() => setFichaId(null)}
        onMudarStatus={(osId, novo) => {
          // Cancelar tira a OS do quadro: um toque no seletor não basta.
          if (novo === "cancelado") {
            const alvo = (os as any[]).find((o) => o.id === osId);
            setCancelando({ id: osId, numero: alvo?.numero ?? null });
            setMotivoDoCancelamento("");
            return;
          }
          void mover(osId, novo);
        }}
      />

      <AlertDialog open={!!cancelando} onOpenChange={(aberto) => !aberto && setCancelando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar a OS #{cancelando?.numero ?? ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              A OS sai do quadro e o cliente não recebe aviso. A conta a receber dela continua aberta:
              trate-a em Contas a receber.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            aria-label="Motivo do cancelamento"
            placeholder="Motivo (ex.: cliente desistiu, pedido em duplicidade)"
            value={motivoDoCancelamento}
            onChange={(e) => setMotivoDoCancelamento(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={motivoDoCancelamento.trim().length < 5}
              onClick={async () => {
                if (!cancelando) return;
                const { id: alvoId } = cancelando;
                const motivo = motivoDoCancelamento.trim();
                setCancelando(null);
                const cancelou = await mover(alvoId, "cancelado");
                if (cancelou) {
                  // O motivo fica no rastro da OS (quem e quando já estão no histórico de status).
                  const { error: erroLog } = await supabase.from("logs_auditoria").insert({
                    entidade: "ordens_servico",
                    entidade_id: alvoId,
                    acao: "cancelamento",
                    detalhes: { motivo },
                  });
                  if (erroLog) toast.warning("OS cancelada, mas o motivo não foi registrado.");
                }
              }}
            >
              Cancelar a OS
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Cartões que a última coluna mostra antes do "Mostrar as outras". */
const LIMITE_DA_COLUNA_FINAL = 8;

function Coluna({
  etapa,
  itens,
  bloqueios,
  canSeePrices,
  onAbrir,
  containerRef,
  carregando = false,
}: {
  etapa: Etapa;
  itens: any[];
  /** A consulta ainda corre: mostra o esqueleto, não "vazio". */
  carregando?: boolean;
  bloqueios: Map<string, BloqueioOs[]>;
  canSeePrices?: boolean;
  onAbrir: (id: string) => void;
  /** Ref do container da coluna — o chip de etapa do celular rola até aqui. */
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: etapa });
  // A última coluna junta tudo o que já saiu: eram 15 cartões e o quadro passava
  // de 8.000 px de altura (medido em 30/10/2026). Aparecem os primeiros e o resto
  // abre num toque; o número do cabeçalho continua sendo o total.
  const [abertaPorInteiro, setAbertaPorInteiro] = useState(false);
  const limite = etapa === "saida" && !abertaPorInteiro ? LIMITE_DA_COLUNA_FINAL : Infinity;
  const visiveis = itens.slice(0, limite);
  const escondidas = itens.length - visiveis.length;

  // A OS parada há mais tempo nesta etapa. É a pergunta que o quadro existe
  // para responder — onde está encalhado — e não precisa de configuração
  // nenhuma para ser respondida.
  const maisAntiga = itens.reduce<string | null>((pior, o) => {
    if (!o.updated_at) return pior;
    return !pior || o.updated_at < pior ? o.updated_at : pior;
  }, null);
  const encalhe = itens.length > 0 ? paradaHa(maisAntiga) : null;

  return (
    <div ref={containerRef} className={`flex min-w-[85vw] snap-start flex-col ${
        itens.length > 0 ? "md:min-w-[180px] md:flex-1" : "md:min-w-[130px] md:flex-[0.6]"
      }`}>
      <div className="mb-2 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-mono text-xs uppercase tracking-[0.18em] text-foreground/80 md:text-[11px]">
            {ROTULO_ETAPA[etapa]}
          </h3>
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground/80 md:text-[10px]">
            {itens.length.toString().padStart(2, "0")}
          </span>
        </div>
        {/* Descrição e legenda só no desktop: no celular custam altura na
            primeira dobra e o chip de etapa já situa o impressor. */}
        <p className="mt-0.5 hidden line-clamp-2 text-[10px] leading-snug text-muted-foreground md:block">
          {DESCRICAO_ETAPA[etapa]}
        </p>
        {/* A legenda mora aqui e só aqui: é na Produção que o ícone do cartão
            precisa ser lido, e uma legenda no topo do quadro estaria longe
            justamente de onde ela é usada. */}
        {etapa === "producao" && (
          <div className="mt-1 hidden flex-wrap items-center gap-x-2 gap-y-0.5 md:flex">
            {legendaDeMaquinas().map((m) => (
              <span
                key={m.chave}
                className="flex items-center gap-0.5 text-[9px]"
                style={{ color: m.cor }}
              >
                <IconeDaMaquina identidade={m} className="h-2.5 w-2.5" />
                {m.curto}
              </span>
            ))}
          </div>
        )}
        {encalhe && encalhe !== "agora" && (
          <p className="mt-0.5 font-mono text-xs text-muted-foreground/70 md:text-[10px]">
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
        {visiveis.map((o) => (
          <CartaoArrastavel
            key={o.id}
            os={o}
            bloqueios={bloqueios.get(o.id) ?? []}
            canSeePrices={canSeePrices}
            onAbrir={() => onAbrir(o.id)}
          />
        ))}
        {escondidas > 0 && (
          <button
            type="button"
            onClick={() => setAbertaPorInteiro(true)}
            className="w-full rounded-lg border border-dashed border-border py-2 font-mono text-xs text-muted-foreground hover:bg-muted/50"
          >
            Mostrar as outras {escondidas}
          </button>
        )}
        {abertaPorInteiro && etapa === "saida" && itens.length > LIMITE_DA_COLUNA_FINAL && (
          <button
            type="button"
            onClick={() => setAbertaPorInteiro(false)}
            className="w-full rounded-lg border border-dashed border-border py-2 font-mono text-xs text-muted-foreground hover:bg-muted/50"
          >
            Mostrar menos
          </button>
        )}
        {itens.length === 0 && carregando && (
          <div className="space-y-2" aria-hidden data-carregando="">
            <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
          </div>
        )}
        {itens.length === 0 && !carregando && (
          <div className="py-6 text-center font-mono text-xs text-muted-foreground/60 md:text-[11px]">
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
  canSeePrices,
  onAbrir,
}: {
  os: any;
  bloqueios: BloqueioOs[];
  canSeePrices?: boolean;
  onAbrir: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: os.id });
  // touch-manipulation (touch-action: manipulation): sem isso o navegador
  // decide que o toque é rolagem, dispara pointercancel e o arrasto cai. Rolar
  // e dar zoom por pinça continuam permitidos; só o zoom por duplo toque sai.
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-manipulation ${isDragging ? "opacity-30" : ""}`}
    >
      <CartaoOs
        os={os}
        bloqueios={bloqueios}
        canSeePrices={canSeePrices}
        onAbrir={onAbrir}
      />
    </div>
  );
}
