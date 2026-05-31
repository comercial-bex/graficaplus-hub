import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/os")({
  head: () => ({ meta: [{ title: "Ordens de Serviço — BEX PRINT OS" }] }),
  component: OSPage,
});

function OSPage() {
  const { canSeeFinancials } = useAuth();
  const { data: os = [], isLoading } = useQuery({
    queryKey: ["os-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordens_servico")
        .select("*, clientes(nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ordens de Serviço</h1>
        <p className="text-muted-foreground">Acompanhe todas as OS da produção</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prazo</TableHead>
                {canSeeFinancials && <TableHead>Valor</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
              {!isLoading && os.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma OS</TableCell></TableRow>}
              {os.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell>#{o.numero}</TableCell>
                  <TableCell className="font-medium">{o.titulo}</TableCell>
                  <TableCell>{o.clientes?.nome}</TableCell>
                  <TableCell><Badge variant="outline">{o.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell>{o.prazo_entrega ?? "—"}</TableCell>
                  {canSeeFinancials && <TableCell>R$ {Number(o.valor_total).toFixed(2)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
