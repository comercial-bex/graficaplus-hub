import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { materiaisMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/materiais")({
  head: () => ({ meta: [{ title: "Materiais — BEX PRINT OS" }] }),
  component: MateriaisPage,
});

function MateriaisPage() {
  const criticos = materiaisMock.filter((m) => m.estoque < m.minimo);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Materiais & Estoque</h1>
          <p className="text-muted-foreground">Controle de matéria-prima e insumos</p>
        </div>
        {criticos.length > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> {criticos.length} crítico(s)
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle>Estoque</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Mínimo</TableHead>
                <TableHead className="text-right">Custo unit.</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materiaisMock.map((m) => {
                const critico = m.estoque < m.minimo;
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.nome}</TableCell>
                    <TableCell>{m.unidade}</TableCell>
                    <TableCell className="text-right">{m.estoque}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.minimo}</TableCell>
                    <TableCell className="text-right">R$ {m.custo.toFixed(2)}</TableCell>
                    <TableCell>
                      {critico
                        ? <Badge variant="destructive">Reposição</Badge>
                        : <Badge variant="outline">OK</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
