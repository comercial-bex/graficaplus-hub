import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { automacoesMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/automacoes")({
  head: () => ({ meta: [{ title: "Automações — BEX PRINT OS" }] }),
  component: AutoPage,
});

function AutoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automações de WhatsApp</h1>
        <p className="text-muted-foreground">Mensagens disparadas automaticamente por mudança de status</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Gatilhos configurados</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {automacoesMock.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{a.gatilho}</Badge>
                  {a.ativo && <Badge className="bg-emerald-600 hover:bg-emerald-600">Ativa</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{a.mensagem}</p>
              </div>
              <Switch checked={a.ativo} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
