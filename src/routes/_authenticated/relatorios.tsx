/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  DollarSign,
  Package,
  AlertTriangle,
  Clock,
  Users,
  MessageCircle,
  Factory,
  Target,
  Wrench,
} from "lucide-react";
import { db } from "@/lib/module-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — BEX PRINT OS" }] }),
  component: RelatPage,
});

const gruposBase = [
  {
    titulo: "Financeiros",
    cor: "text-emerald-600 bg-emerald-500/10",
    icone: DollarSign,
    items: [
      "Faturamento por período",
      "Lucro por OS",
      "Lucro por produto",
      "Margem por vendedor",
      "Custo por categoria",
      "Inadimplência",
      "Ticket médio",
    ],
  },
  {
    titulo: "Operacionais",
    cor: "text-blue-600 bg-blue-500/10",
    icone: Factory,
    items: [
      "OS por status",
      "OS atrasadas",
      "Tempo médio por etapa",
      "Produção por máquina",
      "Máquinas paradas",
      "Retrabalho por setor",
    ],
  },
  {
    titulo: "Comerciais",
    cor: "text-violet-600 bg-violet-500/10",
    icone: Target,
    items: [
      "Orçamentos enviados/aprovados",
      "Taxa de conversão",
      "Clientes novos x recorrentes",
      "Produtos mais vendidos",
      "Vendas por vendedor",
    ],
  },
  {
    titulo: "WhatsApp",
    cor: "text-emerald-600 bg-emerald-500/10",
    icone: MessageCircle,
    items: [
      "Conversas abertas",
      "Tempo médio de resposta",
      "Conversas por atendente",
      "Orçamentos vindos do WhatsApp",
    ],
  },
];

void [TrendingUp, Package, AlertTriangle, Clock, Users, Wrench];

function RelatPage() {
  const qc = useQueryClient();
  const { data: relatorios = [] } = useQuery({
    queryKey: ["relatorios"],
    queryFn: async () => {
      const { data, error } = await db.from("relatorios").select("*").order("grupo").order("nome");
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async ({ grupo, nome }: { grupo: string; nome: string }) => {
      const { error } = await db.from("relatorios").insert({ grupo, nome, status: "pendente" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Relatório criado");
      qc.invalidateQueries({ queryKey: ["relatorios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const { error } = await db.from("relatorios").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relatorios"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">
          Indicadores gerenciais e operacionais cadastrados no Supabase
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {gruposBase.map((g) => {
          const cadastrados = relatorios.filter((r: any) => r.grupo === g.titulo);
          const itens = cadastrados.length
            ? cadastrados
            : g.items.map((nome) => ({
                id: `${g.titulo}-${nome}`,
                nome,
                status: "pendente",
                seed: true,
              }));
          return (
            <Card key={g.titulo}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${g.cor}`}>
                    <g.icone className="h-5 w-5" />
                  </div>
                  <h2 className="font-semibold">{g.titulo}</h2>
                </div>
                <ul className="space-y-1.5">
                  {itens.map((i: any) => (
                    <li
                      key={i.id}
                      className="text-sm flex items-center justify-between border-b border-border/50 py-1.5 gap-2"
                    >
                      <span>{i.nome}</span>
                      <div className="flex gap-2 items-center">
                        {i.seed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => create.mutate({ grupo: g.titulo, nome: i.nome })}
                          >
                            Criar
                          </Button>
                        ) : (
                          <>
                            <Badge variant={i.status === "gerado" ? "default" : "outline"}>
                              {i.status}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                update.mutate({
                                  id: i.id,
                                  changes: { descricao: `${i.descricao || ""} ` },
                                })
                              }
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                update.mutate({
                                  id: i.id,
                                  changes: {
                                    status: "gerado",
                                    gerado_em: new Date().toISOString(),
                                  },
                                })
                              }
                            >
                              Concluir
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
