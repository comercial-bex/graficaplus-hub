import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Factory } from "lucide-react";
import { maquinas } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/maquinas")({
  head: () => ({ meta: [{ title: "Máquinas — BEX PRINT OS" }] }),
  component: MaquinasPage,
});

const statusMap: Record<string, { label: string; variant: any }> = {
  em_uso: { label: "Em uso", variant: "default" },
  parada: { label: "Parada", variant: "secondary" },
  manutencao: { label: "Manutenção", variant: "destructive" },
};

function MaquinasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Máquinas</h1>
        <p className="text-muted-foreground">Capacidade produtiva e ocupação em tempo real</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {maquinas.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Factory className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{m.nome}</CardTitle>
                    <div className="text-xs text-muted-foreground">{m.tipo}</div>
                  </div>
                </div>
                <Badge variant={statusMap[m.status].variant}>{statusMap[m.status].label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Operador</span>
                <span>{m.operador}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Custo/hora</span>
                <span className="font-medium">R$ {m.custoHora.toFixed(2)}</span>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Ocupação semanal</span>
                  <span>{m.ocupacao}%</span>
                </div>
                <Progress value={m.ocupacao} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
