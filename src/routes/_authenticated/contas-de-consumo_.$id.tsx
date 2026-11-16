import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, FileText, Paperclip, Pencil } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hojeBr } from "@/lib/hoje-br";
import { mensagemErro } from "@/lib/erros";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { Carregando } from "@/components/bex/Carregando";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePodeNaContaAPagar } from "@/components/financeiro/contas-a-pagar/use-conta-a-pagar";
import {
  dadosDoTipo,
  dataBr,
  faturaEmFalta,
  faturasDaUnidade,
  nomeDaUnidade,
  rotuloDaCompetencia,
  serieDe12Meses,
  textoDaVariacao,
  variacaoContraAnterior,
  type PontoDoMes,
} from "@/domain/financeiro/contas-de-consumo";
import {
  useContasBancariasAtivas,
  useFaturasDeConsumo,
  usePodeNasContasDeConsumo,
  useUnidadesDeConsumo,
} from "@/components/financeiro/contas-de-consumo/use-contas-de-consumo";
import {
  DialogosDeConsumo,
  useAnexosDasFaturas,
  type DialogoDeConsumo,
} from "@/components/financeiro/contas-de-consumo/dialogos-de-consumo";
import { SituacaoDaFatura } from "@/components/financeiro/contas-de-consumo/situacao-da-fatura";

