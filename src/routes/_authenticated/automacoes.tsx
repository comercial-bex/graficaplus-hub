/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — BEX PRINT OS" }] }),
  component: AutoPage,
});

function AutoPage() {
  const qc = useQueryClient();
  const [gatilho, setGatilho] = useState("");
  const [mensagem, setMensagem] = useState("");

  const { data: automacoes = [], isLoading } = useQuery({
    queryKey: ["automacoes"],
    queryFn: async () => {
      const { data, error } = await db
        .from("automacoes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("automacoes").insert({ gatilho, mensagem, ativo: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Automação criada");
      setGatilho("");
      setMensagem("");
      qc.invalidateQueries({ queryKey: ["automacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("automacoes").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automações de WhatsApp</h1>
        <p className="text-muted-foreground">
          Mensagens disparadas automaticamente por mudança de status
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nova automação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
          <Input
            placeholder="Gatilho"
            value={gatilho}
            onChange={(e) => setGatilho(e.target.value)}
          />
          <Input
            placeholder="Mensagem"
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
          />
          <Button
            onClick={() => create.mutate()}
            disabled={!gatilho || !mensagem || create.isPending}
          >
            Criar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gatilhos configurados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && <div className="text-muted-foreground">Carregando...</div>}
          {automacoes.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center justify-between p-3 rounded-lg border gap-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{a.gatilho}</Badge>
                  {a.ativo && <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativa</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{a.mensagem}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update.mutate({ id: a.id, changes: { mensagem: `${a.mensagem} ` } })}
              >
                Editar
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  update.mutate({
                    id: a.id,
                    changes: { ultima_execucao_em: new Date().toISOString() },
                  })
                }
              >
                Concluir
              </Button>
              <Switch
                checked={a.ativo}
                onCheckedChange={(ativo) => update.mutate({ id: a.id, changes: { ativo } })}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
