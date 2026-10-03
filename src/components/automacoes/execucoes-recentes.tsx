/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusChip } from "@/components/bex/StatusChip";
import { formatDateTime } from "@/lib/module-data";
import { mensagemErro } from "@/lib/erros";
import { infoDoGatilho } from "@/domain/automacoes/catalogo";
import { situacaoDaExecucao } from "@/domain/automacoes/execucoes";

type Execucao = {
  id: string;
  gatilho: string;
  status: string;
  entidade: string;
  entidade_id: string | null;
  erro: string | null;
  scheduled_at: string | null;
  processado_em: string | null;
  created_at: string;
  automacoes: { nome: string } | null;
  os_numero: string | null;
  material_nome: string | null;
};

/**
 * As últimas execuções da fila.
 *
 * Do contexto gravado só saem DOIS campos, escolhidos no select: o número da
 * OS e o nome do material. O contexto guarda a linha inteira da OS — valor,
 * custo e margem — e o navegador não precisa disso para dizer "OS 49".
 */
export function ExecucoesRecentes() {
  const lista = useQuery({
    queryKey: ["automacao_execucoes"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("automacao_execucoes")
        .select(
          "id, gatilho, status, entidade, entidade_id, erro, scheduled_at, processado_em, created_at, automacoes(nome), os_numero:contexto->os->>numero, material_nome:contexto->material->>nome",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Execucao[];
    },
  });

  const agora = new Date();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Últimas execuções</CardTitle>
      </CardHeader>
      <CardContent>
        {lista.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Não foi possível carregar as execuções</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{mensagemErro(lista.error)}</p>
              <p>Isto é uma falha de consulta, não uma lista vazia.</p>
              <Button variant="outline" size="sm" onClick={() => void lista.refetch()}>
                Tentar de novo
              </Button>
            </AlertDescription>
          </Alert>
        ) : lista.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando execuções…</p>
        ) : lista.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma execução ainda. Cada vez que uma automação ligada dispara, a mensagem entra aqui
            — na fila, enviada, cancelada ou com o motivo da falha.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Automação</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Sobre</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.map((e) => {
                  const s = situacaoDaExecucao(e, agora);
                  const agendada = s.rotulo === "Agendada" && e.scheduled_at;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(e.processado_em ?? e.created_at)}
                      </TableCell>
                      <TableCell>{e.automacoes?.nome ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {infoDoGatilho(e.gatilho)?.rotulo ?? e.gatilho}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Sobre execucao={e} />
                      </TableCell>
                      <TableCell>
                        <StatusChip label={s.rotulo} tone={s.tom} />
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {agendada
                          ? `sai depois de ${formatDateTime(e.scheduled_at)}`
                          : (s.detalhe ?? "—")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sobre({ execucao: e }: { execucao: Execucao }) {
  if (e.entidade === "materiais") return <>{e.material_nome ?? "material"}</>;
  const texto = e.os_numero ? `OS ${e.os_numero}` : "OS";
  if (e.entidade === "ordens_servico" && e.entidade_id) {
    return (
      <Link to="/os/$id" params={{ id: e.entidade_id }} className="text-primary hover:underline">
        {texto}
      </Link>
    );
  }
  if (e.entidade === "pagamentos") return <>{`Parcela da ${texto}`}</>;
  return <>{e.entidade}</>;
}
