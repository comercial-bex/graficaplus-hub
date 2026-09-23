/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  Factory,
  Gauge,
  Timer,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { dicaTela } from "@/lib/dicas";
import { getRoutePermissions } from "@/lib/permissions";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { POR_TIPO } from "@/domain/producao/identidade-da-maquina";
import { SeloDaMaquina } from "@/components/kanban/icone-da-maquina";

export const Route = createFileRoute("/_authenticated/capacidade")({
  head: () => ({
    meta: [
      { title: "Capacidade da oficina — BEX PRINT OS" },
      {
        name: "description",
        content:
          "Quanto de cada máquina já está vendido na semana, quanto ainda cabe e o que falta cadastrar para a conta fechar.",
      },
      { property: "og:title", content: "Capacidade da oficina — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Ocupação por máquina na semana, com as horas que ainda cabem.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CapacidadePage,
});

/* ------------------------------------------------------------------ *
 * O que a RPC devolve
 * ------------------------------------------------------------------ */

type MaquinaCapacidade = {
  maquina_id: string;
  nome: string;
  tipo: string | null;
  setor: string | null;
  horas_produtivas_mensais: number | null;
  horas_disponiveis: number | null;
  horas_reservadas: number | null;
  horas_realizadas: number | null;
  reservas: number | null;
  em_producao: number | null;
  /** Nulo quando a máquina não tem horas produtivas ou a janela não tem dia útil. */
  ocupacao_pct: number | null;
  /** A RPC devolve NULO para quem não vê financeiro — a tela esconde o campo. */
  custo_hora: number | null;
  velocidade_m2_h: number | null;
  base_cobranca: string | null;
  sem_custo_hora: boolean;
  sem_velocidade: boolean;
};

type Capacidade = {
  inicio: string;
  fim: string;
  dias_uteis: number;
  ver_dinheiro: boolean;
  maquinas: MaquinaCapacidade[];
};

/* ------------------------------------------------------------------ *
 * A janela
 * ------------------------------------------------------------------ */

type Janela = "esta_semana" | "proxima_semana" | "este_mes";

const JANELAS: { chave: Janela; rotulo: string }[] = [
  { chave: "esta_semana", rotulo: "Esta semana" },
  { chave: "proxima_semana", rotulo: "Próxima semana" },
  { chave: "este_mes", rotulo: "Este mês" },
];

/**
 * Data local em AAAA-MM-DD.
 *
 * `toISOString()` converte para UTC e no Brasil devolve o dia anterior — a
 * semana da oficina começaria no domingo e a última segunda-feira do mês
 * cairia no mês errado. Montamos a string com as partes locais mesmo.
 */
function iso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Segunda-feira da semana de `base`. A semana da oficina começa na segunda. */
function segundaDaSemana(base: Date): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  // getDay(): 0 = domingo. Domingo recua 6 dias, segunda recua 0.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * `fim` é EXCLUSIVO: a RPC conta os dias úteis até `fim - 1` e cruza a agenda
 * com `inicio <= x < fim`. Mandar o domingo como fim cortaria o sábado fora.
 */
function janelaDe(chave: Janela): { inicio: string; fim: string; ultimoDia: Date } {
  const hoje = new Date();
  if (chave === "este_mes") {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const ultimo = new Date(fim);
    ultimo.setDate(ultimo.getDate() - 1);
    return { inicio: iso(ini), fim: iso(fim), ultimoDia: ultimo };
  }
  const ini = segundaDaSemana(hoje);
  if (chave === "proxima_semana") ini.setDate(ini.getDate() + 7);
  const fim = new Date(ini);
  fim.setDate(fim.getDate() + 7);
  const ultimo = new Date(fim);
  ultimo.setDate(ultimo.getDate() - 1);
  return { inicio: iso(ini), fim: iso(fim), ultimoDia: ultimo };
}

/* ------------------------------------------------------------------ *
 * Formatação
 * ------------------------------------------------------------------ */

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Horas com uma casa e vírgula: "12,5 h". */
const horas = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;

const pct = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

const diaCurto = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * A faixa de cor da barra.
 *
 * Até 70% cabe trabalho novo sem apertar ninguém; de 70 a 95 a máquina está
 * cheia e o vendedor precisa saber antes de prometer prazo; acima de 95 já
 * está vendido mais do que a máquina roda na janela.
 */
function faixaDeOcupacao(p: number): { barra: string; texto: string; rotulo: string } {
  if (p > 95)
    return {
      barra: "bg-destructive",
      texto: "text-destructive",
      rotulo: "Lotada",
    };
  if (p >= 70)
    return {
      barra: "bg-[color:var(--bex-amber)]",
      texto: "text-[color:var(--bex-amber)]",
      rotulo: "Apertada",
    };
  return {
    barra: "bg-emerald-500",
    texto: "text-emerald-500",
    rotulo: "Cabe mais",
  };
}

const BASE_COBRANCA: Record<string, string> = {
  tempo: "por tempo",
  area: "por m²",
  metro_linear: "por metro linear",
  peca: "por peça",
};

/* ------------------------------------------------------------------ *
 * Tela
 * ------------------------------------------------------------------ */

function CapacidadePage() {
  const { canSeeFinancials, hasPermission } = useAuth();
  // Quem pode abrir /maquinas sai do MESMO mapa que o guarda usa, não de um
  // palpite aqui. Corrigido pelo verificador: a linha antiga exigia
  // `maquinas.read`, mas o guarda abre a rota com QUALQUER uma das permissões
  // dela (`maquinas.read` OU `os.read`) — o vendedor e o designer ficavam sem o
  // caminho clicável de uma tela que eles conseguem abrir.
  const podeAbrirMaquinas = (getRoutePermissions("/maquinas") ?? []).some(hasPermission);
  const [janela, setJanela] = useState<Janela>("esta_semana");

  const { inicio, fim, ultimoDia } = useMemo(() => janelaDe(janela), [janela]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["capacidade-das-maquinas", inicio, fim],
    queryFn: async () => {
      const { data: r, error: erroRpc } = await (supabase.rpc as any)("capacidade_das_maquinas", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (erroRpc) throw erroRpc;
      return r as Capacidade;
    },
  });

  // useQuery v5 não tem onError: o aviso sai daqui, uma vez por erro.
  useEffect(() => {
    if (error) toast.error(mensagemErro(error));
  }, [error]);

  const maquinas = data?.maquinas ?? [];

  const total = useMemo(() => {
    const disponiveis = maquinas.reduce((a, m) => a + Number(m.horas_disponiveis ?? 0), 0);
    const reservadas = maquinas.reduce((a, m) => a + Number(m.horas_reservadas ?? 0), 0);
    const reservas = maquinas.reduce((a, m) => a + Number(m.reservas ?? 0), 0);
    const emProducao = maquinas.reduce((a, m) => a + Number(m.em_producao ?? 0), 0);
    return {
      disponiveis,
      reservadas,
      reservas,
      emProducao,
      // Média ponderada pelas horas, não média das médias: uma máquina pequena
      // lotada não pode pesar igual à plotter, que é onde o trabalho mora.
      ocupacaoMedia: disponiveis > 0 ? (100 * reservadas) / disponiveis : null,
    };
  }, [maquinas]);

  /** Nada agendado na janela: a tela não desenha barra reta em zero. */
  const agendaVazia = !isLoading && !error && maquinas.length > 0 && total.reservas === 0;

  const semCusto = maquinas.filter((m) => m.sem_custo_hora);
  const semVelocidade = maquinas.filter((m) => m.sem_velocidade);
  const temPendencia = semCusto.length > 0 || semVelocidade.length > 0;

  const rotuloDaJanela = `${diaCurto(new Date(`${inicio}T12:00:00`))} a ${diaCurto(ultimoDia)}`;

  return (
    <div>
      <SectionHeader
        ajuda={dicaTela("/capacidade")}
        breadcrumb="Print OS · Produção"
        title="Capacidade da oficina"
        description="Quanto de cada máquina já está vendido na semana, e quanto ainda cabe."
      />

      {/* Seletor de janela. h-11 no celular: 44px de alvo de dedo. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {JANELAS.map((j) => (
          <Button
            key={j.chave}
            type="button"
            variant={janela === j.chave ? "default" : "outline"}
            onClick={() => setJanela(j.chave)}
            aria-pressed={janela === j.chave}
            className="h-11 md:h-9"
          >
            {j.rotulo}
          </Button>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarRange className="h-3.5 w-3.5" />
          {rotuloDaJanela}
          {data ? ` · ${data.dias_uteis} dias úteis` : ""}
        </span>
      </div>

      {error && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <div className="font-bold text-destructive">Não deu para carregar a capacidade</div>
              <p className="mt-1 text-sm text-muted-foreground">{mensagemErro(error)}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <div className="text-sm text-muted-foreground">Carregando a agenda das máquinas...</div>}

      {data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <KpiCard
              label="Máquinas ativas"
              value={maquinas.length}
              icon={Factory}
              tone="cyan"
              hint={maquinas.length === 0 ? "Nenhuma máquina ativa" : "Na conta da capacidade"}
            />
            <KpiCard
              label="Horas disponíveis"
              value={horas(total.disponiveis)}
              icon={CalendarClock}
              tone="cyan"
              hint={`${data.dias_uteis} dias úteis na janela`}
            />
            <KpiCard
              label="Horas já reservadas"
              value={horas(total.reservadas)}
              icon={Timer}
              tone={total.reservadas > 0 ? "amber" : "muted"}
              hint={
                total.reservas > 0
                  ? `${total.reservas} reserva${total.reservas > 1 ? "s" : ""} na agenda`
                  : "Nenhuma reserva ainda"
              }
            />
            <KpiCard
              label="Ocupação média"
              // Sem hora disponível nenhuma não existe percentual: "0%" aqui
              // seria inventar um denominador que não existe.
              value={total.ocupacaoMedia == null ? "—" : pct(total.ocupacaoMedia)}
              icon={Gauge}
              tone={
                total.ocupacaoMedia == null || total.ocupacaoMedia === 0
                  ? "muted"
                  : total.ocupacaoMedia > 95
                    ? "magenta"
                    : "amber"
              }
              hint={
                total.ocupacaoMedia == null
                  ? "Falta horas produtivas nas máquinas"
                  : // Corrigido pelo verificador: com a agenda vazia o cartão
                    // dizia "0% · Reservadas ÷ disponíveis", como se a conta
                    // tivesse medido alguma coisa. O zero aqui é falta de
                    // reserva, e a dica passa a dizer isso.
                    agendaVazia
                    ? "Nada agendado nesta janela"
                    : "Reservadas ÷ disponíveis"
              }
            />
          </div>

          {/* ---------------------------------------------------------- *
           * O bloco que faz a tela valer hoje.
           *
           * Com a agenda vazia, ocupação não diz nada. O que decide se a
           * conta fecha é o cadastro: 3 máquinas sem custo/hora e 4 sem
           * velocidade. Por isso este bloco vem ANTES da lista.
           *
           * `sem_custo_hora` é um sinalizador de cadastro, não um valor de
           * dinheiro — a RPC o devolve para toda a equipe de propósito,
           * enquanto zera `custo_hora` para quem não vê financeiro. Quem
           * aponta produção precisa saber que o apontamento dele não vira
           * custo, mesmo sem poder ver quanto custa a hora.
           * ---------------------------------------------------------- */}
          {temPendencia && (
            <Card className="mb-6 border-[color:var(--bex-amber)]/40">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--bex-amber)]" />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-bold">Falta cadastrar para a conta fechar</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Enquanto estes campos estiverem vazios, a capacidade aqui é só uma
                      estimativa: o sistema não sabe quanto tempo a peça leva nem quanto custa a
                      hora da máquina.
                    </p>

                    {semCusto.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          Sem custo/hora ({semCusto.length})
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Apontar produção registra o tempo e não gera custo nenhum — a OS fecha
                          com lucro que não existe.
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {semCusto.map((m) => (
                            <li key={m.maquina_id}>
                              <AtalhoDaMaquina nome={m.nome} podeAbrir={podeAbrirMaquinas} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {semVelocidade.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          Sem velocidade ({semVelocidade.length})
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          O sistema não consegue calcular quanto tempo a peça leva nem reservar a
                          máquina sozinho — toda reserva vira trabalho manual.
                        </p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {semVelocidade.map((m) => (
                            <li key={m.maquina_id}>
                              <AtalhoDaMaquina nome={m.nome} podeAbrir={podeAbrirMaquinas} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agenda vazia: dizer POR QUE está zerado e por onde se enche. */}
          {agendaVazia && (
            <Card className="mb-6">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--bex-cyan)]" />
                  <div className="min-w-0">
                    <h2 className="font-bold">
                      Nenhuma reserva{" "}
                      {janela === "este_mes"
                        ? "neste mês"
                        : janela === "proxima_semana"
                          ? "na próxima semana"
                          : "nesta semana"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      A agenda de máquina se enche sozinha: quando a OS é agendada, cada item vira
                      uma reserva na máquina que vai fazer a peça. Nenhuma OS foi agendada nesta
                      janela, então não há ocupação para mostrar — as horas abaixo são a
                      capacidade que está livre.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to="/os"
                        className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 md:min-h-9"
                      >
                        Agendar uma OS
                      </Link>
                      <Link
                        to="/maquinas-agenda"
                        className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:border-[color:var(--bex-cyan)] hover:text-[color:var(--bex-cyan)] md:min-h-9"
                      >
                        Ver a agenda das máquinas
                      </Link>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {maquinas.length === 0 ? (
            <Card>
              <CardContent className="p-5">
                <h2 className="font-bold">Nenhuma máquina ativa</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  A capacidade é a soma das horas das máquinas ativas. Sem máquina ativa não há o
                  que medir.
                </p>
                {podeAbrirMaquinas ? (
                  <Link
                    to="/maquinas"
                    className="mt-3 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 md:min-h-9"
                  >
                    Cadastrar máquina
                  </Link>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Quem cadastra máquina é o gestor ou o admin — avise a equipe.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {maquinas.map((m) => (
                <LinhaDaMaquina
                  key={m.maquina_id}
                  maquina={m}
                  agendaVazia={agendaVazia}
                  diasUteis={data.dias_uteis}
                  verDinheiro={canSeeFinancials && data.ver_dinheiro}
                />
              ))}
            </div>
          )}

          <CapacidadeDaEquipe inicio={inicio} fim={fim} />
        </>
      )}
    </div>
  );
}

type PessoaCapacidade = {
  usuario_id: string;
  nome: string | null;
  cargo: string | null;
  papeis: string | null;
  horas_semanais: number;
  horas_disponiveis: number;
  horas_reservadas: number;
  horas_realizadas: number;
  tarefas_abertas: number;
  tarefas_atrasadas: number;
  reservas_de_maquina: number;
  ocupacao_pct: number | null;
};

/**
 * Capacidade das pessoas, no mesmo pé da capacidade das máquinas.
 *
 * Na gráfica as duas contas mandam juntas: a plotter pode ter hora livre e não
 * haver quem opere, e o contrário também. O trabalho da pessoa vem de duas
 * fontes que a RPC soma sem contar duas vezes — as tarefas da OS em que ela é
 * responsável, mais as reservas de máquina em que ela é a operadora e que não
 * estão amarradas a uma tarefa.
 *
 * Aqui não entra dinheiro nenhum: é fila de trabalho, e o custo/hora de mão de
 * obra é assunto do financeiro, em outra tela.
 */
function CapacidadeDaEquipe({ inicio, fim }: { inicio: string; fim: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["capacidade-pessoas", inicio, fim],
    queryFn: async () => {
      const { data: r, error: erroRpc } = await (supabase.rpc as any)("capacidade_das_pessoas", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (erroRpc) throw erroRpc;
      return r as { inicio: string; fim: string; dias_uteis: number; pessoas: PessoaCapacidade[] };
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-5 text-sm">
          <div className="font-bold text-destructive">Não deu para carregar a equipe</div>
          <p className="mt-1 text-muted-foreground">{mensagemErro(error)}</p>
        </CardContent>
      </Card>
    );
  }

  const pessoas = data?.pessoas ?? [];
  if (pessoas.length === 0) return null;

  const disponiveis = pessoas.reduce((s, p) => s + Number(p.horas_disponiveis || 0), 0);
  const reservadas = pessoas.reduce((s, p) => s + Number(p.horas_reservadas || 0), 0);
  const semFila = reservadas === 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Capacidade da equipe</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {horas(disponiveis)} disponíveis na janela, {pessoas.length} pessoa
          {pessoas.length === 1 ? "" : "s"}. Máquina livre sem gente para operar não produz — por
          isso as duas contas ficam na mesma tela.
        </p>
      </div>

      {semFila && (
        <Card className="border-dashed">
          <CardContent className="p-5 text-sm">
            <p className="font-medium">Ninguém tem trabalho marcado nesta janela.</p>
            <p className="mt-1 text-muted-foreground">
              A fila de cada pessoa se enche de dois jeitos: pelas tarefas da OS e pelas reservas
              de máquina em que ela é a operadora. Enquanto a OS não for agendada nem ganhar
              tarefa, a equipe aparece com o dia inteiro livre — que é verdade, e não defeito.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {pessoas.map((p) => {
          const ocupacao = p.ocupacao_pct == null ? 0 : Number(p.ocupacao_pct);
          const faixa = faixaDeOcupacao(ocupacao);
          return (
            <Card key={p.usuario_id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold">{p.nome ?? "Sem nome"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[p.cargo, p.papeis].filter(Boolean).join(" · ") || "sem papel"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-mono text-sm font-bold ${faixa.texto}`}>
                      {semFila ? "—" : pct(ocupacao)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {semFila ? "sem fila" : faixa.rotulo}
                    </div>
                  </div>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${faixa.barra}`}
                    style={{ width: `${Math.min(ocupacao, 100)}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {horas(Number(p.horas_reservadas || 0))} de {horas(Number(p.horas_disponiveis || 0))}
                  </span>
                  {p.tarefas_abertas > 0 && <span>{p.tarefas_abertas} tarefa(s)</span>}
                  {p.tarefas_atrasadas > 0 && (
                    <span className="font-medium text-destructive">
                      {p.tarefas_atrasadas} atrasada(s)
                    </span>
                  )}
                  {p.reservas_de_maquina > 0 && <span>{p.reservas_de_maquina} na máquina</span>}
                  {Number(p.horas_realizadas || 0) > 0 && (
                    <span>{horas(Number(p.horas_realizadas))} apontadas</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Nome da máquina no bloco de pendências.
 *
 * Vira link para /maquinas só para quem tem `maquinas.read`; para os outros
 * fica texto simples. Mostrar o nome é útil para todo mundo (o impressor
 * precisa saber que aquela máquina não gera custo), mas mandar para uma tela
 * que responde "Acesso restrito" é pior do que não oferecer o caminho.
 */
function AtalhoDaMaquina({ nome, podeAbrir }: { nome: string; podeAbrir: boolean }) {
  const base =
    "inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 text-sm font-medium md:min-h-9";
  if (!podeAbrir) return <span className={cn(base, "text-muted-foreground")}>{nome}</span>;
  return (
    <Link
      to="/maquinas"
      className={cn(base, "hover:border-[color:var(--bex-cyan)] hover:text-[color:var(--bex-cyan)]")}
    >
      {nome}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Uma máquina
 * ------------------------------------------------------------------ */

function LinhaDaMaquina({
  maquina: m,
  agendaVazia,
  diasUteis,
  verDinheiro,
}: {
  maquina: MaquinaCapacidade;
  agendaVazia: boolean;
  diasUteis: number;
  verDinheiro: boolean;
}) {
  const disponiveis = Number(m.horas_disponiveis ?? 0);
  const reservadas = Number(m.horas_reservadas ?? 0);
  const realizadas = Number(m.horas_realizadas ?? 0);
  const reservas = Number(m.reservas ?? 0);
  const emProducao = Number(m.em_producao ?? 0);
  const ocupacao = m.ocupacao_pct == null ? null : Number(m.ocupacao_pct);
  // Sem horas produtivas a RPC devolve `horas_disponiveis` nula (ou 0), e
  // `horas(0)` escreveria "0,0 h livres" — que lê como máquina lotada, quando
  // a verdade é que ninguém cadastrou as horas. Este caso vem ANTES de tudo.
  const semHorasProdutivas =
    m.horas_produtivas_mensais == null || Number(m.horas_produtivas_mensais) <= 0;
  const identidade = m.tipo ? POR_TIPO[m.tipo] : undefined;
  const faixa = ocupacao == null ? null : faixaDeOcupacao(ocupacao);

  return (
    <Card className="border-border">
      <CardContent className="space-y-3 p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-bold">{m.nome}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {identidade ? (
                <SeloDaMaquina identidade={identidade} />
              ) : (
                m.tipo && <span>{m.tipo}</span>
              )}
              {m.setor && <span>· {m.setor}</span>}
              {m.base_cobranca && (
                <span>· cobra {BASE_COBRANCA[m.base_cobranca] ?? m.base_cobranca}</span>
              )}
            </div>
          </div>
          {faixa && !agendaVazia && (
            <span className={cn("shrink-0 text-lg font-bold tabular-nums", faixa.texto)}>
              {pct(ocupacao as number)}
            </span>
          )}
        </div>

        {/* Com a agenda vazia a barra seria uma linha reta em zero em todas as
            máquinas: informação nenhuma, e ainda passa a impressão de que o
            sistema mediu alguma coisa. Nesse caso mostramos só o que cabe. */}
        {semHorasProdutivas ? (
          <div className="text-sm text-muted-foreground">
            Sem horas produtivas cadastradas — não dá para dizer quanto cabe nem calcular
            ocupação.
          </div>
        ) : agendaVazia ? (
          <div className="text-sm">
            <span className="font-bold tabular-nums">{horas(disponiveis)}</span>{" "}
            <span className="text-muted-foreground">livres na janela · nada agendado</span>
          </div>
        ) : ocupacao == null ? (
          // Com as horas cadastradas, sobrou um motivo só: janela sem dia útil.
          <div className="text-sm text-muted-foreground">
            {diasUteis === 0
              ? "A janela escolhida não tem dia útil — não há capacidade para ocupar."
              : "Não dá para calcular a ocupação desta máquina."}
          </div>
        ) : (
          <>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              // Corrigido pelo verificador: máquina com mais horas vendidas do
              // que roda passa de 100 e o leitor de tela anunciava um valor
              // fora da própria escala. A barra já para em 100%.
              aria-valuenow={Math.min(100, Math.round(ocupacao))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Ocupação de ${m.nome}`}
            >
              <div
                className={cn("h-full rounded-full transition-all", faixa?.barra)}
                style={{ width: `${Math.min(100, Math.max(0, ocupacao))}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="tabular-nums">
                <span className="font-bold">{horas(reservadas)}</span>
                <span className="text-muted-foreground"> de {horas(disponiveis)}</span>
              </span>
              {faixa && (
                <StatusChip
                  label={faixa.rotulo}
                  tone={ocupacao > 95 ? "magenta" : ocupacao >= 70 ? "amber" : "cyan"}
                />
              )}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {reservas} reserva{reservas === 1 ? "" : "s"}
          </span>
          <span>{emProducao} em produção</span>
          {realizadas > 0 && <span>{horas(realizadas)} apontadas</span>}
          {/* Custo/hora vem NULO da RPC para quem não vê financeiro. Não há
              substituto: o campo inteiro some, em vez de mostrar R$ 0,00.
              `custo_hora` é NOT NULL DEFAULT 0 no banco, então máquina sem
              cadastro chega aqui como 0 e não como nulo — corrigido pelo
              verificador: sem `sem_custo_hora` a linha escrevia "R$ 0,00/h",
              que lê como "a hora dessa máquina é de graça". Quem não cadastrou
              já aparece no bloco de pendências acima. */}
          {verDinheiro && !m.sem_custo_hora && m.custo_hora != null && (
            <span>{brl(Number(m.custo_hora))}/h</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
