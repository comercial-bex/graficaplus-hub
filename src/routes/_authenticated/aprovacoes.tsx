import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Clock, MessageSquareWarning, PackageCheck } from "lucide-react";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { KpiCard } from "@/components/bex/KpiCard";
import { StatusChip } from "@/components/bex/StatusChip";
import { DataPanel } from "@/components/bex/DataPanel";
import { dicaTela } from "@/lib/dicas";
import { mensagemErro } from "@/lib/erros";

export const Route = createFileRoute("/_authenticated/aprovacoes")({
  head: () => ({
    meta: [
      { title: "Aprovações do cliente — BEX PRINT OS" },
      {
        name: "description",
        content:
          "O que o cliente já aprovou, o que voltou pedindo ajuste e o que já foi finalizado em produção.",
      },
      { property: "og:title", content: "Aprovações do cliente — BEX PRINT OS" },
      {
        property: "og:description",
        content: "Situação de cada orçamento: aprovado, em ajuste ou finalizado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AprovacoesPage,
});

const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataCurta = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

type Linha = {
  id: string;
  numero: string | null;
  titulo: string | null;
  status: string;
  valor_total: number | null;
  enviado_em: string | null;
  aprovado_em: string | null;
  aprovado_por_nome: string | null;
  created_at: string;
  cliente_nome: string | null;
  os_id: string | null;
  os_numero: string | null;
  os_status: string | null;
  finalizado: boolean | null;
  artes_total: number;
  artes_aprovadas: number;
  artes_ajuste: number;
  artes_sem_resposta: number;
  ultima_decisao_em: string | null;
  ajustes_abertos: number;
  ajustes_total: number;
  ultimo_pedido_em: string | null;
};

/**
 * Situação de cada orçamento na cabeça do cliente — não na nossa.
 *
 * Um orçamento pode estar "aprovado" no sistema e ainda ter arte esperando
 * resposta, ou ter voltado com pedido de ajuste pelo portal. Aqui as três
 * fontes (status do orçamento, decisão de arte e pedido do portal) aparecem
 * lado a lado, para ninguém mandar produzir algo que o cliente ainda discute.
 */
function situacao(l: Linha): { rotulo: string; tone: "cyan" | "magenta" | "amber" | "muted" } {
  if (l.ajustes_abertos > 0 || l.artes_ajuste > 0) return { rotulo: "Pediu ajuste", tone: "magenta" };
  if (l.finalizado) return { rotulo: "Finalizado", tone: "cyan" };
  if (l.os_id) return { rotulo: "Em produção", tone: "cyan" };
  if (l.status === "aprovado" || l.status === "convertido") return { rotulo: "Aprovado", tone: "cyan" };
  if (l.status === "rejeitado") return { rotulo: "Recusado", tone: "muted" };
  if (l.status === "expirado") return { rotulo: "Expirado", tone: "muted" };
  if (l.status === "enviado") return { rotulo: "Aguardando cliente", tone: "amber" };
  return { rotulo: "Rascunho", tone: "muted" };
}

const FILTROS = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "aguardando", rotulo: "Aguardando cliente" },
  { chave: "ajuste", rotulo: "Pediu ajuste" },
  { chave: "aprovado", rotulo: "Aprovado" },
  { chave: "finalizado", rotulo: "Finalizado" },
] as const;

function AprovacoesPage() {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["chave"]>("todos");


  const consulta = useQuery({
    queryKey: ["vw-aprovacoes-orcamento"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (c: string, o: { ascending: boolean }) => Promise<{ data: Linha[] | null; error: unknown }>;
          };
        };
      })
        .from("vw_aprovacoes_orcamento")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const dados = consulta.data ?? [];

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return dados.filter((l) => {
      const s = situacao(l).rotulo;
      if (filtro === "aguardando" && s !== "Aguardando cliente") return false;
      if (filtro === "ajuste" && s !== "Pediu ajuste") return false;
      if (filtro === "aprovado" && !(s === "Aprovado" || s === "Em produção")) return false;
      if (filtro === "finalizado" && s !== "Finalizado") return false;
      if (!t) return true;
      return [l.numero, l.titulo, l.cliente_nome, l.os_numero]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(t));
    });
  }, [dados, busca, filtro]);

  const kpis = useMemo(() => {
    let aguardando = 0;
    let ajuste = 0;
    let aprovado = 0;
    let finalizado = 0;
    let valorAguardando = 0;
    for (const l of dados) {
      const s = situacao(l).rotulo;
      if (s === "Aguardando cliente") {
        aguardando += 1;
        valorAguardando += l.valor_total ?? 0;
      }
      if (s === "Pediu ajuste") ajuste += 1;
      if (s === "Aprovado" || s === "Em produção") aprovado += 1;
      if (s === "Finalizado") finalizado += 1;
    }
    return { aguardando, ajuste, aprovado, finalizado, valorAguardando };
  }, [dados]);

  return (
    <div className="p-6">
      <SectionHeader
        breadcrumb="Comercial"
        title="Aprovações do cliente"
        description="O que o cliente aprovou, o que voltou pedindo ajuste e o que já foi entregue."
        ajuda={dicaTela("/aprovacoes")}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard
          label="Aguardando cliente"
          value={kpis.aguardando}
          hint={`${brl(kpis.valorAguardando)} parados esperando resposta`}
          icon={Clock}
          tone="amber"
        />
        <KpiCard
          label="Pediram ajuste"
          value={kpis.ajuste}
          hint="Arte recusada ou pedido aberto no portal"
          icon={MessageSquareWarning}
          tone="magenta"
        />
        <KpiCard label="Aprovados" value={kpis.aprovado} hint="Liberados para produzir" icon={CheckCircle2} />
        <KpiCard label="Finalizados" value={kpis.finalizado} hint="OS concluída ou faturada" icon={PackageCheck} />
      </div>

      <DataPanel
        busca={busca}
        onBusca={setBusca}
        placeholder="Buscar por número, cliente ou título..."
        filtros={
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => setFiltro(f.chave)}
                className={`rounded border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition ${
                  filtro === f.chave
                    ? "border-[color:var(--bex-cyan)]/40 bg-[color:var(--bex-cyan)]/15 text-[color:var(--bex-cyan)]"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        }
        rodape={`${filtradas.length} de ${dados.length} orçamentos`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orçamento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Artes</TableHead>
              <TableHead>Pedidos de ajuste</TableHead>
              <TableHead>Ordem de serviço</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Última resposta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {consulta.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {consulta.error && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-destructive">
                  {mensagemErro(consulta.error)}
                </TableCell>
              </TableRow>
            )}
            {!consulta.isLoading && !consulta.error && filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhum orçamento nesta situação.
                </TableCell>
              </TableRow>
            )}
            {filtradas.map((l) => {
              const s = situacao(l);
              return (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link
                      to="/orcamentos/$id"
                      params={{ id: l.id }}
                      className="font-medium text-foreground hover:text-[color:var(--bex-cyan)]"
                    >
                      {l.numero ?? "s/ número"}
                    </Link>
                    <p className="text-xs text-muted-foreground">{l.titulo ?? "—"}</p>
                  </TableCell>
                  <TableCell className="text-sm">{l.cliente_nome ?? "Contato avulso"}</TableCell>
                  <TableCell>
                    <StatusChip label={s.rotulo} tone={s.tone} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.artes_total === 0 ? (
                      <span className="text-muted-foreground">sem arte anexada</span>
                    ) : (
                      <span>
                        <span className="text-[color:var(--bex-cyan)]">{l.artes_aprovadas} ok</span>
                        {l.artes_ajuste > 0 && (
                          <span className="text-[color:var(--bex-magenta)]"> · {l.artes_ajuste} ajuste</span>
                        )}
                        {l.artes_sem_resposta > 0 && (
                          <span className="text-muted-foreground"> · {l.artes_sem_resposta} sem resposta</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.ajustes_total === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span>
                        {l.ajustes_abertos} aberto(s) de {l.ajustes_total} · {dataCurta(l.ultimo_pedido_em)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {l.os_id ? (
                      <Link
                        to="/os/$id"
                        params={{ id: l.os_id }}
                        className="text-[color:var(--bex-cyan)] hover:underline"
                      >
                        {l.os_numero ?? "abrir OS"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">não convertido</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{brl(l.valor_total ?? 0)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {dataCurta(l.ultima_decisao_em ?? l.aprovado_em ?? l.enviado_em)}
                    {l.aprovado_por_nome && (
                      <p className="text-[11px]">por {l.aprovado_por_nome}</p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DataPanel>
    </div>
  );
}
