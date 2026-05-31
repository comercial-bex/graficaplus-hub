import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { respostasRapidasMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/respostas-rapidas")({
  head: () => ({ meta: [{ title: "Respostas rápidas — BEX PRINT OS" }] }),
  component: RespPage,
});

function RespPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Respostas rápidas</h1>
          <p className="text-muted-foreground">Biblioteca de mensagens prontas para WhatsApp</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" /> Nova resposta</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {respostasRapidasMock.map((r) => (
          <Card key={r.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{r.titulo}</CardTitle>
                <Badge variant="outline">{r.categoria}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{r.texto}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
