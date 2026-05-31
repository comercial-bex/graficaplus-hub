import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { produtosMock } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/produtos")({
  head: () => ({ meta: [{ title: "Produtos — BEX PRINT OS" }] }),
  component: ProdutosPage,
});

function ProdutosPage() {
  const { canSeeFinancials } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Produtos & Serviços</h1>
        <p className="text-muted-foreground">Catálogo de produtos com precificação</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Catálogo</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Preço público</TableHead>
                {canSeeFinancials && <TableHead className="text-right">Custo</TableHead>}
                {canSeeFinancials && <TableHead className="text-right">Margem</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtosMock.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell><Badge variant="outline">{p.categoria}</Badge></TableCell>
                  <TableCell className="text-right">R$ {p.preco.toFixed(2)}</TableCell>
                  {canSeeFinancials && <TableCell className="text-right">R$ {p.custo.toFixed(2)}</TableCell>}
                  {canSeeFinancials && (
                    <TableCell className="text-right">
                      <Badge variant={p.margem >= 60 ? "default" : "secondary"}>{p.margem}%</Badge>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
