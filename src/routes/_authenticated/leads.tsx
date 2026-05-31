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
import { db } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads — BEX PRINT OS" }] }),
  component: LeadsPage,
});

const statusLabel: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  novo: { label: "Novo", variant: "secondary" },
  em_atendimento: { label: "Em atendimento", variant: "default" },
  orcamento: { label: "Orçamento", variant: "default" },
  ganho: { label: "Ganho", variant: "default" },
  perdido: { label: "Perdido", variant: "destructive" },
};

const funilMeta = [
  { key: "novo", etapa: "Novos", cor: "bg-blue-500" },
  { key: "em_atendimento", etapa: "Em atendimento", cor: "bg-amber-500" },
  { key: "orcamento", etapa: "Orçamento", cor: "bg-violet-500" },
  { key: "ganho", etapa: "Ganhos", cor: "bg-emerald-500" },
  { key: "perdido", etapa: "Perdidos", cor: "bg-rose-500" },
];

function LeadsPage() {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [interesse, setInteresse] = useState("");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await db
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("leads")
        .insert({ nome, interesse, origem: "Manual", status: "novo" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead criado");
      setNome("");
      setInteresse("");
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const payload: Record<string, unknown> = { status };
      if (["ganho", "perdido"].includes(status)) payload.concluido_em = new Date().toISOString();
      const { error } = await db.from("leads").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Funil de oportunidades comerciais conectado ao Supabase
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {funilMeta.map((f) => (
          <Card key={f.key}>
            <CardContent className="p-4">
              <div className={`${f.cor} h-1 w-12 rounded mb-2`} />
              <div className="text-2xl font-bold">
                {leads.filter((l: any) => l.status === f.key).length}
              </div>
              <div className="text-xs text-muted-foreground">{f.etapa}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo lead</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Input
            placeholder="Interesse"
            value={interesse}
            onChange={(e) => setInteresse(e.target.value)}
          />
          <Button onClick={() => create.mutate()} disabled={!nome || create.isPending}>
            Criar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leads recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground">Carregando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Interesse</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.nome}</TableCell>
                    <TableCell>{l.origem || "—"}</TableCell>
                    <TableCell>{l.interesse || "—"}</TableCell>
                    <TableCell>{l.responsavel || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusLabel[l.status]?.variant ?? "outline"}>
                        {statusLabel[l.status]?.label ?? l.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus.mutate({ id: l.id, status: "orcamento" })}
                      >
                        Editar estágio
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => updateStatus.mutate({ id: l.id, status: "ganho" })}
                      >
                        Concluir
                      </Button>
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
