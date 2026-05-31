/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { db } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/respostas-rapidas")({
  head: () => ({ meta: [{ title: "Respostas rápidas — BEX PRINT OS" }] }),
  component: RespPage,
});

function RespPage() {
  const qc = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("Geral");
  const [texto, setTexto] = useState("");

  const { data: respostas = [] } = useQuery({
    queryKey: ["respostas-rapidas"],
    queryFn: async () => {
      const { data, error } = await db
        .from("respostas_rapidas")
        .select("*")
        .order("categoria")
        .order("titulo");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await db
        .from("respostas_rapidas")
        .insert({ titulo, categoria, texto, ativo: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resposta criada");
      setTitulo("");
      setTexto("");
      qc.invalidateQueries({ queryKey: ["respostas-rapidas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("respostas_rapidas").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["respostas-rapidas"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Respostas rápidas</h1>
          <p className="text-muted-foreground">Biblioteca de mensagens prontas para WhatsApp</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="h-4 w-4 inline mr-2" />
            Nova resposta
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-[180px_220px_1fr_auto]">
          <Input
            placeholder="Categoria"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          />
          <Input placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <Input placeholder="Texto" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <Button onClick={() => create.mutate()} disabled={!titulo || !texto || create.isPending}>
            Criar
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {respostas.map((r: any) => (
          <Card key={r.id} className={!r.ativo ? "opacity-60" : undefined}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{r.titulo}</CardTitle>
                <Badge variant="outline">{r.categoria}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{r.texto}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate({ id: r.id, changes: { texto: `${r.texto} ` } })}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  onClick={() => update.mutate({ id: r.id, changes: { ativo: false } })}
                >
                  Concluir
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
