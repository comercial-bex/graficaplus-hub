/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { db, formatDateTime } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maquinas-agenda")({
  head: () => ({ meta: [{ title: "Agenda de máquinas — BEX PRINT OS" }] }),
  component: AgendaPage,
});

function AgendaPage() {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas"],
    queryFn: async () => {
      const { data, error } = await db.from("maquinas").select("*").eq("ativa", true).order("nome");
      if (error) throw error;
      return data;
    },
  });
  const { data: agenda = [] } = useQuery({
    queryKey: ["maquinas-agenda"],
    queryFn: async () => {
      const { data, error } = await db
        .from("maquinas_agenda")
        .select("*, maquinas(nome)")
        .order("inicio");
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const maquina = maquinas[0];
      const now = new Date();
      const fim = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const { error } = await db.from("maquinas_agenda").insert({
        maquina_id: maquina.id,
        titulo,
        inicio: now.toISOString(),
        fim: fim.toISOString(),
        status: "agendado",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agenda criada");
      setTitulo("");
      qc.invalidateQueries({ queryKey: ["maquinas-agenda"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("maquinas_agenda").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maquinas-agenda"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agenda de máquinas</h1>
        <p className="text-muted-foreground">
          Ocupação por equipamento com dados reais do Supabase
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Novo bloqueio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="Título / OS"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
          <Button onClick={() => create.mutate()} disabled={!titulo || maquinas.length === 0}>
            Criar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agenda atual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {maquinas.map((m: any) => (
            <div key={m.id} className="rounded-lg border p-3">
              <div className="font-medium mb-2">{m.nome}</div>
              <div className="grid gap-2 md:grid-cols-2">
                {agenda
                  .filter((a: any) => a.maquina_id === m.id)
                  .map((a: any) => (
                    <div
                      key={a.id}
                      className="rounded bg-muted p-2 text-sm flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-medium">{a.titulo}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(a.inicio)} → {formatDateTime(a.fim)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{a.status}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            update.mutate({ id: a.id, changes: { status: "em_producao" } })
                          }
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            update.mutate({ id: a.id, changes: { status: "concluido" } })
                          }
                        >
                          Concluir
                        </Button>
                      </div>
                    </div>
                  ))}
                {agenda.filter((a: any) => a.maquina_id === m.id).length === 0 && (
                  <div className="text-sm text-muted-foreground">Sem agendamentos</div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
