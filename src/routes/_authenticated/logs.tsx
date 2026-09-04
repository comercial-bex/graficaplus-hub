import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { DicaIcone } from "@/components/bex/Dica";
import { dicaTela } from "@/lib/dicas";
export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs & Auditoria — BEX PRINT OS" }] }),
  component: LogsPage,
});

const logsMock = [
  { id: 1, data: "Hoje 14:32", usuario: "Bruno", acao: "Mudou status", entidade: "OS-1042", detalhe: "design → produção" },
  { id: 2, data: "Hoje 14:15", usuario: "Ana", acao: "Criou", entidade: "Orçamento #248", detalhe: "Cliente Padaria Aurora" },
  { id: 3, data: "Hoje 13:50", usuario: "Júlia", acao: "Aprovou arte", entidade: "OS-1041", detalhe: "versão v2" },
  { id: 4, data: "Hoje 12:20", usuario: "Carlos", acao: "Saída estoque", entidade: "Vinil branco", detalhe: "-12 m²" },
  { id: 5, data: "Hoje 11:00", usuario: "Admin", acao: "Criou usuário", entidade: "marcos@bex.com", detalhe: "role: vendedor" },
];

function LogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Logs & Auditoria</h1>
          <DicaIcone texto={dicaTela("/logs")} rotulo="Logs e Auditoria" lado="bottom" className="h-5 w-5" />
        </div>
        <p className="text-muted-foreground">Histórico de ações no sistema</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Últimas ações</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsMock.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm text-muted-foreground">{l.data}</TableCell>
                  <TableCell><Badge variant="outline">{l.usuario}</Badge></TableCell>
                  <TableCell>{l.acao}</TableCell>
                  <TableCell className="font-medium">{l.entidade}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.detalhe}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