export const Route = createFileRoute("/_authenticated/contas-de-consumo_/$id")({
  head: () => ({ meta: [{ title: "Unidade consumidora — BEX PRINT OS" }] }),
  component: UnidadeDeConsumoPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numeroBr = (n: number | string | null) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function UnidadeDeConsumoPage() {
  const { id } = Route.useParams();
  const hoje = hojeBr();
  const { podeCadastrarUnidade, podeLancarFatura, podeCorrigirDados } = usePodeNasContasDeConsumo();
  const { podePagar } = usePodeNaContaAPagar();
  const unidades = useUnidadesDeConsumo();
  const faturas = useFaturasDeConsumo();
  const bancos = useContasBancariasAtivas();
  const lista = faturas.data ?? [];
  const daUnidade = faturasDaUnidade(lista, id);
  const anexos = useAnexosDasFaturas(daUnidade);
  const [dialogo, setDialogo] = useState<DialogoDeConsumo | null>(null);

  if (unidades.isLoading || faturas.isLoading) return <Carregando />;
  const erro = unidades.error ?? faturas.error;
  if (erro)
    return <p className="text-sm text-destructive">Não deu para carregar: {mensagemErro(erro)}</p>;
  const unidade = (unidades.data ?? []).find((u) => u.id === id);
  if (!unidade)
    return (
      <p className="text-sm text-muted-foreground">
        Unidade não encontrada.{" "}
        <Link to="/contas-de-consumo" className="underline">
          Voltar para Contas de consumo
        </Link>
      </p>
    );

  const tipo = dadosDoTipo(String(unidade.tipo));
  const serie = serieDe12Meses(daUnidade, hoje);
  const variacao = variacaoContraAnterior(daUnidade);
  const falta = faturaEmFalta(unidade, lista, hoje);
  const banco = (bancos.data ?? []).find((b) => b.id === unidade.conta_bancaria_id);
  const mapaDeAnexos = anexos.data ?? new Map();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" className="h-11 px-2">
        <Link to="/contas-de-consumo">
          <ArrowLeft className="mr-1 h-4 w-4" /> Contas de consumo
        </Link>
      </Button>

      <SectionHeader
        title={nomeDaUnidade(unidade)}
        description={
          unidade.ativo
            ? undefined
            : "Unidade desativada: o histórico fica, não se lança fatura nova."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {podeLancarFatura && unidade.ativo && (
              <Button className="h-11" onClick={() => setDialogo({ tipo: "lancar", unidade })}>
                <FileText className="mr-1 h-4 w-4" /> Lançar fatura
              </Button>
            )}
            {podeCadastrarUnidade && (
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setDialogo({ tipo: "unidade", unidade })}
              >
                <Pencil className="mr-1 h-4 w-4" /> Editar unidade
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Fornecedor: </span>
            {unidade.fornecedores?.razao_social || unidade.fornecedores?.nome || "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Vence todo dia: </span>
            {unidade.dia_vencimento ?? "não definido"}
          </div>
          <div>
            <span className="text-muted-foreground">Costuma sair de: </span>
            {banco ? banco.nome : "não definido"}
          </div>
          <div className="break-words">
            <span className="text-muted-foreground">Endereço: </span>
            {unidade.endereco || "não informado"}
          </div>
          {unidade.observacoes && (
            <div className="break-words sm:col-span-2">
              <span className="text-muted-foreground">Observações: </span>
              {unidade.observacoes}
            </div>
          )}
        </CardContent>
      </Card>

      {falta && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Falta a fatura que vence em {dataBr(falta.vencimentoEsperado)} (competência provável{" "}
          {rotuloDaCompetencia(falta.competenciaProvavel)}).
        </p>
      )}

      <section aria-label="Variação contra o mês anterior" className="text-sm">
        {variacao ? (
          <p>
            <strong>{variacao.atual}</strong> contra <strong>{variacao.anterior}</strong>: valor{" "}
            <strong className="tabular-nums">{textoDaVariacao(variacao.valorPct)}</strong>
            {tipo.medida && (
              <>
                , consumo{" "}
                <strong className="tabular-nums">{textoDaVariacao(variacao.consumoPct)}</strong>
              </>
            )}
            .
          </p>
        ) : (
          <p className="text-muted-foreground">
            Variação contra o mês anterior aparece quando houver as faturas de dois meses seguidos.
          </p>
        )}
      </section>

      {/* Duas medidas de escala diferente: dois gráficos, um eixo cada (nunca eixo duplo). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoDoMes
          titulo="Valor por mês (R$)"
          serie={serie}
          chave="valor"
          formato={(n) => brl(n)}
        />
        {tipo.medida && (
          <GraficoDoMes
            titulo={`Consumo por mês (${tipo.medida})`}
            serie={serie}
            chave="consumo"
            formato={(n) => `${numeroBr(n)} ${tipo.medida}`}
          />
        )}
      </div>

      <section aria-label="Faturas da unidade">
        <h2 className="mb-2 text-base font-semibold">Faturas</h2>
        {daUnidade.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma fatura lançada.</p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    {tipo.medida && <TableHead className="text-right">Consumo</TableHead>}
                    <TableHead className="text-right">Taxas</TableHead>
                    {unidade.tipo === "energia" && (
                      <TableHead className="text-right">Ilum. pública</TableHead>
                    )}
                    <TableHead>Nota fiscal</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daUnidade.map((f) => {
                    const c = f.contas_pagar;
                    const arquivos = (mapaDeAnexos.get(f.conta_pagar_id) ?? []).length;
                    return (
                      <TableRow key={f.conta_pagar_id}>
                        <TableCell className="tabular-nums">
                          {rotuloDaCompetencia(f.competencia)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c ? brl(Number(c.valor)) : "—"}
                        </TableCell>
                        {tipo.medida && (
                          <TableCell className="text-right tabular-nums">
                            {f.consumo === null ? "—" : `${numeroBr(f.consumo)} ${tipo.medida}`}
                          </TableCell>
                        )}
                        <TableCell className="text-right tabular-nums">
                          {f.bandeira_taxas === null ? "—" : brl(Number(f.bandeira_taxas))}
                        </TableCell>
                        {unidade.tipo === "energia" && (
                          <TableCell className="text-right tabular-nums">
                            {f.iluminacao_publica === null
                              ? "—"
                              : brl(Number(f.iluminacao_publica))}
                          </TableCell>
                        )}
                        <TableCell>{f.numero_nf ?? "—"}</TableCell>
                        <TableCell>
                          <SituacaoDaFatura fatura={f} hoje={hoje} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1">
                            {c && c.status !== "paga" && c.status !== "cancelada" && podePagar && (
                              <Button
                                size="sm"
                                className="h-11"
                                onClick={() => setDialogo({ tipo: "pagar", fatura: f, unidade })}
                              >
                                Pagar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-11"
                              aria-label={`Anexos da fatura de ${rotuloDaCompetencia(f.competencia)}`}
                              onClick={() =>
                                setDialogo({ tipo: "anexos", fatura: f, aba: "anexos" })
                              }
                            >
                              <Paperclip className="mr-1 h-4 w-4" /> {arquivos}
                            </Button>
                            {podeCorrigirDados && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11"
                                onClick={() => setDialogo({ tipo: "corrigir", fatura: f, unidade })}
                              >
                                Corrigir dados
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <DialogosDeConsumo
        dialogo={dialogo}
        setDialogo={setDialogo}
        faturas={lista}
        anexos={mapaDeAnexos}
        hoje={hoje}
      />
    </div>
  );
}

/** Uma medida, uma série, um eixo; mês sem fatura fica vazio. A tabela abaixo é a visão em números. */
function GraficoDoMes({
  titulo,
  serie,
  chave,
  formato,
}: {
  titulo: string;
  serie: PontoDoMes[];
  chave: "valor" | "consumo";
  formato: (n: number) => string;
}) {
  const temDado = serie.some((p) => p[chave] !== null);
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
        {temDado ? (
          <figure aria-label={`${titulo}, últimos 12 meses`} className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="rotulo"
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  formatter={(v) => [formato(Number(v)), titulo.split(" (")[0]]}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    color: "var(--card-foreground)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey={chave} fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </figure>
        ) : (
          <p className="text-sm text-muted-foreground">Sem dado nos últimos 12 meses.</p>
        )}
      </CardContent>
    </Card>
  );
}
