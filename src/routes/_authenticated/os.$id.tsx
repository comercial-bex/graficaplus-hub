import { createFileRoute, Link } from "@tanstack/react-router";
import { STATUS, rotuloDe } from "@/domain/os/etapas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Upload, Plus, Trash2, CheckCircle2, FileDown, PackageMinus, Receipt, MoreHorizontal, CalendarClock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProdutoAutocomplete } from "@/components/produto-autocomplete";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { PDFPreviewDialog } from "@/lib/pdf/PDFPreviewDialog";
import { gerarESalvarPDF } from "@/lib/pdf/generate";
import { PDFHistoryCard } from "@/lib/pdf/PDFHistoryCard";
import { BaixaEstoqueDialog } from "@/components/baixa-estoque-dialog";
import { HistoricoEstoqueCard } from "@/components/historico-estoque-card";
import { MateriaisPrevistosCard } from "@/components/materiais-previstos-card";
import { TarefasDaOS } from "@/components/os/tarefas-card";
import { ApontamentoDaOS } from "@/components/os/apontamento-card";
import { QualidadeDaOS } from "@/components/os/qualidade-card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { QuemTrouxeAVenda } from "@/components/os/quem-trouxe-a-venda";
import { dicaTela } from "@/lib/dicas";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { Clock, Package, Factory as FactoryIcon, DollarSign, AlertTriangle } from "lucide-react";
import { mensagemErro } from "@/lib/erros";
import { atrasado, formatarData } from "@/domain/os/prazo";
import {
  dinheiro,
  divergencia,
  origemDoPrevisto,
  porcentagem,
  realizados,
  type Campo,
} from "@/domain/os/resultado";

export const Route = createFileRoute("/_authenticated/os/$id")({
  head: () => ({ meta: [{ title: "OS — BEX PRINT OS" }] }),
  component: OSDetailPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">OS não encontrada</div>,
});

/**
 * Os status vêm da fonte única, não de uma lista escrita à mão aqui.
 *
 * A lista que morava neste arquivo oferecia "novo" e "em_design" — nenhum dos
 * dois existe no enum `status_os`. Escolher qualquer um e salvar devolvia
 * "invalid input value for enum". Ficou assim porque eram quatro listas para a
 * mesma verdade e nada conferia uma contra a outra.
 */

function OSDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  // canSeePrices/nivelDeVisao: preço de venda (vendedor vê); canSeeFinancials:
  // custo, margem, fatura e a aba Financeiro (só quem tem financeiro.read).
  const { canSeeFinancials, canSeePrices, nivelDeVisao, user, hasPermission } = useAuth();
  const [previewOpen, setPreviewOpen] = useState<null | "cliente" | "producao">(null);
  const [gerandoFatura, setGerandoFatura] = useState(false);
  // Mesma regra da RPC agendar_os_na_maquina: kanban.move OU os.update.
  // Quem não tem nem um nem outro não vê o botão — botão que só dá 42501 é
  // botão morto.
  const podeAgendar = hasPermission("kanban.move") || hasPermission("os.update");
  const [agendando, setAgendando] = useState(false);
  const [agendamento, setAgendamento] = useState<ResultadoAgendamento | null>(null);
  // A RPC insere as reservas sem olhar o que já existe: clicar de novo agenda
  // a MESMA peça uma segunda vez, em outro horário, e a máquina aparece com o
  // dobro de horas ocupadas. Quem já tem reserva viva cancela na agenda antes.
  const { data: reservasVivas } = useQuery({
    queryKey: ["os-reservas-vivas", id],
    enabled: podeAgendar,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("maquinas_agenda")
        .select("id", { count: "exact", head: true })
        .eq("os_id", id)
        .in("status", ["agendado", "em_producao"]);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const jaAgendada = (reservasVivas ?? 0) > 0;

  /**
   * Cria as reservas de máquina a partir dos itens da OS.
   *
   * O retorno interessa mais que o sucesso: um item pulado por falta de máquina
   * padrão ou de tempo de produção é um cadastro incompleto que a pessoa pode
   * consertar agora. Por isso o resultado fica na tela, não só no toast — toast
   * some em 4 segundos e leva o motivo junto.
   */
  async function agendarNaMaquina() {
    setAgendando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("agendar_os_na_maquina", { p_os_id: id });
      if (error) throw error;
      const r = (data ?? {}) as ResultadoAgendamento;
      setAgendamento(r);
      const criadas = Number(r.criadas ?? 0);
      const puladas = Array.isArray(r.puladas) ? r.puladas : [];
      if (criadas > 0) {
        toast.success(criadas === 1 ? "1 reserva criada" : `${criadas} reservas criadas`);
        qc.invalidateQueries({ queryKey: ["os", id] });
        qc.invalidateQueries({ queryKey: ["maquinas-agenda"] });
        qc.invalidateQueries({ queryKey: ["os-para-agenda"] });
        qc.invalidateQueries({ queryKey: ["itens-os", id] });
        qc.invalidateQueries({ queryKey: ["os-reservas-vivas", id] });
      } else if (puladas.length === 0) {
        toast.error("Esta OS não tem itens para agendar. Cadastre as peças na aba Itens.");
      } else {
        toast.warning("Nenhuma reserva criada. Veja o motivo de cada peça logo abaixo.");
      }
    } catch (e: unknown) {
      toast.error(mensagemErro(e));
    } finally {
      setAgendando(false);
    }
  }

  async function gerarFatura() {
    setGerandoFatura(true);
    try {
      await gerarESalvarPDF({ tipo: "fatura", referencia_id: id });
      toast.success("Fatura gerada");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar a fatura");
    } finally {
      setGerandoFatura(false);
    }
  }
  const [baixaOpen, setBaixaOpen] = useState(false);

  const { data: os, isLoading } = useQuery({
    queryKey: ["os", id, nivelDeVisao],
    queryFn: async () => {
      // select("*"): a view do nível já traz só as colunas que o nível pode ver
      // (comercial: valor_total sem custo/margem). Nunca pedir coluna nomeada aqui.
      const { data, error } = await fromFinancialView("ordens_servico", nivelDeVisao)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  async function updateStatus(novoStatus: string) {
    const statusAnterior = os?.status;
    if (novoStatus === "concluido") {
      const { data, error } = await (supabase.rpc as any)("fechar_os", { os_id: id });
      if (error) return toast.error(mensagemErro(error));
      const res = data as any;
      if (res && res.fechada === false) {
        const bloqueios: string[] = Array.isArray(res.bloqueios) ? res.bloqueios : [];
        const labels: Record<string, string> = {
          tarefas_obrigatorias: "Tarefas obrigatórias pendentes",
          qualidade_aprovada: "Qualidade não aprovada",
          qualidade_reprovada_ou_retrabalho: "Qualidade reprovada ou em retrabalho",
          materiais_baixados: "Materiais ainda não baixados",
          ocorrencias_tratadas: "Ocorrências abertas",
          logistica_concluida: "Entrega/instalação pendente",
          custos_operacionais: "Sem custos operacionais registrados",
          pagamentos_pendentes: "Pagamentos pendentes",
        };
        toast.error("Não é possível fechar a OS", {
          description: bloqueios.map((b) => `• ${labels[b] ?? b}`).join("\n"),
        });
        qc.invalidateQueries({ queryKey: ["resultado-os", id] });
        return;
      }
      toast.success("OS concluída — snapshot de resultado gerado e pesquisa de pós-venda agendada");
    } else {
      // A assinatura real é avancar_os_status(os_id, novo_status) — SEM prefixo
      // p_ e sem justificativa. Esta tela mandava p_os_id/p_novo_status/
      // p_justificativa, e o PostgREST não achava a função: trocar status pela
      // tela da OS falhava sempre. O Kanban chamava certo; este ponto ficou
      // para trás. tests/rpc-assinaturas guarda os dois lados agora.
      const { error } = await (supabase.rpc as any)("avancar_os_status", {
        os_id: id,
        novo_status: novoStatus,
      });
      if (error) return toast.error(mensagemErro(error));
      toast.success("Status atualizado");
    }
    await supabase.from("logs_auditoria").insert({
      entidade: "ordens_servico", entidade_id: id, acao: novoStatus === "concluido" ? "fechamento_os" : "status_change",
      detalhes: { anterior: statusAnterior, novo: novoStatus }, usuario_id: user?.id,
    });
    qc.invalidateQueries({ queryKey: ["os", id] });
    qc.invalidateQueries({ queryKey: ["resultado-os", id] });
    qc.invalidateQueries({ queryKey: ["snapshot-os", id] });
  }


  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  if (!os) return <div className="p-6">OS não encontrada</div>;

  return (
    <div className="space-y-6">
      <SectionHeader
        ajuda={dicaTela("/os")}
        breadcrumb={`Ordem de Serviço · #${os.numero}`}
        title={os.titulo}
        description={os.cliente_nome ? `Cliente: ${os.cliente_nome}` : undefined}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* No celular o Voltar precisa de 44px de alvo; no desktop fica o ícone de 36px. */}
            <Link to="/os">
              <Button variant="ghost" size="icon" title="Voltar" className="h-11 w-11 md:h-9 md:w-9">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <StatusChip label={rotuloDe(os.status)} tone="cyan" />
            {/* Status + trocar status ficam sempre visíveis: é a ação principal do detalhe. */}
            <Select value={os.status} onValueChange={updateStatus}>
              <SelectTrigger className="w-full sm:w-56 h-11 md:h-9 text-base md:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS.map((st) => (
                  <SelectItem key={st.status} value={st.status}>
                    {st.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* PDF Cliente é preço de venda: o vendedor precisa gerar. */}
            {canSeePrices && (
              <Button variant="outline" className="hidden md:inline-flex" onClick={() => setPreviewOpen("cliente")}>
                <FileDown className="h-4 w-4 mr-1" /> PDF Cliente
              </Button>
            )}
            <Button variant="outline" className="hidden md:inline-flex" onClick={() => setPreviewOpen("producao")}>
              <FileDown className="h-4 w-4 mr-1" /> PDF Produção
            </Button>
            {/* Fatura só para quem vê valor: é o documento de cobrança. */}
            {canSeeFinancials && (
              <Button variant="outline" className="hidden md:inline-flex" disabled={gerandoFatura} onClick={gerarFatura}>
                <Receipt className="h-4 w-4 mr-1" />
                {gerandoFatura ? "Gerando…" : "Fatura"}
              </Button>
            )}
            {/* Agendar é ação de produção, não de dinheiro: gate por permissão de
                mover produção, do mesmo jeito que a RPC faz no banco. */}
            {podeAgendar && (
              <Button
                variant="outline"
                className="hidden md:inline-flex"
                disabled={agendando || jaAgendada}
                title={jaAgendada ? "Esta OS já está na agenda. Cancele as reservas antes de agendar de novo." : undefined}
                onClick={agendarNaMaquina}
              >
                <CalendarClock className="h-4 w-4 mr-1" />
                {agendando ? "Agendando…" : jaAgendada ? "Já está na agenda" : "Agendar na máquina"}
              </Button>
            )}
            <Button
              variant="outline"
              className="hidden md:inline-flex"
              disabled={os.estoque_baixado}
              onClick={() => setBaixaOpen(true)}
            >
              <PackageMinus className="h-4 w-4 mr-1" />
              {os.estoque_baixado ? "Estoque baixado" : "Baixar estoque"}
            </Button>
            {/* Celular: os secundários vão para o menu "Mais", com os MESMOS gates dos botões acima. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="md:hidden h-11">
                  <MoreHorizontal className="h-4 w-4 mr-1" /> Mais
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canSeePrices && (
                  <DropdownMenuItem className="py-3" onClick={() => setPreviewOpen("cliente")}>
                    <FileDown className="h-4 w-4 mr-2" /> PDF Cliente
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="py-3" onClick={() => setPreviewOpen("producao")}>
                  <FileDown className="h-4 w-4 mr-2" /> PDF Produção
                </DropdownMenuItem>
                {canSeeFinancials && (
                  <DropdownMenuItem className="py-3" disabled={gerandoFatura} onClick={gerarFatura}>
                    <Receipt className="h-4 w-4 mr-2" />
                    {gerandoFatura ? "Gerando…" : "Fatura"}
                  </DropdownMenuItem>
                )}
                {podeAgendar && (
                  <DropdownMenuItem
                    className="py-3"
                    disabled={agendando || jaAgendada}
                    onClick={agendarNaMaquina}
                  >
                    <CalendarClock className="h-4 w-4 mr-2" />
                    {agendando ? "Agendando…" : jaAgendada ? "Já está na agenda" : "Agendar na máquina"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="py-3" disabled={os.estoque_baixado} onClick={() => setBaixaOpen(true)}>
                  <PackageMinus className="h-4 w-4 mr-2" />
                  {os.estoque_baixado ? "Estoque baixado" : "Baixar estoque"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {agendamento && (
        <ResultadoDoAgendamento
          resultado={agendamento}
          podeAbrirProdutos={hasPermission("custos.read")}
          aoFechar={() => setAgendamento(null)}
        />
      )}

      {/* Quem ganha a comissão desta OS. Era herdado em silêncio do cliente; agora dá para ver e corrigir. */}
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <QuemTrouxeAVenda alvo="os" id={id} vendedorId={(os as any).vendedor_id ?? null} invalidar={[["os", id]]} compacto />
      </div>

      {/* KPI row */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Prazo"
          // `prazo_entrega` é DATE: `new Date("2026-09-09")` cai em UTC e, no
          // horário de Brasília, exibia 08/09 — um dia a menos do que está no
          // banco. Ver domain/os/prazo.
          value={formatarData(os.prazo_entrega)}
          icon={Clock}
          tone={atrasado(os.prazo_entrega) && os.status !== "concluido" ? "magenta" : "cyan"}
        />
        <KpiCard
          label="Produto"
          value={os.produtos?.nome ?? "—"}
          icon={Package}
          tone="cyan"
        />
        <KpiCard
          label="Máquina"
          value={os.maquinas?.nome ?? "—"}
          icon={FactoryIcon}
          tone="lime"
        />
        {canSeePrices && (
          <KpiCard
            label="Valor total"
            value={`R$ ${Number(os.valor_total ?? 0).toFixed(2)}`}
            icon={DollarSign}
            tone="lime"
          />
        )}
      </div>

      <Tabs defaultValue="resumo">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="itens">Itens</TabsTrigger>
          <TabsTrigger value="arquivos">Arquivos</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          {canSeeFinancials && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
        </TabsList>

        <TabsContent value="resumo"><ResumoTab os={os} /></TabsContent>
        <TabsContent value="itens"><ItensTab osId={id} canSeeFinancials={canSeeFinancials} canSeePrices={canSeePrices} nivelDeVisao={nivelDeVisao} /></TabsContent>
        <TabsContent value="arquivos"><ArquivosTab osId={id} userId={user?.id} /></TabsContent>
        <TabsContent value="tarefas"><TarefasTab osId={id} userId={user?.id} /></TabsContent>
        <TabsContent value="historico"><HistoricoTab osId={id} /></TabsContent>
        {canSeeFinancials && <TabsContent value="financeiro"><FinanceiroTab osId={id} userId={user?.id} os={os} /></TabsContent>}
      </Tabs>

      <PDFHistoryCard tipo="os" referencia_id={id} />

      {/* Antes dos materiais: é a lista que decide se a OS pode fechar. */}
      <TarefasDaOS osId={id} />

      {/* Depois das tarefas: é o tempo de máquina que vira custo real. */}
      <ApontamentoDaOS osId={id} />

      {/* Depois da produção: é a conferência que libera o fechamento. */}
      <QualidadeDaOS osId={id} />

      <MateriaisPrevistosCard osId={id} />

      <HistoricoEstoqueCard osId={id} />

      <PDFPreviewDialog
        open={previewOpen !== null}
        onOpenChange={(o) => !o && setPreviewOpen(null)}
        tipo="os"
        referencia_id={id}
        mostrarValores={previewOpen !== "producao"}
      />

      <BaixaEstoqueDialog
        open={baixaOpen}
        onOpenChange={setBaixaOpen}
        osId={id}
        userId={user?.id ?? null}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["os", id] });
          qc.invalidateQueries({ queryKey: ["historico-estoque", id] });
        }}
      />
    </div>
  );
}

