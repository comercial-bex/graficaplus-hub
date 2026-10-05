import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { currency, formatDate } from "@/lib/module-data";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/manutencao")({
  head: () => ({ meta: [{ title: "Manutenção — BEX PRINT OS" }] }),
  component: ManutPage,
});

const statusVar: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  agendada: "secondary",
  em_andamento: "default",
  concluida: "outline",
  cancelada: "destructive",
};

/**
 * Colunas que a tela lê de `manutencoes`.
 *
 * Esta tela foi escrita para uma tabela que não existe mais: ordenava por
 * `data_prevista` e gravava `maquina_nome`, colunas que o banco não tem
 * (42703), e não mandava `maquina_id` nem `titulo`, que são obrigatórios. A
 * lista nunca carregou e o "Criar" nunca gravou — a tabela tinha 0 linhas.
 * Agora usa o cliente tipado, e o insert com coluna que não existe em
 * `types.ts` não compila. O texto do select e o order o TypeScript não
 * confere: quem confere é tests/manutencao-colunas-reais.test.ts.
 */
const COLUNAS_DA_LISTA =
  "id, maquina_id, tipo, titulo, status, data_programada, data_conclusao, custo_previsto, maquinas(nome)";

/**
 * A data escolhida no calendário, como instante.
 *
 * `data_programada` é timestamptz. Gravar "2026-10-10" puro vira meia-noite
 * em UTC, que em Belém é 21h do dia 9 — a tela mostraria um dia antes. Meio-dia
 * local não escorrega de dia em fuso nenhum do Brasil.
 */
function dataComoInstante(dia: string): string | null {
  return dia ? new Date(`${dia}T12:00:00`).toISOString() : null;
}

function ManutPage() {
  const qc = useQueryClient();
  const [maquinaId, setMaquinaId] = useState("");
  const [tipo, setTipo] = useState("preventiva");
  const [titulo, setTitulo] = useState("");
  const [dataProgramada, setDataProgramada] = useState("");

  const maquinas = useQuery({
    queryKey: ["manutencao-maquinas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maquinas")
        .select("id, nome, ativa")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const lista = useQuery({
    queryKey: ["manutencoes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manutencoes")
        .select(COLUNAS_DA_LISTA)
        .order("data_programada", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const manutencoes = lista.data ?? [];

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("manutencoes").insert({
        maquina_id: maquinaId,
        tipo,
        titulo: titulo.trim(),
        data_programada: dataComoInstante(dataProgramada),
        status: "agendada",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Manutenção criada");
      setMaquinaId("");
      setTipo("preventiva");
      setTitulo("");
      setDataProgramada("");
      qc.invalidateQueries({ queryKey: ["manutencoes"] });
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      changes: { status: string; data_inicio?: string; data_conclusao?: string };
    }) => {
      const { error } = await supabase.from("manutencoes").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manutencoes"] }),
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Manutenção</h1>
          <DicaIcone texto={dicaTela("/manutencao")} rotulo="Manutenção" lado="bottom" className="h-5 w-5" />
        </div>
        <p className="text-muted-foreground">Manutenções preventivas e corretivas de máquinas</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nova manutenção</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-2 md:grid-cols-[1fr_160px_1fr_180px_auto]">
            <Select value={maquinaId} onValueChange={setMaquinaId} disabled={maquinas.isError}>
              <SelectTrigger aria-label="Máquina">
                <SelectValue placeholder={maquinas.isPending ? "Carregando máquinas..." : "Máquina"} />
              </SelectTrigger>
              <SelectContent>
                {(maquinas.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nome}
                    {m.ativa === false ? " (inativa)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger aria-label="Tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preventiva">Preventiva</SelectItem>
                <SelectItem value="corretiva">Corretiva</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="O que fazer (ex.: troca do bico)"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
            <Input
              type="date"
              aria-label="Data programada"
              value={dataProgramada}
              onChange={(e) => setDataProgramada(e.target.value)}
            />
            <Button
              onClick={() => create.mutate()}
              disabled={!maquinaId || !titulo.trim() || create.isPending}
            >
              Criar
            </Button>
          </div>
          {maquinas.isError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar as máquinas: {mensagemErro(maquinas.error)}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Próximas manutenções</CardTitle>
        </CardHeader>
        <CardContent>
          {lista.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar as manutenções</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{mensagemErro(lista.error)}</p>
                <p>Isto é uma falha de consulta, não uma lista vazia.</p>
                <Button variant="outline" size="sm" disabled={lista.isFetching} onClick={() => void lista.refetch()}>
                  {lista.isFetching ? "Tentando..." : "Tentar de novo"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : lista.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando manutenções...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Máquina</TableHead>
                  <TableHead>O que fazer</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Data programada</TableHead>
                  <TableHead>Custo previsto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manutencoes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Nenhuma manutenção registrada
                    </TableCell>
                  </TableRow>
                )}
                {manutencoes.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.maquinas?.nome ?? "—"}</TableCell>
                    <TableCell>{m.titulo}</TableCell>
                    <TableCell className="capitalize">{m.tipo}</TableCell>
                    <TableCell>{formatDate(m.data_programada)}</TableCell>
                    {/* custo_previsto nasce 0 (default) e o formulário não pede
                        custo: zero aqui é "ninguém informou", não "de graça". */}
                    <TableCell>{Number(m.custo_previsto) > 0 ? currency(m.custo_previsto) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVar[m.status] ?? "outline"}>{m.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      {m.status === "agendada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({
                              id: m.id,
                              changes: { status: "em_andamento", data_inicio: new Date().toISOString() },
                            })
                          }
                        >
                          Iniciar
                        </Button>
                      )}
                      {m.status !== "concluida" && m.status !== "cancelada" && (
                        <Button
                          size="sm"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({
                              id: m.id,
                              // Instante completo: a data sozinha ("aaaa-mm-dd"
                              // de toISOString) é o dia em UTC e, gravada num
                              // timestamptz, voltava como o dia anterior.
                              changes: { status: "concluida", data_conclusao: new Date().toISOString() },
                            })
                          }
                        >
                          Concluir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
