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
import { currency, db, formatDate } from "@/lib/module-data";
import { toast } from "sonner";

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

function ManutPage() {
  const qc = useQueryClient();
  const [maquinaNome, setMaquinaNome] = useState("");
  const [tipo, setTipo] = useState("");
  const [dataPrevista, setDataPrevista] = useState("");

  const { data: manutencoes = [] } = useQuery({
    queryKey: ["manutencoes"],
    queryFn: async () => {
      const { data, error } = await db
        .from("manutencoes")
        .select("*")
        .order("data_prevista", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("manutencoes").insert({
        maquina_nome: maquinaNome,
        tipo,
        data_prevista: dataPrevista || null,
        status: "agendada",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Manutenção criada");
      setMaquinaNome("");
      setTipo("");
      setDataPrevista("");
      qc.invalidateQueries({ queryKey: ["manutencoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("manutencoes").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manutencoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manutenção</h1>
        <p className="text-muted-foreground">Manutenções preventivas e corretivas de máquinas</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nova manutenção</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[1fr_1fr_180px_auto]">
          <Input
            placeholder="Máquina"
            value={maquinaNome}
            onChange={(e) => setMaquinaNome(e.target.value)}
          />
          <Input placeholder="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} />
          <Input
            type="date"
            value={dataPrevista}
            onChange={(e) => setDataPrevista(e.target.value)}
          />
          <Button onClick={() => create.mutate()} disabled={!maquinaNome || !tipo}>
            Criar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Próximas manutenções</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máquina</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Custo estimado</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manutencoes.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.maquina_nome || "—"}</TableCell>
                  <TableCell>{m.tipo}</TableCell>
                  <TableCell>{formatDate(m.data_prevista)}</TableCell>
                  <TableCell>{currency(m.custo)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVar[m.status] ?? "outline"}>{m.status}</Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        update.mutate({ id: m.id, changes: { status: "em_andamento" } })
                      }
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          id: m.id,
                          changes: {
                            status: "concluida",
                            data_conclusao: new Date().toISOString().slice(0, 10),
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
