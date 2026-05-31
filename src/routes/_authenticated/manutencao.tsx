import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { manutencoesMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/manutencao")({
  head: () => ({ meta: [{ title: "Manutenção — BEX PRINT OS" }] }),
  component: ManutPage,
});

const statusVar: Record<string, any> = {
  agendada: "secondary",
  em_andamento: "default",
  concluida: "outline",
};

function ManutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manutenção</h1>
        <p className="text-muted-foreground">Manutenções preventivas e corretivas de máquinas</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Próximas manutenções</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Máquina</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Custo estimado</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {manutencoesMock.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.maquina}</TableCell>
                  <TableCell>{m.tipo}</TableCell>
                  <TableCell>{m.dataPrevista}</TableCell>
                  <TableCell>R$ {m.custo.toFixed(2)}</TableCell>
                  <TableCell><Badge variant={statusVar[m.status]}>{m.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