type ReservaCriada = { id: string; maquina: string | null; item: string; inicio: string; minutos: number };
type ItemPulado = { item: string; motivo: string };
type ResultadoAgendamento = {
  os?: number | string;
  criadas?: number;
  reservas?: ReservaCriada[];
  puladas?: ItemPulado[];
};

/**
 * Cada motivo de pulo vira um caminho clicável — o motivo só serve se levar à
 * tela onde ele se resolve. "Produto sem máquina padrão" e "sem tempo de
 * produção" são cadastro de produto; "sem horário livre" é agenda cheia.
 *
 * `precisaCustosRead`: /produtos exige custos.read. O designer tem os.update
 * (e portanto agenda), mas não abre /produtos — nesse caso mostramos o que
 * falta sem oferecer um link que devolveria "sem acesso".
 */
function comoResolver(motivo: string): { texto: string; para: string; precisaCustosRead: boolean } | null {
  if (/m[áa]quina padr[ãa]o/i.test(motivo))
    return { texto: "Definir a máquina padrão do produto", para: "/produtos", precisaCustosRead: true };
  if (/tempo de produ[çc][ãa]o/i.test(motivo))
    return { texto: "Informar o tempo de produção do produto", para: "/produtos", precisaCustosRead: true };
  if (/hor[áa]rio livre/i.test(motivo))
    return { texto: "Ver a agenda das máquinas", para: "/maquinas-agenda", precisaCustosRead: false };
  return null;
}

