import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/arquivos")({
  component: () => (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
        <p className="text-muted-foreground">Gestão de arquivos por OS</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Em construção</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Upload, versionamento e marcação de arquivo final estão sendo configurados. Bucket de storage já criado.
        </CardContent>
      </Card>
    </div>
  ),
});
