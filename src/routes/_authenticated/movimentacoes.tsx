import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/movimentacoes")({
  head: () => ({ meta: [{ title: "Movimentações de estoque — BEX PRINT OS" }] }),
  component: MovPage,
});

const movMock = [
  { id: 1, data: "Hoje 14:20", material: "Vinil branco brilho", tipo: "saida", qtd: -12, os: "OS-1042", usuario: "Carlos M." },
  { id: 2, data: "Hoje 11:05", material: "Lona 440g", tipo: "entrada", qtd: 50, os: "—", usuario: "Estoque" },
  { id: 3, data: "Ontem 16:30", material: "Filamento PLA preto", tipo: "saida", qtd: -2.5, os: "OS-1043", usuario: "Renata S." },
  { id: 4, data: "Ontem 10:15", material: "ACM 3mm branco", tipo: "perda", qtd: -2, os: "OS-1037", usuario: "André L." },
  { id: 5, data: "27/05 09:00", material: "Tinta eco-solvente CMYK", tipo: "entrada", qtd: 4, os: "—", usuario: "Estoque" },
];

const tipoVar: Record<string, any> = { entrada: "default", saida: "secondary", perda: "destructive" };

function MovPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Movimentações de estoque</h1>
        <p className="text-muted-foreground">Histórico de entradas, saídas e perdas</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Usuário</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movMock.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm text-muted-foreground">{m.data}</TableCell>
                  <TableCell className="font-medium">{m.material}</TableCell>
                  <TableCell><Badge variant={tipoVar[m.tipo]}>{m.tipo}</Badge></TableCell>
                  <TableCell className={`text-right font-medium ${m.qtd < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {m.qtd > 0 ? "+" : ""}{m.qtd}
                  </TableCell>
                  <TableCell>{m.os}</TableCell>
                  <TableCell className="text-sm">{m.usuario}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
