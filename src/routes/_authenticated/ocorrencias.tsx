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
import { currency, db } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ocorrencias")({
  head: () => ({ meta: [{ title: "Ocorrências — BEX PRINT OS" }] }),
  component: OcorrPage,
});

function OcorrPage() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("");
  const [setor, setSetor] = useState("");
  const [descricao, setDescricao] = useState("");
  const { data: ocorrencias = [] } = useQuery({
    queryKey: ["ocorrencias"],
    queryFn: async () => {
      const { data, error } = await db
        .from("ocorrencias")
        .select("*, ordens_servico(numero)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const totalCusto = ocorrencias.reduce((s: number, o: any) => s + Number(o.custo ?? 0), 0);
  const retrabalhos = ocorrencias.filter((o: any) => o.retrabalho).length;
  const create = useMutation({
    mutationFn: async () => {
      const { data: os } = await db.from("ordens_servico").select("id").limit(1).maybeSingle();
      const { error } = await db
        .from("ocorrencias")
        .insert({ os_id: os?.id, tipo, setor, descricao: descricao || tipo, retrabalho: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ocorrência criada");
      setTipo("");
      setSetor("");
      setDescricao("");
      qc.invalidateQueries({ queryKey: ["ocorrencias"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("ocorrencias").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocorrencias"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ocorrências & Retrabalho</h1>
        <p className="text-muted-foreground">Registro de problemas e custos gerados</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Ocorrências abertas</div>
            <div className="text-2xl font-bold">
              {ocorrencias.filter((o: any) => !o.resolvida).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Retrabalhos</div>
            <div className="text-2xl font-bold">{retrabalhos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Custo gerado</div>
            <div className="text-2xl font-bold text-rose-600">{currency(totalCusto)}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nova ocorrência</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} />
          <Input placeholder="Setor" value={setor} onChange={(e) => setSetor(e.target.value)} />
          <Input
            placeholder="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
          <Button onClick={() => create.mutate()} disabled={!tipo}>
            Criar
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lista de ocorrências</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead>Retrabalho?</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocorrencias.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.ordens_servico?.numero ? `OS-${o.ordens_servico.numero}` : "—"}
                  </TableCell>
                  <TableCell>{o.tipo}</TableCell>
                  <TableCell>{o.setor || "—"}</TableCell>
                  <TableCell className="text-right">{currency(o.custo)}</TableCell>
                  <TableCell>{o.retrabalho ? "Sim" : "Não"}</TableCell>
                  <TableCell>
                    <Badge variant={!o.resolvida ? "destructive" : "outline"}>
                      {o.resolvida ? "resolvida" : "aberta"}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        update.mutate({ id: o.id, changes: { retrabalho: !o.retrabalho } })
                      }
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          id: o.id,
                          changes: { resolvida: true, resolvida_em: new Date().toISOString() },
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