function quandoComeca(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * O que saiu do agendamento, na tela e não só no toast.
 *
 * O toast some em segundos e leva junto a única informação acionável: qual
 * peça não entrou e por quê. Quem está no balcão precisa ler isso com calma e
 * clicar para consertar o cadastro.
 */
function ResultadoDoAgendamento({
  resultado,
  podeAbrirProdutos,
  aoFechar,
}: {
  resultado: ResultadoAgendamento;
  podeAbrirProdutos: boolean;
  aoFechar: () => void;
}) {
  const reservas = Array.isArray(resultado.reservas) ? resultado.reservas : [];
  const puladas = Array.isArray(resultado.puladas) ? resultado.puladas : [];
  const criadas = Number(resultado.criadas ?? 0);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-[color:var(--bex-cyan)]" />
          {criadas > 0
            ? criadas === 1
              ? "1 reserva criada na agenda das máquinas"
              : `${criadas} reservas criadas na agenda das máquinas`
            : "Nenhuma reserva foi criada"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 md:h-8 shrink-0 text-xs"
          onClick={aoFechar}
        >
          Fechar
        </Button>
      </div>

      {reservas.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {reservas.map((r) => (
            <li key={r.id}>
              <span className="text-foreground">{r.item}</span> · {r.maquina ?? "máquina"} ·{" "}
              {quandoComeca(r.inicio)} · {r.minutos} min
            </li>
          ))}
        </ul>
      )}

      {/* Peça sem cadastro completo não entra na agenda em silêncio: aparece
          aqui com o motivo e o caminho para resolver. */}
      {puladas.length > 0 && (
        <div className="space-y-2 rounded border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--bex-amber)]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {puladas.length === 1
              ? "1 peça ficou de fora da agenda"
              : `${puladas.length} peças ficaram de fora da agenda`}
          </div>
          <ul className="space-y-2 text-xs">
            {puladas.map((p, i) => {
              const saida = comoResolver(p.motivo);
              const podeIr = saida && (!saida.precisaCustosRead || podeAbrirProdutos);
              return (
                <li key={`${p.item}-${i}`} className="space-y-0.5">
                  <div>
                    <span className="font-medium">{p.item}</span>
                    <span className="text-muted-foreground"> — {p.motivo}</span>
                  </div>
                  {podeIr && saida ? (
                    <Link
                      to={saida.para}
                      className="inline-flex min-h-[44px] items-center text-[color:var(--bex-cyan)] underline underline-offset-2 md:min-h-0"
                    >
                      {saida.texto}
                    </Link>
                  ) : (
                    saida && (
                      <div className="text-muted-foreground">
                        Peça ao gestor: {saida.texto.toLowerCase()}.
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {/* Agendamento parcial é beco sem saída se ninguém avisar: o botão
              trava enquanto a OS tiver reserva viva (senão a peça já agendada
              entraria duas vezes), então corrigir o cadastro não basta — tem
              de cancelar o que entrou e agendar de novo. */}
          {criadas > 0 && (
            <p className="text-xs text-muted-foreground">
              Depois de corrigir o cadastro, cancele na{" "}
              <Link
                to="/maquinas-agenda"
                className="text-[color:var(--bex-cyan)] underline underline-offset-2"
              >
                agenda das máquinas
              </Link>{" "}
              {criadas === 1 ? "a reserva" : `as ${criadas} reservas`} desta OS e agende de novo —
              o botão só libera com a OS fora da agenda, para não reservar a mesma peça duas vezes.
            </p>
          )}
        </div>
      )}

      {criadas === 0 && puladas.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Esta OS não tem itens. Cadastre as peças na aba <strong>Itens</strong> e agende de novo.
        </p>
      )}
    </div>
  );
}

function ResumoTab({ os }: { os: any }) {
  return (
    <Card>
      <CardContent className="p-6 grid md:grid-cols-2 gap-6">
        <div>
          <Label className="text-xs text-muted-foreground">Briefing</Label>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {os.briefing || <span className="text-muted-foreground">—</span>}
          </p>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Prazo:</span> {os.prazo_entrega || "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Prioridade:</span> {os.prioridade}
          </div>
          <div>
            <span className="text-muted-foreground">Criada em:</span>{" "}
            {new Date(os.created_at).toLocaleString("pt-BR")}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ItensTab({
  osId,
  canSeeFinancials,
  canSeePrices,
  nivelDeVisao,
}: {
  osId: string;
  canSeeFinancials: boolean;
  canSeePrices: boolean;
  nivelDeVisao: NivelDeVisao;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    descricao: "",
    quantidade: "1",
    unidade: "un",
    valor_unitario: "0",
    custo_unitario: "0",
    produto_id: null as string | null,
  });
  const { data: itens = [] } = useQuery({
    queryKey: ["itens-os", osId, nivelDeVisao],
    queryFn: async () => {
      // select("*"): comercial devolve valor_unitario/valor_total sem custo_unitario.
      const { data } = await fromFinancialView("itens_os", nivelDeVisao)
        .select("*")
        .eq("os_id", osId)
        .order("ordem");
      return data ?? [];
    },
  });
  async function add() {
    if (!form.descricao) return toast.error("Descrição obrigatória");
    const qtd = parseFloat(form.quantidade);
    // Quem vê preço digita preço (vendedor inclusive); quem não vê grava 0.
    const vu = canSeePrices ? parseFloat(form.valor_unitario) : 0;
    const { error } = await supabase.from("itens_os").insert({
      os_id: osId,
      descricao: form.descricao,
      quantidade: qtd,
      unidade: form.unidade,
      valor_unitario: vu,
      custo_unitario: parseFloat(form.custo_unitario),
      valor_total: qtd * vu,
      ordem: itens.length,
      produto_id: form.produto_id,
    } as any);
    if (error) return toast.error(mensagemErro(error));
    setForm({
      descricao: "",
      quantidade: "1",
      unidade: "un",
      valor_unitario: "0",
      custo_unitario: "0",
      produto_id: null,
    });
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  async function remove(id: string) {
    await supabase.from("itens_os").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["itens-os", osId] });
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex justify-end">
          <ProdutoAutocomplete
            onSelect={(p) =>
              setForm({
                descricao: p.nome,
                quantidade: form.quantidade || "1",
                unidade: p.unidade,
                valor_unitario: String(p.preco_base ?? 0),
                custo_unitario: String(p.custo_medio ?? 0),
                produto_id: p.id,
              })
            }
          />
        </div>
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <Label>Descrição</Label>
            <Input
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
          <div className="col-span-1">
            <Label>Qtd</Label>
            <Input
              type="number"
              value={form.quantidade}
              onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
            />
          </div>
          <div className="col-span-1">
            <Label>Un</Label>
            <Input
              value={form.unidade}
              onChange={(e) => setForm({ ...form, unidade: e.target.value })}
            />
          </div>
          {/* Valor un. é preço (vendedor vê); Custo un. é custo (só financeiro). */}
          {canSeePrices && (
            <div className="col-span-2">
              <Label>Valor un.</Label>
              <Input
                type="number"
                step="0.01"
                value={form.valor_unitario}
                onChange={(e) => setForm({ ...form, valor_unitario: e.target.value })}
              />
            </div>
          )}
          {canSeeFinancials && (
            <div className="col-span-2">
              <Label>Custo un.</Label>
              <Input
                type="number"
                step="0.01"
                value={form.custo_unitario}
                onChange={(e) => setForm({ ...form, custo_unitario: e.target.value })}
              />
            </div>
          )}
          <Button className="col-span-1" onClick={add}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Qtd</TableHead>
              {canSeePrices && (
                <>
                  <TableHead>Valor un.</TableHead>
                  <TableHead>Total</TableHead>
                </>
              )}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Sem itens
                </TableCell>
              </TableRow>
            )}
            {itens.map((i: any) => (
              <TableRow key={i.id}>
                <TableCell>{i.descricao}</TableCell>
                <TableCell>
                  {i.quantidade} {i.unidade}
                </TableCell>
                {canSeePrices && (
                  <>
                    <TableCell>R$ {Number(i.valor_unitario).toFixed(2)}</TableCell>
                    <TableCell>R$ {Number(i.valor_total).toFixed(2)}</TableCell>
                  </>
                )}
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => remove(i.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ArquivosTab({ osId, userId }: { osId: string; userId?: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [substituir, setSubstituir] = useState<any | null>(null);
  const [aprovar, setAprovar] = useState<any | null>(null);
  const [uploadMeta, setUploadMeta] = useState({ tipo: "arte", tarefa_id: "sem-tarefa", conversa_id: "", observacao: "" });
  const [aprovacao, setAprovacao] = useState({ canal: "sistema", cliente_contato_id: "sem-contato", observacao: "" });

  const { data: arquivos = [] } = useQuery({
    queryKey: ["arquivos-os", osId],
    queryFn: async () => {
      const { data } = await supabase
        .from("arquivos")
        .select("*")
        .eq("os_id", osId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas-os", osId, "arquivos"],
    queryFn: async () => (await supabase.from("os_tarefas").select("id,titulo").eq("os_id", osId).order("created_at")).data ?? [],
  });

  const { data: contatos = [] } = useQuery({
    queryKey: ["contatos-os", osId],
    queryFn: async () => {
      const { data: osData } = await fromFinancialView("ordens_servico", false).select("cliente_id").eq("id", osId).single();
      if (!osData?.cliente_id) return [];
      return (await supabase.from("cliente_contatos").select("id,nome").eq("cliente_id", osData.cliente_id).order("principal", { ascending: false })).data ?? [];
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const baseNome = substituir?.nome ?? file.name;
      const path = `${osId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("arquivos-clientes").upload(path, file);
      if (upErr) throw upErr;
      const versao = arquivos.filter((a: any) => a.nome === file.name).length + 1;
      const { data: novo, error } = await (supabase as any).from("arquivos").insert({
        os_id: osId,
        nome: file.name,
        caminho: path,
        mime_type: file.type,
        tamanho_bytes: file.size,
        enviado_por: userId,
        versao,
      }).select("id").single();
      if (error) throw error;

      if (substituir && novo?.id) {
        const { error: subErr } = await (supabase as any).from("arquivos").update({
          status: "substituido" as any,
          substituido_por: novo.id,
          ativo: false,
          observacao: substituir.observacao ?? "Substituído por nova versão",
        }).eq("id", substituir.id);
        if (subErr) throw subErr;
      }

      await supabase.from("logs_auditoria").insert({
        entidade: "arquivos",
        entidade_id: novo?.id,
        acao: substituir ? "nova_versao" : "upload",
        detalhes: { os_id: osId, nome: baseNome, versao, substituido_id: substituir?.id ?? null },
        usuario_id: userId,
      });

      toast.success(substituir ? "Nova versão enviada e versão anterior substituída" : "Arquivo enviado");
      setSubstituir(null);
      qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    } catch (err: any) {
      toast.error(mensagemErro(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function marcarInativo(id: string) {
    const { error } = await (supabase as any).from("arquivos").update({ status: "inativo", ativo: false }).eq("id", id);
    if (error) return toast.error(mensagemErro(error));
    qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    toast.success("Arquivo marcado como inativo");
  }

  /**
   * Registrar o que o cliente respondeu — pelo telefone, pelo WhatsApp ou no
   * balcão.
   *
   * A versão anterior fazia um INSERT direto em `aprovacoes` com
   * `aprovado: true` fixo, e parava aí. Três consequências:
   *
   *  1. não havia como registrar "o cliente pediu ajuste": só existia o sim;
   *  2. a OS continuava em "aguardando aprovação de arte", porque nada mexia
   *     no status — ao contrário do link, que move;
   *  3. e o inverso também: quando o cliente aprovava PELO LINK, a gravação ia
   *     para `arquivo_aprovacoes`, mas `os_bloqueios_para` só lia `aprovacoes`.
   *     A OS ia para "arte aprovada" e a produção seguia barrada com "Arte
   *     ainda não aprovada" até alguém registrar a MESMA aprovação de novo,
   *     aqui, na mão.
   *
   * Agora é uma RPC só, que escreve nas duas tabelas, muda o status do arquivo
   * e avança a OS — o mesmo que o link faz.
   */
  async function registrarAprovacao(decisao: "aprovado" | "ajuste") {
    if (!aprovar) return;
    const { error } = await (supabase as any).rpc("registrar_aprovacao_interna", {
      p_os_id: osId,
      p_arquivo_id: aprovar.id,
      p_decisao: decisao,
      p_canal: aprovacao.canal,
      p_cliente_contato_id:
        aprovacao.cliente_contato_id === "sem-contato" ? null : aprovacao.cliente_contato_id,
      p_observacao: aprovacao.observacao || null,
    });
    if (error) return toast.error(mensagemErro(error));

    setAprovar(null);
    setAprovacao({ canal: "sistema", cliente_contato_id: "sem-contato", observacao: "" });
    qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    qc.invalidateQueries({ queryKey: ["os", osId] });
    toast.success(
      decisao === "aprovado"
        ? "Arte aprovada. A OS avançou e a produção está liberada."
        : "Ajuste registrado. A arte voltou para o design.",
    );
  }

  async function download(caminho: string) {
    const { data } = await supabase.storage.from("arquivos-clientes").createSignedUrl(caminho, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function marcarFinal(id: string) {
    const { error } = await supabase.from("arquivos").update({ final_producao: true }).eq("id", id);
    if (error) return toast.error(mensagemErro(error));
    qc.invalidateQueries({ queryKey: ["arquivos-os", osId] });
    toast.success("Arquivo marcado como final de produção");
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-[160px_1fr_1fr_2fr_auto] md:items-end">
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={uploadMeta.tipo} onValueChange={(tipo) => setUploadMeta({ ...uploadMeta, tipo })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['arte','briefing','referencia','producao','orcamento','comprovante','outro'].map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tarefa</Label>
            <Select value={uploadMeta.tarefa_id} onValueChange={(tarefa_id) => setUploadMeta({ ...uploadMeta, tarefa_id })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sem-tarefa">Sem tarefa</SelectItem>
                {tarefas.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.titulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Conversa ID</Label><Input value={uploadMeta.conversa_id} onChange={(e) => setUploadMeta({ ...uploadMeta, conversa_id: e.target.value })} placeholder="Opcional" /></div>
          <div className="space-y-2"><Label>Observação</Label><Input value={uploadMeta.observacao} onChange={(e) => setUploadMeta({ ...uploadMeta, observacao: e.target.value })} placeholder="Contexto do arquivo" /></div>
          <Button onClick={() => { setSubstituir(null); fileRef.current?.click(); }} disabled={uploading}>
            <Upload className="h-4 w-4 mr-2" /> {uploading ? "Enviando..." : "Enviar arquivo"}
          </Button>
        </div>

        {substituir && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Subindo nova versão de <strong>{substituir.nome}</strong>. A versão v{substituir.versao} será marcada como substituída, sem exclusão do arquivo antigo.</div>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead>Aprovação</TableHead>
              <TableHead>Final</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {arquivos.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Sem arquivos
                </TableCell>
              </TableRow>
            )}
            {arquivos.map((a: any) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.nome}</TableCell>
                <TableCell>v{a.versao}</TableCell>
                <TableCell>{((a.tamanho_bytes ?? 0) / 1024).toFixed(1)} KB</TableCell>
                <TableCell>
                  {a.status === "aprovado" ? (
                    <Badge variant="outline">Aprovada</Badge>
                  ) : a.status === "rejeitado" ? (
                    <Badge variant="destructive">Ajuste pedido</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{a.final_producao && <Badge>Final</Badge>}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="ghost" onClick={() => download(a.caminho)}>
                    Baixar
                  </Button>
                  {/* O diálogo de aprovação existia inteiro e NINGUÉM abria: não
                      havia uma única chamada de setAprovar com um arquivo. Sem
                      esta porta, a única aprovação possível era a do link, e a
                      produção ficava barrada quando o cliente aceitava por
                      telefone. */}
                  {a.tipo === "arte" && a.status !== "aprovado" && (
                    <Button size="sm" variant="outline" onClick={() => setAprovar(a)}>
                      Registrar resposta
                    </Button>
                  )}
                  {!a.final_producao && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Marcar como arquivo final de produção"
                      onClick={() => marcarFinal(a.id)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!aprovar} onOpenChange={(open) => !open && setAprovar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>O que o cliente respondeu?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">Arquivo: <strong>{aprovar?.nome}</strong> v{aprovar?.versao}</div>
            <div className="space-y-2">
              <Label>Canal</Label>
              <Select value={aprovacao.canal} onValueChange={(canal) => setAprovacao({ ...aprovacao, canal })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['sistema','whatsapp','email','presencial','telefone'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cliente/contato</Label>
              <Select value={aprovacao.cliente_contato_id} onValueChange={(cliente_contato_id) => setAprovacao({ ...aprovacao, cliente_contato_id })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sem-contato">Sem contato específico</SelectItem>
                  {contatos.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                value={aprovacao.observacao}
                onChange={(e) => setAprovacao({ ...aprovacao, observacao: e.target.value })}
                placeholder="Para um ajuste, diga o que mudar — sem isso o designer não sabe o que corrigir."
              />
            </div>
          </div>
          {/* Dois botões, porque são dois fatos diferentes. Um botão só com
              "aprovado" fixo obrigava a mentir quando o cliente pedia ajuste. */}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="h-11 md:h-10"
              onClick={() => registrarAprovacao("ajuste")}
            >
              Pediu ajuste
            </Button>
            <Button className="h-11 md:h-10" onClick={() => registrarAprovacao("aprovado")}>
              Aprovou
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TarefasTab({ osId, userId }: { osId: string; userId?: string }) {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas-os", osId],
    queryFn: async () => {
      const { data } = await supabase
        .from("os_tarefas")
        .select("*")
        .eq("os_id", osId)
        .order("created_at");
      return data ?? [];
    },
  });
  async function add() {
    if (!titulo) return;
    // obrigatoria=false: tarefas de checklist rápido não devem bloquear o
    // fechamento da OS (fechar_os barra apenas tarefas obrigatórias pendentes).
    const { error } = await supabase
      .from("os_tarefas")
      .insert({ os_id: osId, titulo, created_by: userId, obrigatoria: false });
    if (error) return toast.error(mensagemErro(error));
    setTitulo("");
    qc.invalidateQueries({ queryKey: ["tarefas-os", osId] });
  }
  async function toggle(t: any) {
    const concluida = t.status === "concluida";
    const { error } = await supabase
      .from("os_tarefas")
      .update({
        status: concluida ? "pendente" : "concluida",
        fim_real: concluida ? null : new Date().toISOString(),
        completed_by: concluida ? null : userId,
      })
      .eq("id", t.id);
    if (error) return toast.error(mensagemErro(error));
    qc.invalidateQueries({ queryKey: ["tarefas-os", osId] });
  }
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Nova tarefa..."
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-1">
          {tarefas.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Sem tarefas</p>
          )}
          {tarefas.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
              <input type="checkbox" checked={t.status === "concluida"} onChange={() => toggle(t)} />
              <span className={t.status === "concluida" ? "line-through text-muted-foreground" : ""}>
                {t.titulo}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricoTab({ osId }: { osId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["historico-os", osId],
    queryFn: async () => {
      const { data } = await supabase
        .from("logs_auditoria")
        .select("*")
        .eq("entidade", "ordens_servico")
        .eq("entidade_id", osId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <Card>
      <CardContent className="p-4">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sem histórico</p>
        ) : (
          <div className="space-y-2">
            {data.map((l: any) => (
              <div key={l.id} className="text-sm border-l-2 border-accent pl-3 py-1">
                <div className="font-medium">{l.acao}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(l.created_at).toLocaleString("pt-BR")} — {JSON.stringify(l.detalhes)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FinanceiroTab({ osId, userId, os }: { osId: string; userId?: string; os: any }) {
  const qc = useQueryClient();
  const [pag, setPag] = useState({ valor: "", data_vencimento: "", forma_pagamento: "" });
  const [custo, setCusto] = useState({ descricao: "", valor: "", categoria: "" });

  const { data: pagamentos = [] } = useQuery({
    queryKey: ["pag-os", osId],
    queryFn: async () =>
      (await supabase.from("pagamentos").select("*").eq("os_id", osId).order("data_vencimento"))
        .data ?? [],
  });
  const { data: custos = [] } = useQuery({
    queryKey: ["custos-os", osId],
    queryFn: async () =>
      (
        await supabase
          .from("custos_operacionais_os")
          .select("*")
          .eq("os_id", osId)
          .order("data", { ascending: false })
      ).data ?? [],
  });
  const { data: resultado } = useQuery({
    queryKey: ["resultado-os", osId],
    queryFn: async () => (await (supabase as any).from("vw_resultado_os").select("*").eq("os_id", osId).maybeSingle()).data as any,
  });
  const { data: snapshot } = useQuery({
    queryKey: ["snapshot-os", osId],
    queryFn: async () => (await (supabase as any).from("os_resultado_snapshots").select("*").eq("os_id", osId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as any,
  });


  async function addPag() {
    if (!pag.valor) return toast.error("Valor obrigatório");
    const { error } = await supabase.from("pagamentos").insert({
      os_id: osId,
      valor: parseFloat(pag.valor),
      data_vencimento: pag.data_vencimento || null,
      forma_pagamento: pag.forma_pagamento || null,
      registrado_por: userId,
    });
    if (error) return toast.error(mensagemErro(error));
    setPag({ valor: "", data_vencimento: "", forma_pagamento: "" });
    qc.invalidateQueries({ queryKey: ["pag-os", osId] });
  }

  async function addCusto() {
    if (!custo.descricao || !custo.valor || !custo.categoria)
      return toast.error("Descrição, categoria e valor obrigatórios");
    const { error } = await supabase.from("custos_operacionais_os").insert({
      os_id: osId,
      origem: custo.descricao,
      categoria: custo.categoria,
      quantidade: 1,
      valor_unitario: parseFloat(custo.valor),
      usuario_id: userId,
    });
    if (error) return toast.error(mensagemErro(error));
    setCusto({ descricao: "", valor: "", categoria: "" });
    qc.invalidateQueries({ queryKey: ["custos-os", osId] });
    qc.invalidateQueries({ queryKey: ["resultado-os", osId] });
  }

  async function marcarPago(id: string) {
    const { error } = await (supabase.rpc as any)("confirmar_pagamento_registrado", {
      p_pagamento_id: id,
      p_data: new Date().toISOString().slice(0, 10),
      p_referencia_externa: null,
    });
    if (error) return toast.error(mensagemErro(error));
    qc.invalidateQueries({ queryKey: ["pag-os", osId] });
  }

  const totalRecebido = pagamentos
    .filter((p: any) => p.status === "pago")
    .reduce((s: number, p: any) => s + Number(p.valor), 0);
  const totalCustos = custos.reduce((s: number, c: any) => s + Number(c.total), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Resultado real da OS</span>
            {snapshot && (
              <span className="text-xs font-mono text-muted-foreground">
                Snapshot: {new Date(snapshot.created_at).toLocaleString("pt-BR")}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {resultado ? (
            <>
              {/* Aviso antes dos números, não depois: enquanto não houver custo
                  lançado, metade deste quadro é previsão e a outra metade não
                  existe. Antes desta correção a tela preenchia a metade que não
                  existe com 100% de margem. */}
              {!realizados(resultado).custoLancado && (
                <div className="mb-3 flex items-start gap-2 rounded border border-[color:var(--bex-amber)]/40 bg-[color:var(--bex-amber)]/10 px-3 py-2 text-xs text-[color:var(--bex-amber)]">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    Nenhum custo foi lançado nesta OS, então lucro e margem realizados não podem
                    ser calculados. Registre a baixa de material ou finalize um apontamento de
                    máquina.
                  </span>
                </div>
              )}
              <div className="grid md:grid-cols-3 gap-3 text-sm">
                <CelulaResultado rotulo="Receita líquida" campo={dinheiro(resultado.receita_liquida)} />
                <CelulaResultado
                  rotulo="Custo previsto"
                  campo={dinheiro(resultado.custo_previsto)}
                  nota={origemDoPrevisto(resultado.custo_previsto_origem)}
                />
                <CelulaResultado rotulo="Custo realizado" campo={realizados(resultado).custo} />
                <CelulaResultado rotulo="Lucro previsto" campo={dinheiro(resultado.lucro_previsto)} />
                <CelulaResultado rotulo="Lucro realizado" campo={realizados(resultado).lucro} />
                <CelulaResultado rotulo="Margem prevista" campo={porcentagem(resultado.margem_prevista)} />
                <CelulaResultado rotulo="Margem realizada" campo={realizados(resultado).margem} />
                <CelulaResultado rotulo="Divergência custo" campo={divergencia(resultado)} />
                <div className="rounded border p-3">
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-semibold">
                    {resultado.atraso ? "Com atraso" : "No prazo"} · {resultado.status_financeiro ?? "—"}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">O resultado será calculado quando houver custos operacionais e pagamentos registrados. Valor atual da OS: R$ {Number(os.valor_total ?? 0).toFixed(2)}.</p>
          )}
        </CardContent>
      </Card>


      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Pagamentos — Recebido R$ {totalRecebido.toFixed(2)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Input
              placeholder="Valor"
              type="number"
              step="0.01"
              value={pag.valor}
              onChange={(e) => setPag({ ...pag, valor: e.target.value })}
            />
            <Input
              type="date"
              value={pag.data_vencimento}
              onChange={(e) => setPag({ ...pag, data_vencimento: e.target.value })}
            />
            <Input
              placeholder="Forma"
              value={pag.forma_pagamento}
              onChange={(e) => setPag({ ...pag, forma_pagamento: e.target.value })}
            />
            <Button onClick={addPag}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1">
            {pagamentos.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm border rounded p-2"
              >
                <div>
                  R$ {Number(p.valor).toFixed(2)}{" "}
                  <span className="text-muted-foreground">— venc. {p.data_vencimento ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.status === "pago" ? "default" : "outline"}>{p.status}</Badge>
                  {p.status !== "pago" && (
                    <Button size="sm" variant="ghost" onClick={() => marcarPago(p.id)}>
                      Marcar pago
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
            </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Custos reais — Total R$ {totalCustos.toFixed(2)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Input
              placeholder="Descrição"
              value={custo.descricao}
              onChange={(e) => setCusto({ ...custo, descricao: e.target.value })}
            />
            <Select
              value={custo.categoria}
              onValueChange={(v) => setCusto({ ...custo, categoria: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                {["material", "mao_obra", "maquina", "terceiros", "acabamento", "logistica", "retrabalho", "taxa", "comissao"].map(
                  (cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Input
              placeholder="Valor"
              type="number"
              step="0.01"
              value={custo.valor}
              onChange={(e) => setCusto({ ...custo, valor: e.target.value })}
            />
            <Button onClick={addCusto}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-1">
            {custos.map((c: any) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-sm border rounded p-2"
              >
                <div>
                  {c.origem}{" "}
                  {c.categoria && <span className="text-muted-foreground">({c.categoria})</span>}
                </div>
                <div>R$ {Number(c.total).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Uma célula do quadro de resultado.
 *
 * O que muda em relação ao que havia aqui: um valor ausente aparece como
 * ausente e diz o motivo, em vez de virar "R$ 0,00" — que se lê como um custo
 * medido de zero reais e não como "ninguém lançou".
 */
function CelulaResultado({ rotulo, campo, nota }: { rotulo: string; campo: Campo; nota?: string }) {
  const ausente = campo.tipo === "ausente";
  return (
    <div className="rounded border p-3" title={ausente ? campo.motivo : undefined}>
      <div className="text-muted-foreground">{rotulo}</div>
      <div className={ausente ? "font-medium text-muted-foreground" : "font-semibold"}>
        {campo.texto}
      </div>
      {nota && <div className="mt-0.5 text-[11px] text-muted-foreground">{nota}</div>}
    </div>
  );
}
