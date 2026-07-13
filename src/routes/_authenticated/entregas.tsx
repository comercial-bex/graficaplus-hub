/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db, formatDateTime } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/entregas")({
  head: () => ({ meta: [{ title: "Entregas — BEX PRINT OS" }] }),
  component: EntregasPage,
});

function EntregasPage() {
  const qc = useQueryClient();
  const [endereco, setEndereco] = useState("");
  const [tipo, setTipo] = useState("entrega");
  const { data: entregas = [] } = useQuery({
    queryKey: ["entregas-instalacoes"],
    queryFn: async () => {
      const { data, error } = await db
        .from("entregas_instalacoes")
        .select("*, ordens_servico(numero, titulo, clientes(nome))")
        .order("data_agendada", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { data: os } = await db.from("ordens_servico_operacional").select("id").limit(1).maybeSingle();
      const { error } = await db.from("entregas_instalacoes").insert({
        os_id: os?.id,
        tipo,
        endereco,
        data_agendada: new Date().toISOString(),
        status: "agendada",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entrega criada");
      setEndereco("");
      qc.invalidateQueries({ queryKey: ["entregas-instalacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("entregas_instalacoes").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entregas-instalacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Entregas & Instalações</h1>
        <p className="text-muted-foreground">
          Agenda logística de entregas, retiradas e instalações
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nova entrega/instalação</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
          <Input placeholder="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} />
          <Input
            placeholder="Endereço"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
          />
          <Button onClick={() => create.mutate()} disabled={!endereco}>
            Criar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agenda</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Endereço</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entregas.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    {e.ordens_servico?.numero ? `OS-${e.ordens_servico.numero}` : "—"}
                  </TableCell>
                  <TableCell>{e.ordens_servico?.clientes?.nome || "—"}</TableCell>
                  <TableCell>{e.tipo}</TableCell>
                  <TableCell>{e.endereco || "—"}</TableCell>
                  <TableCell>{formatDateTime(e.data_agendada)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.status === "concluido"
                          ? "outline"
                          : e.status === "em_rota"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => update.mutate({ id: e.id, changes: { status: "em_rota" } })}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          id: e.id,
                          changes: {
                            status: "concluido",
                            data_realizada: new Date().toISOString(),
                          },
                        })
                      }
                    >
                      Concluir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
