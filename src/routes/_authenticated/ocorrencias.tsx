import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ocorrenciasMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/ocorrencias")({
  head: () => ({ meta: [{ title: "Ocorrências — BEX PRINT OS" }] }),
  component: OcorrPage,
});

function OcorrPage() {
  const totalCusto = ocorrenciasMock.reduce((s, o) => s + o.custo, 0);
  const retrabalhos = ocorrenciasMock.filter((o) => o.retrabalho).length;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ocorrências & Retrabalho</h1>
        <p className="text-muted-foreground">Registro de problemas e custos gerados</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Ocorrências abertas</div><div className="text-2xl font-bold">{ocorrenciasMock.filter(o=>o.status==="aberta").length}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Retrabalhos</div><div className="text-2xl font-bold">{retrabalhos}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Custo gerado</div><div className="text-2xl font-bold text-rose-600">R$ {totalCusto.toFixed(2)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Lista de ocorrências</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead>Retrabalho?</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ocorrenciasMock.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.os}</TableCell>
                  <TableCell>{o.tipo}</TableCell>
                  <TableCell>{o.setor}</TableCell>
                  <TableCell className="text-right">R$ {o.custo.toFixed(2)}</TableCell>
                  <TableCell>{o.retrabalho ? "Sim" : "Não"}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "aberta" ? "destructive" : "outline"}>{o.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
