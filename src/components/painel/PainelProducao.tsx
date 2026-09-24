import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Factory, Lock, PackageCheck, Timer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";
import { useAuth } from "@/lib/auth-context";
import { etapaDe, rotuloDe, statusPadraoDaEtapa, traduzirBloqueios } from "@/domain/os/etapas";
import { semDinheiro } from "@/domain/os/bloqueio-sem-dinheiro";
import type { BloqueioOs } from "@/components/kanban/cartao-os";
import { PendenciasDoMeuPapel } from "./PendenciasDoMeuPapel";
import { MinhasComissoes } from "./MinhasComissoes";
import { cn } from "@/lib/utils";

/**
 * Painel de quem imprime, acaba e entrega.
 *
 * Até 20/09/2026 havia um painel só para os dez papéis: o impressor abria o
 * sistema e via faturamento do mês, margem por produto e gráfico de receita —
 * nada do que ele precisa para começar o dia, e vários números que ele nem
 * pode ver. A rotina real dele, conforme o organograma da gráfica, é uma fila:
 * o que imprimir agora, o que está no acabamento, o que já está pronto
 * esperando o cliente vir buscar.
 *
 * Por isso aqui não há dinheiro nenhum: é fila de trabalho, ordenada por
 * prazo, com o mais atrasado no topo.
 *
 * No celular a fila vem PRIMEIRO. O impressor abre o app instalado com uma
 * mão, na frente da máquina: o que ele precisa é ver a próxima OS e avançá-la
 * com um toque — não contadores e avisos antes da fila.
 */

/**
 * Os status que significam "está comigo, na oficina".
 *
 * `retrabalho` entra: é a OS que a qualidade devolveu para refazer, justamente
 * a que mais precisa de atenção. `controle_qualidade` fica de fora — é da
 * qualidade, não do impressor.
 */
const NA_OFICINA = [
  "aguardando_producao",
  "producao",
  "em_producao",
  "em_impressao",
  "em_corte",
  "em_acabamento",
  "retrabalho",
  "em_uv",
  "em_laser_cnc",
  "em_3d",
] as const;

/** Já terminou e está esperando sair. */
const PRONTO_PARA_SAIR = ["aguardando_retirada", "aguardando_entrega"] as const;

interface OSDaFila {
  id: string;
  numero: number | null;
  titulo: string | null;
  status: string;
  prazo_entrega: string | null;
  prioridade: string | null;
  cliente_nome: string | null;
  // Decidem se "Pronta" vira aguardando retirada, entrega ou instalação.
  precisa_entrega: boolean | null;
  precisa_instalacao: boolean | null;
}

function useFila(status: readonly string[], chave: string) {
  return useQuery({
    queryKey: ["painel-producao", chave],
    queryFn: async (): Promise<OSDaFila[]> => {
      // A view operacional existe justamente para quem não pode ver valor:
      // selecionar a tabela crua traria colunas de dinheiro e a política
      // derrubaria a consulta inteira.
      //
      // `precisa_entrega` e `precisa_instalacao` existem na view desde a
      // migração 20260909230000 — conferido antes de nomear aqui, porque uma
      // coluna que a view não tem derruba a consulta inteira em silêncio.
      //
      // O nome do cliente vem numa segunda consulta, de propósito: o PostgREST
      // não faz embed (`clientes(nome)`) a partir de VIEW — a view não tem
      // chave estrangeira declarada, então o embed volta erro e derruba a
      // consulta inteira, sem cair só o nome.
      const { data, error } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select(
          "id, numero, titulo, status, prazo_entrega, prioridade, cliente_id, precisa_entrega, precisa_instalacao",
        )
        .in("status", status)
        .order("prazo_entrega", { ascending: true, nullsFirst: false })
        .limit(50);
      if (error) throw error;

      const linhas = (data ?? []) as (Omit<OSDaFila, "cliente_nome"> & { cliente_id: string | null })[];
      const ids = [...new Set(linhas.map((l) => l.cliente_id).filter(Boolean))] as string[];

      let nomes = new Map<string, string>();
      if (ids.length > 0) {
        const { data: cli } = await supabase.from("clientes").select("id, nome").in("id", ids);
        nomes = new Map((cli ?? []).map((c: any) => [c.id as string, c.nome as string]));
      }

      return linhas.map((l) => ({
        ...l,
        cliente_nome: l.cliente_id ? (nomes.get(l.cliente_id) ?? null) : null,
      }));
    },
  });
}

/**
 * As travas de produção, numa chamada só — a mesma consulta do Kanban.
 *
 * São as MESMAS regras que `avancar_os_status` aplica: a RPC e esta função
 * chamam `os_bloqueios_para` no banco. Consultar antes evita que o impressor
 * descubra o impedimento só depois do toque, num toast vermelho.
 */
