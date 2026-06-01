/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock,
  DollarSign,
  Download,
  Factory,
  FileText,
  Lock,
  MessageCircle,
  Package,
  Printer,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — BEX PRINT OS" }] }),
  component: RelatPage,
});

type ReportResponse = {
  canSeeFinancials: boolean;
  periodo: { inicio: string; fim: string };
  financeiro: null | {
    faturamentoPorPeriodo: FaturamentoRow[];
    lucroPorOs: LucroOsRow[];
    margemPorProduto: MargemProdutoRow[];
  };
  operacional: {
    osAtrasadas: OsAtrasadaRow[];
    retrabalhoPorSetor: RetrabalhoRow[];
    producaoPorMaquina: ProducaoMaquinaRow[];
    tempoMedioPorEtapa: TempoEtapaRow[];
  };
  whatsapp: {
    conversasAbertas: ConversaAbertaRow[];
    tempoMedioResposta: TempoRespostaRow[];
  };
};

type FaturamentoRow = {
  periodo: string;
  pagamentos: number;
  ordens_servico: number;
  faturamento: number;
};
type LucroOsRow = {
  os_id: string;
  numero: number;
  titulo: string;
  cliente: string;
  criada_em: string;
  status: string;
  receita: number;
  custo: number;
  lucro: number;
  margem_percentual: number | null;
};
type MargemProdutoRow = {
  produto: string;
  quantidade: number;
  receita: number;
  custo: number;
  margem_valor: number;
  margem_percentual: number | null;
  ultima_venda: string | null;
};
type OsAtrasadaRow = {
  os_id: string;
  numero: number;
  titulo: string;
  cliente: string;
  status: string;
  prazo_entrega: string;
  dias_atraso: number;
  valor_total: number;
};
type RetrabalhoRow = {
  setor: string;
  retrabalhos: number;
  ocorrencias: number;
  custo_total: number;
  ultima_ocorrencia: string | null;
};
type ProducaoMaquinaRow = {
  maquina_id: string;
  maquina: string;
  tipo: string | null;
  apontamentos: number;
  ordens_servico: number;
  quantidade_produzida: number;
  horas_produzidas: number;
  ultimo_apontamento: string | null;
};
type TempoEtapaRow = {
  etapa: string;
  apontamentos_concluidos: number;
  horas_media: number | null;
  horas_minima: number | null;
  horas_maxima: number | null;
};
type ConversaAbertaRow = {
  conversa_id: string;
  contato_nome: string;
  telefone: string;
  etiqueta: string | null;
  atendente: string | null;
  aberta_em: string;
  ultima_mensagem_em: string;
  mensagens_entrada: number;
  mensagens_saida: number;
};
type TempoRespostaRow = {
  conversa_id: string;
  contato_nome: string;
  atendente: string | null;
  respostas: number;
  minutos_media_resposta: number | null;
};

type ExportRow = Record<string, string | number | null | undefined>;
type RelatoriosRpc = (
  fn: "get_relatorios_prioritarios",
  args: { p_inicio: string; p_fim: string },
) => Promise<{ data: unknown; error: Error | null }>;

type ExportSection = {
  title: string;
  rows: ExportRow[];
};

const today = new Date().toISOString().slice(0, 10);
const defaultStart = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

function asNumber(value: unknown) {
  return Number(value ?? 0);
}

