/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image, Check, X, MessageSquare } from "lucide-react";
import { db, formatDateTime } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/design")({
  head: () => ({ meta: [{ title: "Design & Arte — BEX PRINT OS" }] }),
  component: DesignPage,
});

function DesignPage() {
  const qc = useQueryClient();
  const { data: artes = [] } = useQuery({
    queryKey: ["design-aprovacoes"],
    queryFn: async () => {
      const { data, error } = await db
        .from("arquivos")
        .select(
          "*, ordens_servico(numero, clientes(nome), usuarios!ordens_servico_designer_id_fkey(nome)), aprovacoes(aprovado, observacao)",
        )
        .eq("final_producao", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const createApproval = useMutation({
    mutationFn: async ({ arquivo, aprovado }: { arquivo: any; aprovado: boolean }) => {
      const { error } = await db.from("aprovacoes").insert({
        tipo: "arte",
        os_id: arquivo.os_id,
        arquivo_id: arquivo.id,
        aprovado,
        canal: "sistema",
        observacao: aprovado ? "Aprovado pela fila de design" : "Reprovado pela fila de design",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aprovação registrada");
      qc.invalidateQueries({ queryKey: ["design-aprovacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const concluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("arquivos").update({ final_producao: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["design-aprovacoes"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Design & Aprovação de Arte</h1>
        <p className="text-muted-foreground">
          Fila de artes aguardando aprovação interna ou do cliente
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {artes.map((a: any) => (
          <Card key={a.id}>
            <div className="aspect-video bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center border-b">
              <Image className="h-12 w-12 text-muted-foreground/40" />
            </div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {a.ordens_servico?.numero ? `OS-${a.ordens_servico.numero}` : a.nome}
                </CardTitle>
                <Badge variant="outline">v{a.versao}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {a.ordens_servico?.clientes?.nome || "Cliente não vinculado"}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <div>Designer: {a.ordens_servico?.usuarios?.nome || "—"}</div>
                <div>Enviada: {formatDateTime(a.created_at)}</div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => createApproval.mutate({ arquivo: a, aprovado: true })}
                >
                  <Check className="h-3 w-3 mr-1" /> Aprovar
                </Button>
                <Button size="sm" variant="outline" onClick={() => concluir.mutate(a.id)}>
                  <MessageSquare className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => createApproval.mutate({ arquivo: a, aprovado: false })}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {artes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhuma arte pendente
          </CardContent>
        </Card>
      )}
    </div>
  );
}
