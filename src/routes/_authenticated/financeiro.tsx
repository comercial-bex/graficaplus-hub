import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro — BEX PRINT OS" }] }),
  component: FinanceiroPage,
});

function FinanceiroPage() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["pagamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("*, ordens_servico(numero, titulo, clientes(nome))")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Financeiro</h1>
        <p className="text-muted-foreground">Pagamentos e recebimentos</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OS</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum pagamento</TableCell></TableRow>}
              {data.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>#{p.ordens_servico?.numero}</TableCell>
                  <TableCell>{p.ordens_servico?.clientes?.nome}</TableCell>
                  <TableCell>R$ {Number(p.valor).toFixed(2)}</TableCell>
                  <TableCell>{p.parcela}/{p.total_parcelas}</TableCell>
                  <TableCell>{p.data_vencimento ?? "—"}</TableCell>
                  <TableCell><Badge variant={p.status === "pago" ? "default" : "outline"}>{p.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