function formatMoney(value: unknown) {
  return money.format(asNumber(value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${decimal.format(Number(value))}%`;
}

function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${decimal.format(Number(value))} h`;
}

function formatMinutes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${decimal.format(Number(value))} min`;
}

function csvEscape(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, sections: ExportSection[]) {
  const csv = sections
    .flatMap((section) => {
      if (section.rows.length === 0) return [`# ${section.title}`, "Sem dados"];
      const headers = Object.keys(section.rows[0]);
      return [
        `# ${section.title}`,
        headers.map(csvEscape).join(","),
        ...section.rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
      ];
    })
    .join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportPdf(
  title: string,
  periodo: { inicio: string; fim: string },
  sections: ExportSection[],
) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;

  const sectionHtml = sections
    .map((section) => {
      if (section.rows.length === 0) return `<h2>${section.title}</h2><p>Sem dados no período.</p>`;
      const headers = Object.keys(section.rows[0]);
      const head = headers.map((h) => `<th>${h}</th>`).join("");
      const body = section.rows
        .map((row) => `<tr>${headers.map((h) => `<td>${row[h] ?? ""}</td>`).join("")}</tr>`)
        .join("");
      return `<h2>${section.title}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    })
    .join("");

  win.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
    h1 { margin-bottom: 4px; } h2 { margin-top: 28px; font-size: 18px; }
    .periodo { color: #6b7280; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: left; }
    th { background: #f9fafb; }
  </style></head><body><h1>${title}</h1><div class="periodo">Período: ${periodo.inicio} a ${periodo.fim}</div>${sectionHtml}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function buildFinancialSections(data: ReportResponse): ExportSection[] {
  const financeiro = data.financeiro;
  if (!financeiro) return [];
  return [
    { title: "Faturamento por período", rows: financeiro.faturamentoPorPeriodo },
    { title: "Lucro por OS", rows: financeiro.lucroPorOs },
    { title: "Margem por produto", rows: financeiro.margemPorProduto },
  ];
}

function buildOperationalSections(data: ReportResponse): ExportSection[] {
  return [
    { title: "OS atrasadas", rows: data.operacional.osAtrasadas },
    { title: "Retrabalho por setor", rows: data.operacional.retrabalhoPorSetor },
    { title: "Produção por máquina", rows: data.operacional.producaoPorMaquina },
    { title: "Tempo médio por etapa", rows: data.operacional.tempoMedioPorEtapa },
    { title: "Conversas WhatsApp abertas", rows: data.whatsapp.conversasAbertas },
    { title: "Tempo médio de resposta", rows: data.whatsapp.tempoMedioResposta },
  ];
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  description,
  tone = "text-foreground",
}: {
  title: string;
  value: string | number;
  icon: typeof DollarSign;
  description?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
            {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
          </div>
          <div className="rounded-lg bg-muted p-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-muted-foreground">
        Sem dados para o período selecionado.
      </TableCell>
    </TableRow>
  );
}

void [TrendingUp, Package, AlertTriangle, Clock, Users, Wrench];

function RelatPage() {
  const { canSeeFinancials } = useAuth();
  const [inicio, setInicio] = useState(defaultStart);
  const [fim, setFim] = useState(today);

  const { data, isLoading, error } = useQuery({
    queryKey: ["relatorios-prioritarios", inicio, fim],
    queryFn: async () => {
      const rpc = supabase.rpc as unknown as RelatoriosRpc;
      const { data: result, error: rpcError } = await rpc("get_relatorios_prioritarios", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (rpcError) throw rpcError;
      return result as ReportResponse;
    },
  });

  const metrics = useMemo(() => {
    const financeiro = data?.financeiro;
    const operacional = data?.operacional;
    const whatsapp = data?.whatsapp;
    const faturamento =
      financeiro?.faturamentoPorPeriodo.reduce((sum, row) => sum + asNumber(row.faturamento), 0) ??
      0;
    const lucro = financeiro?.lucroPorOs.reduce((sum, row) => sum + asNumber(row.lucro), 0) ?? 0;
    const margemMedia = financeiro?.lucroPorOs.length
      ? financeiro.lucroPorOs.reduce((sum, row) => sum + asNumber(row.margem_percentual), 0) /
        financeiro.lucroPorOs.length
      : null;
    const retrabalhos =
      operacional?.retrabalhoPorSetor.reduce((sum, row) => sum + asNumber(row.retrabalhos), 0) ?? 0;
    const horasProducao =
      operacional?.producaoPorMaquina.reduce(
        (sum, row) => sum + asNumber(row.horas_produzidas),
        0,
      ) ?? 0;
    const respostas =
      whatsapp?.tempoMedioResposta.filter((row) => row.minutos_media_resposta !== null) ?? [];
    const tempoResposta = respostas.length
      ? respostas.reduce((sum, row) => sum + asNumber(row.minutos_media_resposta), 0) /
        respostas.length
      : null;

    return {
      faturamento,
      lucro,
      margemMedia,
      atrasadas: operacional?.osAtrasadas.length ?? 0,
      retrabalhos,
      horasProducao,
      conversasAbertas: whatsapp?.conversasAbertas.length ?? 0,
      tempoResposta,
    };
  }, [data]);

  const periodo = { inicio, fim };
  const financialSections = data ? buildFinancialSections(data) : [];
  const operationalSections = data ? buildOperationalSections(data) : [];
  const allSections = [...financialSections, ...operationalSections];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground">
            Indicadores gerenciais e operacionais com dados reais do Supabase
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="inicio">Início</Label>
            <Input
              id="inicio"
              type="date"
              value={inicio}
              onChange={(event) => setInicio(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fim">Fim</Label>
            <Input
              id="fim"
              type="date"
              value={fim}
              onChange={(event) => setFim(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => data && downloadCsv(`relatorios-${inicio}-${fim}.csv`, allSections)}
          >
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => data && exportPdf("Relatórios principais", periodo, allSections)}
          >
            <Printer className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar os relatórios</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {!canSeeFinancials && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>Relatórios financeiros restritos</AlertTitle>
          <AlertDescription>
            Faturamento, lucro e margem ficam visíveis apenas para perfis admin, gestor e
            financeiro.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {canSeeFinancials && (
          <>
            <SummaryCard
              title="Faturamento"
              value={formatMoney(metrics.faturamento)}
              icon={DollarSign}
              description="Pagamentos marcados como pagos"
              tone="text-emerald-600"
            />
            <SummaryCard
              title="Lucro"
              value={formatMoney(metrics.lucro)}
              icon={TrendingUp}
              description={`Margem média ${formatPercent(metrics.margemMedia)}`}
              tone="text-blue-600"
            />
          </>
        )}
        <SummaryCard
          title="OS atrasadas"
          value={metrics.atrasadas}
          icon={AlertTriangle}
          description="Prazo vencido e ainda não finalizadas"
          tone="text-rose-600"
        />
        <SummaryCard
          title="Retrabalhos"
          value={metrics.retrabalhos}
          icon={Wrench}
          description="Ocorrências marcadas como retrabalho"
        />
        <SummaryCard
          title="Produção"
          value={formatHours(metrics.horasProducao)}
          icon={Factory}
          description="Horas apontadas por máquina"
        />
        <SummaryCard
          title="WhatsApp abertas"
          value={metrics.conversasAbertas}
          icon={MessageCircle}
          description={`Resposta média ${formatMinutes(metrics.tempoResposta)}`}
          tone="text-emerald-600"
        />
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Carregando relatórios...</div>}

      {canSeeFinancials && data?.financeiro && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Financeiros</h2>
              <p className="text-sm text-muted-foreground">
                Disponível para admin, gestor e financeiro
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(`relatorios-financeiros-${inicio}-${fim}.csv`, financialSections)
                }
              >
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportPdf("Relatórios financeiros", periodo, financialSections)}
              >
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Faturamento por período</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Pagamentos</TableHead>
                      <TableHead className="text-right">Faturamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.financeiro.faturamentoPorPeriodo.length === 0 ? (
                      <EmptyRow cols={3} />
                    ) : (
                      data.financeiro.faturamentoPorPeriodo.map((row) => (
                        <TableRow key={row.periodo}>
                          <TableCell>{row.periodo}</TableCell>
                          <TableCell>{row.pagamentos}</TableCell>
                          <TableCell className="text-right">
                            {formatMoney(row.faturamento)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lucro por OS</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>OS</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Lucro</TableHead>
                      <TableHead className="text-right">Margem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.financeiro.lucroPorOs.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.financeiro.lucroPorOs.map((row) => (
                        <TableRow key={row.os_id}>
                          <TableCell className="font-medium">#{row.numero}</TableCell>
                          <TableCell>{row.cliente}</TableCell>
                          <TableCell className="text-right">{formatMoney(row.lucro)}</TableCell>
                          <TableCell className="text-right">
                            {formatPercent(row.margem_percentual)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Margem por produto</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Receita</TableHead>
                      <TableHead className="text-right">Margem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.financeiro.margemPorProduto.length === 0 ? (
                      <EmptyRow cols={3} />
                    ) : (
                      data.financeiro.margemPorProduto.map((row) => (
                        <TableRow key={row.produto}>
                          <TableCell>{row.produto}</TableCell>
                          <TableCell className="text-right">{formatMoney(row.receita)}</TableCell>
                          <TableCell className="text-right">
                            {formatPercent(row.margem_percentual)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {data && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Operacionais e WhatsApp</h2>
              <p className="text-sm text-muted-foreground">
                Acompanhamento de prazo, produção, retrabalho e atendimento
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(`relatorios-operacionais-${inicio}-${fim}.csv`, operationalSections)
                }
              >
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportPdf("Relatórios operacionais e WhatsApp", periodo, operationalSections)
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>OS atrasadas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>OS</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Prazo</TableHead>
                      <TableHead className="text-right">Atraso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.operacional.osAtrasadas.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.operacional.osAtrasadas.map((row) => (
                        <TableRow key={row.os_id}>
                          <TableCell className="font-medium">#{row.numero}</TableCell>
                          <TableCell>{row.cliente}</TableCell>
                          <TableCell>{row.prazo_entrega}</TableCell>
                          <TableCell className="text-right">{row.dias_atraso} dias</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Retrabalho por setor</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Setor</TableHead>
                      <TableHead>Retrabalhos</TableHead>
                      <TableHead>Ocorrências</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.operacional.retrabalhoPorSetor.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.operacional.retrabalhoPorSetor.map((row) => (
                        <TableRow key={row.setor}>
                          <TableCell>{row.setor}</TableCell>
                          <TableCell>{row.retrabalhos}</TableCell>
                          <TableCell>{row.ocorrencias}</TableCell>
                          <TableCell className="text-right">
                            {formatMoney(row.custo_total)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Produção por máquina</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Máquina</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead className="text-right">Horas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.operacional.producaoPorMaquina.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.operacional.producaoPorMaquina.map((row) => (
                        <TableRow key={row.maquina_id}>
                          <TableCell>{row.maquina}</TableCell>
                          <TableCell>{row.tipo ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            {decimal.format(asNumber(row.quantidade_produzida))}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatHours(row.horas_produzidas)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tempo médio por etapa</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Etapa</TableHead>
                      <TableHead>Apontamentos</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                      <TableHead className="text-right">Faixa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.operacional.tempoMedioPorEtapa.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.operacional.tempoMedioPorEtapa.map((row) => (
                        <TableRow key={row.etapa}>
                          <TableCell>{row.etapa}</TableCell>
                          <TableCell>{row.apontamentos_concluidos}</TableCell>
                          <TableCell className="text-right">
                            {formatHours(row.horas_media)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatHours(row.horas_minima)} / {formatHours(row.horas_maxima)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Conversas WhatsApp abertas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contato</TableHead>
                      <TableHead>Atendente</TableHead>
                      <TableHead>Etiqueta</TableHead>
                      <TableHead className="text-right">Mensagens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.whatsapp.conversasAbertas.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.whatsapp.conversasAbertas.map((row) => (
                        <TableRow key={row.conversa_id}>
                          <TableCell>
                            <div className="font-medium">{row.contato_nome}</div>
                            <div className="text-xs text-muted-foreground">{row.telefone}</div>
                          </TableCell>
                          <TableCell>{row.atendente ?? "—"}</TableCell>
                          <TableCell>
                            {row.etiqueta ? <Badge variant="outline">{row.etiqueta}</Badge> : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.mensagens_entrada + row.mensagens_saida}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tempo médio de resposta</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contato</TableHead>
                      <TableHead>Atendente</TableHead>
                      <TableHead>Respostas</TableHead>
                      <TableHead className="text-right">Média</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.whatsapp.tempoMedioResposta.length === 0 ? (
                      <EmptyRow cols={4} />
                    ) : (
                      data.whatsapp.tempoMedioResposta.map((row) => (
                        <TableRow key={row.conversa_id}>
                          <TableCell>{row.contato_nome}</TableCell>
                          <TableCell>{row.atendente ?? "—"}</TableCell>
                          <TableCell>{row.respostas}</TableCell>
                          <TableCell className="text-right">
                            {formatMinutes(row.minutos_media_resposta)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fontes de dados</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
          <div className="flex gap-2">
            <DollarSign className="mt-0.5 h-4 w-4" /> pagamentos, custos_os, ordens_servico e
            itens_os
          </div>
          <div className="flex gap-2">
            <Package className="mt-0.5 h-4 w-4" /> ocorrencias e apontamentos_producao
          </div>
          <div className="flex gap-2">
            <Clock className="mt-0.5 h-4 w-4" /> conversas_whatsapp e mensagens_whatsapp
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
