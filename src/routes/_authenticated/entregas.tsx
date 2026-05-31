import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Truck, MapPin } from "lucide-react";
import { entregasMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/entregas")({
  head: () => ({ meta: [{ title: "Entregas & Instalações — BEX PRINT OS" }] }),
  component: EntregasPage,
});

const statusVar: Record<string, any> = {
  agendado: "secondary", em_rota: "default", concluido: "outline",
};

function EntregasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Entregas & Instalações</h1>
        <p className="text-muted-foreground">Agenda logística de pedidos</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {entregasMock.map((e) => (
          <Card key={e.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Truck className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{e.os} · {e.cliente}</CardTitle>
                    <div className="text-xs text-muted-foreground capitalize">{e.tipo}</div>
                  </div>
                </div>
                <Badge variant={statusVar[e.status]}>{e.status.replace("_", " ")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{e.endereco}</span>
              </div>
              <div className="text-sm font-medium">{e.data}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