function useBloqueios() {
  return useQuery({
    queryKey: ["painel-producao", "bloqueios"],
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
}

/** Dias entre hoje e o prazo. Negativo = atrasado. */
function diasAte(prazo: string | null): number | null {
  if (!prazo) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  // Data sem hora é lida como UTC e volta um dia atrás no nosso fuso.
  const [ano, mes, dia] = prazo.slice(0, 10).split("-").map(Number);
  const alvo = new Date(ano, mes - 1, dia);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

/**
 * O próximo passo de um toque, pela etapa em que a OS está.
 *
 * O destino é sempre o status de entrada da etapa seguinte (o mesmo que soltar
 * o cartão na coluna do quadro faria); o passo exato dentro dela o operador
 * refina no Kanban, se precisar. Na saída a própria OS diz se é retirada,
 * entrega ou instalação.
 */
function proximoPasso(os: OSDaFila): { rotulo: string; destino: string } | null {
  switch (etapaDe(os.status)) {
    case "pre_impressao":
      return { rotulo: "Começar", destino: statusPadraoDaEtapa("producao") };
    case "producao":
      return { rotulo: "Mandar p/ acabamento", destino: statusPadraoDaEtapa("acabamento") };
    case "acabamento":
      return { rotulo: "Pronta", destino: statusPadraoDaEtapa("saida", os) };
    // A saída não tinha passo nenhum: a OS chegava em "Pronta" e o painel
    // parava ali. Para quem entrega, a baixa da entrega fecha a OS sozinha —
    // mas a retirada no balcão, que é o caso mais comum da casa, não tinha
    // botão em lugar nenhum: só mudando o status na tela de detalhe.
    case "saida":
      return os.status === "aguardando_retirada"
        ? { rotulo: "Cliente retirou", destino: "concluido" }
        : null;
    default:
      return null;
  }
}

function toneDoStatus(status: string): "magenta" | "cyan" | "muted" {
  if (status === "retrabalho") return "magenta";
  if (etapaDe(status) === "saida") return "cyan";
  return "muted";
}

function LinhaOS({
  os,
  bloqueios = [],
  movendo,
  onAvancar,
}: {
  os: OSDaFila;
  bloqueios?: BloqueioOs[];
  movendo?: boolean;
  onAvancar?: (os: OSDaFila, destino: string) => void;
}) {
  const dias = diasAte(os.prazo_entrega);
  const atrasada = dias != null && dias < 0;
  const hoje = dias === 0;
  const passo = onAvancar ? proximoPasso(os) : null;
  const travada = bloqueios.length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:gap-3">
      {/* A linha abre a OS tocada — não a lista de todas. */}
      <Link
        to="/os/$id"
        params={{ id: os.id }}
        className="-m-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md p-1 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              #{os.numero ?? "—"}
            </span>
            <span className="truncate font-medium">{os.titulo || "Sem título"}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{os.cliente_nome ?? "Cliente não informado"}</span>
            <StatusChip label={rotuloDe(os.status)} tone={toneDoStatus(os.status)} />
            {os.prioridade === "urgente" && (
              <Badge
                variant="outline"
                className="border-[color:var(--bex-magenta)]/50 text-[10px] text-[color:var(--bex-magenta)]"
              >
                urgente
              </Badge>
            )}
          </div>
        </div>

        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            atrasada && "text-[color:var(--bex-magenta)]",
            hoje && "text-[color:var(--bex-amber)]",
            !atrasada && !hoje && "text-muted-foreground",
          )}
        >
          {dias == null
            ? "sem prazo"
            : atrasada
              ? `${Math.abs(dias)}d atrasada`
              : hoje
                ? "vence hoje"
                : `em ${dias}d`}
        </span>
      </Link>

      {passo && (
        <div className="flex flex-col gap-1 md:w-48 md:shrink-0">
          {/* Fora do Link (botão dentro de <a> é HTML inválido) e com stopPropagation
              por garantia: o toque avança a OS, não abre a ficha. */}
          <Button
            type="button"
            variant={travada ? "outline" : "default"}
            className="h-11 w-full"
            disabled={travada || movendo}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAvancar?.(os, passo.destino);
            }}
          >
            {movendo ? "Avançando..." : passo.rotulo}
            {!movendo && !travada && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
          {/* O motivo em texto visível: no celular não existe hover para ler um title. */}
          {travada && (
            <p className="flex items-start gap-1 text-[11px] leading-snug text-[color:var(--bex-amber)]">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{bloqueios.map((b) => b.titulo).join(" · ")}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Contador compacto para o celular: só o número e um rótulo curto. */
function KpiCompacto({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "magenta" | "amber" | "cyan" | "muted";
}) {
  const cor = {
    magenta: "text-[color:var(--bex-magenta)]",
    amber: "text-[color:var(--bex-amber)]",
    cyan: "text-[color:var(--bex-cyan)]",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-2 text-center">
      <p className={cn("text-2xl font-bold tabular-nums leading-none", cor)}>{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export function PainelProducao() {
  const qc = useQueryClient();
  const oficina = useFila(NA_OFICINA, "oficina");
  const prontos = useFila(PRONTO_PARA_SAIR, "prontos");
  const { data: bloqueios = new Map<string, BloqueioOs[]>() } = useBloqueios();
  const { canSeeFinancials, canSeePrices } = useAuth();
  const [movendoId, setMovendoId] = useState<string | null>(null);

  const fila = oficina.data ?? [];
  const saindo = prontos.data ?? [];
  const atrasadas = fila.filter((os) => {
    const d = diasAte(os.prazo_entrega);
    return d != null && d < 0;
  }).length;
  const paraHoje = fila.filter((os) => diasAte(os.prazo_entrega) === 0).length;

  /**
   * Um toque, sem diálogo: o Kanban permite voltar se foi engano. A assinatura
   * real é avancar_os_status(os_id, novo_status) — sem prefixo p_. A própria
   * RPC valida as travas e grava o log de auditoria.
   */
  async function avancar(os: OSDaFila, destino: string) {
    if (movendoId) return;
    setMovendoId(os.id);
    try {
      const { error } = await (supabase.rpc as any)("avancar_os_status", {
        os_id: os.id,
        novo_status: destino,
      });
      if (error) {
        // `avancar_os_status` para "concluido" passa por `fechar_os`, e o que
        // volta são os códigos das travas. Mostrar "custos_operacionais;
        // pagamentos_pendentes" para o impressor não é dizer nada.
        const bruto = mensagemErro(error);
        toast.error(traduzirBloqueios(bruto) ? "A OS ainda não pode fechar" : bruto, {
          description: traduzirBloqueios(bruto) ?? undefined,
        });
        return;
      }
      toast.success(
        destino === "concluido"
          ? `OS #${os.numero ?? "—"} fechada — resultado gravado e pós-venda agendada`
          : `OS #${os.numero ?? "—"} → ${rotuloDe(destino)}`,
      );
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setMovendoId(null);
      // Um prefixo só invalida as duas filas e as travas deste painel.
      qc.invalidateQueries({ queryKey: ["painel-producao"] });
    }
  }

  // Ordem no celular: fila, contadores, prontos, pendências, comissões.
  // No desktop (md:) fica a ordem antiga: pendências e comissões antes.
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <SectionHeader
        className="order-1 mb-0"
        ajuda={dicaTela("/dashboard")}
        breadcrumb="Print OS · Produção"
        title="Minha oficina"
        description="A fila de impressão e acabamento, do prazo mais apertado para o mais folgado."
        actions={<StatusChip label={`${fila.length} na fila`} tone={fila.length > 0 ? "lime" : "muted"} />}
      />

      <div className="order-2 md:hidden">
        <Button asChild size="lg" variant="outline" className="h-12 w-full text-base">
          <Link to="/kanban">
            Quadro de produção <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="order-6 md:order-2">
        <PendenciasDoMeuPapel />
      </div>

      <div className="order-7 md:order-3">
        <MinhasComissoes />
      </div>

      {/* Celular: uma linha com três números. Desktop: os cartões de sempre. */}
      <div className="order-4 grid grid-cols-3 gap-2 md:hidden">
        <KpiCompacto label="Atrasadas" value={atrasadas} tone={atrasadas > 0 ? "magenta" : "muted"} />
        <KpiCompacto label="Hoje" value={paraHoje} tone={paraHoje > 0 ? "amber" : "muted"} />
        <KpiCompacto label="Prontas" value={saindo.length} tone={saindo.length > 0 ? "cyan" : "muted"} />
      </div>
      <div className="hidden md:order-4 md:grid md:grid-cols-3 md:gap-3">
        <KpiCard
          label="Atrasadas"
          value={atrasadas}
          icon={Timer}
          tone={atrasadas > 0 ? "magenta" : "muted"}
          hint="passaram do prazo de entrega"
        />
        <KpiCard
          label="Vencem hoje"
          value={paraHoje}
          icon={Factory}
          tone={paraHoje > 0 ? "amber" : "muted"}
        />
        <KpiCard
          label="Prontos para sair"
          value={saindo.length}
          icon={PackageCheck}
          tone={saindo.length > 0 ? "cyan" : "muted"}
          hint="aguardando retirada ou entrega"
        />
      </div>

      <Card className="order-3 bg-card border-border md:order-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Na oficina agora</CardTitle>
          <p className="text-sm text-muted-foreground">
            Comece pela do topo: é a de prazo mais apertado, não a mais recente.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {oficina.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : fila.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum trabalho na fila. Quando o atendimento mandar uma OS para produção, ela
              aparece aqui.
            </p>
          ) : (
            fila.map((os) => (
              <LinhaOS
                key={os.id}
                os={os}
                bloqueios={(bloqueios.get(os.id) ?? []).map((b) =>
                  semDinheiro(b, canSeeFinancials, canSeePrices),
                )}
                movendo={movendoId === os.id}
                onAvancar={avancar}
              />
            ))
          )}
        </CardContent>
      </Card>

      {saindo.length > 0 && (
        <Card className="order-5 bg-card border-border md:order-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Prontos, esperando sair</CardTitle>
            <p className="text-sm text-muted-foreground">
              Já terminado e ocupando espaço na gráfica. Avise o atendimento para chamar o cliente.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {saindo.map((os) => (
              <LinhaOS key={os.id} os={os} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="order-8 hidden justify-center md:order-7 md:flex">
        <Button asChild variant="outline" size="lg">
          <Link to="/kanban">
            Abrir o quadro de produção <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
