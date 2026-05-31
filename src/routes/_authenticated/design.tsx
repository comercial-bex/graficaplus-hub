import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image, Check, X, MessageSquare } from "lucide-react";
import { artesPendentesMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/design")({
  head: () => ({ meta: [{ title: "Design & Arte — BEX PRINT OS" }] }),
  component: DesignPage,
});

function DesignPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Design & Aprovação de Arte</h1>
        <p className="text-muted-foreground">Fila de artes aguardando aprovação interna ou do cliente</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {artesPendentesMock.map((a) => (
          <Card key={a.id}>
            <div className="aspect-video bg-gradient-to-br from-violet-500/20 to-blue-500/20 flex items-center justify-center border-b">
              <Image className="h-12 w-12 text-muted-foreground/40" />
            </div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{a.os}</CardTitle>
                <Badge variant="outline">v{a.versao}</Badge>
              </div>
              <div className="text-sm text-muted-foreground">{a.cliente}</div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <div>Designer: {a.designer}</div>
                <div>Enviada: {a.enviadaEm}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1"><Check className="h-3 w-3 mr-1" /> Aprovar</Button>
                <Button size="sm" variant="outline"><MessageSquare className="h-3 w-3" /></Button>
                <Button size="sm" variant="outline"><X className="h-3 w-3" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
