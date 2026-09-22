import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Factory, PackageCheck, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { dicaTela } from "@/lib/dicas";
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
 */

/** Os status que significam "está comigo, na oficina". */
const NA_OFICINA = [
  "aguardando_producao",
  "producao",
  "em_producao",
  "em_impressao",
  "em_corte",
  "em_acabamento",
  "em_uv",
  "em_laser_cnc",
  "em_3d",
] as const;

/** Já terminou e está esperando sair. */
const PRONTO_PARA_SAIR = ["aguardando_retirada", "aguardando_entrega"] as const;

const ROTULO_STATUS: Record<string, string> = {
  aguardando_producao: "Aguardando produção",
  producao: "Em produção",
  em_producao: "Em produção",
  em_impressao: "Na impressão",
  em_corte: "No corte",
  em_acabamento: "No acabamento",
  em_uv: "No UV",
  em_laser_cnc: "No laser/CNC",
  em_3d: "Na impressão 3D",
  aguardando_retirada: "Pronto — aguardando retirada",
  aguardando_entrega: "Pronto — aguardando entrega",
};

interface OSDaFila {
  id: string;
  numero: number | null;
  titulo: string | null;
  status: string;
  prazo_entrega: string | null;
  prioridade: string | null;
  cliente_nome: string | null;
}

function useFila(status: readonly string[], chave: string) {
  return useQuery({
    queryKey: ["painel-producao", chave],
    queryFn: async (): Promise<OSDaFila[]> => {
      // A view operacional existe justamente para quem não pode ver valor:
      // selecionar a tabela crua traria colunas de dinheiro e a política
      // derrubaria a consulta inteira.
      //
      // O nome do cliente vem numa segunda consulta, de propósito: o PostgREST
      // não faz embed (`clientes(nome)`) a partir de VIEW — a view não tem
      // chave estrangeira declarada, então o embed volta erro e derruba a
      // consulta inteira, sem cair só o nome.
      const { data, error } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, status, prazo_entrega, prioridade, cliente_id")
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

function LinhaOS({ os }: { os: OSDaFila }) {
  const dias = diasAte(os.prazo_entrega);
  const atrasada = dias != null && dias < 0;
  const hoje = dias === 0;

  return (
    <Link
      to="/os"
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            #{os.numero ?? "—"}
          </span>
          <span className="truncate font-medium">{os.titulo || "Sem título"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{os.cliente_nome ?? "Cliente não informado"}</span>
          <Badge variant="outline" className="h-4 text-[10px]">
            {ROTULO_STATUS[os.status] ?? os.status}
          </Badge>
          {os.prioridade === "urgente" && (
            <Badge variant="outline" className="h-4 border-[color:var(--bex-magenta)]/50 text-[10px] text-[color:var(--bex-magenta)]">
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
  );
}

export function PainelProducao() {
  const oficina = useFila(NA_OFICINA, "oficina");
  const prontos = useFila(PRONTO_PARA_SAIR, "prontos");

  const fila = oficina.data ?? [];
  const saindo = prontos.data ?? [];
  const atrasadas = fila.filter((os) => {
    const d = diasAte(os.prazo_entrega);
    return d != null && d < 0;
  }).length;
  const paraHoje = fila.filter((os) => diasAte(os.prazo_entrega) === 0).length;

  return (
    <div className="space-y-8">
      <SectionHeader
        ajuda={dicaTela("/dashboard")}
        breadcrumb="Print OS · Produção"
        title="Minha oficina"
        description="A fila de impressão e acabamento, do prazo mais apertado para o mais folgado."
        actions={<StatusChip label={`${fila.length} na fila`} tone={fila.length > 0 ? "lime" : "muted"} />}
      />

      <PendenciasDoMeuPapel />

      <MinhasComissoes />

      <div className="grid gap-3 md:grid-cols-3">
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

      <Card className="bg-card border-border">
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
            fila.map((os) => <LinhaOS key={os.id} os={os} />)
          )}
        </CardContent>
      </Card>

      {saindo.length > 0 && (
        <Card className="bg-card border-border">
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

      <div className="flex justify-center">
        <Button asChild variant="outline" size="sm">
          <Link to="/kanban">
            Abrir o quadro de produção <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
