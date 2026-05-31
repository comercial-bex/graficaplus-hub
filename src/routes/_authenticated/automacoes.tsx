/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SupabaseError = { message: string };
type QueryResult<T> = { data: T | null; error: SupabaseError | null };
type SupabaseQuery<T> = PromiseLike<QueryResult<T>> & {
  order: (column: string, options?: { ascending?: boolean }) => SupabaseQuery<T>;
  limit: (count: number) => SupabaseQuery<T>;
};
type SupabaseUpdate = {
  eq: (
    column: string,
    value: string | boolean | number,
  ) => PromiseLike<{ error: SupabaseError | null }>;
};
type UntypedSupabase = {
  from: (table: string) => {
    select: <T>(columns?: string) => SupabaseQuery<T>;
    update: (values: Record<string, unknown>) => SupabaseUpdate;
  };
};

const automationsDb = supabase as unknown as UntypedSupabase;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — BEX PRINT OS" }] }),
  component: AutoPage,
});

const gatilhoLabels: Record<string, string> = {
  status_os_alterado: "Mudança de status da OS",
  pagamento_atrasado: "Pagamento atrasado",
  estoque_minimo: "Estoque mínimo",
  margem_abaixo_minimo: "Margem abaixo do mínimo",
  os_atrasada: "OS atrasada",
  os_concluida: "Conclusão da OS",
};

type Automacao = {
  id: string;
  nome: string;
  gatilho: string;
  condicao: Record<string, unknown>;
  acao: string;
  payload: Record<string, unknown>;
  ativo: boolean;
  delay_segundos: number;
  cooldown_segundos: number;
};

type Execucao = {
  id: string;
  gatilho: string;
  status: string;
  entidade: string;
  erro: string | null;
  processado_em: string | null;
  created_at: string;
  automacoes?: { nome: string } | null;
};

function AutoPage() {
  const qc = useQueryClient();

  const { data: automacoes = [], isLoading } = useQuery({
    queryKey: ["automacoes"],
    queryFn: async () => {
      const { data, error } = await automationsDb
        .from("automacoes")
        .select("*")
        .order("gatilho")
        .order("created_at");
      if (error) throw error;
      return data as Automacao[];
    },
  });

  const { data: execucoes = [] } = useQuery({
    queryKey: ["automacao_execucoes"],
    queryFn: async () => {
      const { data, error } = await automationsDb
        .from("automacao_execucoes")
        .select("id,gatilho,status,entidade,erro,processado_em,created_at,automacoes(nome)")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Execucao[];
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await automationsDb.from("automacoes").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automacoes"] });
      toast.success("Automação atualizada");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automações de WhatsApp</h1>
        <p className="text-muted-foreground">
          Regras reais processadas por fila e disparadas via Z-API
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gatilhos configurados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando automações...</div>
          ) : automacoes.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma automação cadastrada</div>
          ) : (
            automacoes.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline">{gatilhoLabels[a.gatilho] ?? a.gatilho}</Badge>
                    <Badge variant="secondary">{a.acao}</Badge>
                    {a.delay_segundos > 0 && (
                      <Badge variant="outline">Delay {a.delay_segundos}s</Badge>
                    )}
                    {a.ativo && (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativa</Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{a.nome}</p>
                  <p className="text-sm text-muted-foreground">
                    {String(a.payload?.mensagem ?? "Sem mensagem configurada")}
                  </p>
                </div>
                <Switch
                  checked={a.ativo}
                  onCheckedChange={(ativo) => toggle.mutate({ id: a.id, ativo })}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas execuções</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Automação</TableHead>
                <TableHead>Gatilho</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {execucoes.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(e.processado_em ?? e.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell>{e.automacoes?.nome ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{gatilhoLabels[e.gatilho] ?? e.gatilho}</Badge>
                  </TableCell>
                  <TableCell>{e.entidade}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.status === "sucesso"
                          ? "default"
                          : e.status === "erro"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {e.erro ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {execucoes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhuma execução registrada
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
