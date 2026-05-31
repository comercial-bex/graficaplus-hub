import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { leadsMock } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads — BEX PRINT OS" }] }),
  component: LeadsPage,
});

const funil = [
  { etapa: "Novos", qtd: 24, cor: "bg-blue-500" },
  { etapa: "Em atendimento", qtd: 18, cor: "bg-amber-500" },
  { etapa: "Orçamento", qtd: 12, cor: "bg-violet-500" },
  { etapa: "Ganhos", qtd: 8, cor: "bg-emerald-500" },
  { etapa: "Perdidos", qtd: 5, cor: "bg-rose-500" },
];

const statusLabel: Record<string, { label: string; variant: any }> = {
  novo: { label: "Novo", variant: "secondary" },
  em_atendimento: { label: "Em atendimento", variant: "default" },
  orcamento: { label: "Orçamento", variant: "default" },
  ganho: { label: "Ganho", variant: "default" },
  perdido: { label: "Perdido", variant: "destructive" },
};

function LeadsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">Funil de oportunidades comerciais</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {funil.map((f) => (
          <Card key={f.etapa}>
            <CardContent className="p-4">
              <div className={`h-1 w-12 rounded ${f.cor} mb-2`} />
              <div className="text-2xl font-bold">{f.qtd}</div>
              <div className="text-xs text-muted-foreground">{f.etapa}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Leads recentes</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Interesse</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leadsMock.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.nome}</TableCell>
                  <TableCell>{l.origem}</TableCell>
                  <TableCell>{l.interesse}</TableCell>
                  <TableCell>{l.responsavel}</TableCell>
                  <TableCell>
                    <Badge variant={statusLabel[l.status].variant}>{statusLabel[l.status].label}</Badge>
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
