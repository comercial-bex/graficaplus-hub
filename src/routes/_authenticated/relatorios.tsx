import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp, DollarSign, Package, AlertTriangle, Clock,
  Users, MessageCircle, Factory, Target, Wrench,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios — BEX PRINT OS" }] }),
  component: RelatPage,
});

const grupos = [
  {
    titulo: "Financeiros",
    cor: "text-emerald-600 bg-emerald-500/10",
    icone: DollarSign,
    items: ["Faturamento por período", "Lucro por OS", "Lucro por produto", "Margem por vendedor", "Custo por categoria", "Inadimplência", "Ticket médio"],
  },
  {
    titulo: "Operacionais",
    cor: "text-blue-600 bg-blue-500/10",
    icone: Factory,
    items: ["OS por status", "OS atrasadas", "Tempo médio por etapa", "Produção por máquina", "Máquinas paradas", "Retrabalho por setor"],
  },
  {
    titulo: "Comerciais",
    cor: "text-violet-600 bg-violet-500/10",
    icone: Target,
    items: ["Orçamentos enviados/aprovados", "Taxa de conversão", "Clientes novos x recorrentes", "Produtos mais vendidos", "Vendas por vendedor"],
  },
  {
    titulo: "WhatsApp",
    cor: "text-emerald-600 bg-emerald-500/10",
    icone: MessageCircle,
    items: ["Conversas abertas", "Tempo médio de resposta", "Conversas por atendente", "Orçamentos vindos do WhatsApp"],
  },
];

function RelatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">Indicadores gerenciais e operacionais</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <Card key={g.titulo}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${g.cor}`}>
                  <g.icone className="h-5 w-5" />
                </div>
                <h2 className="font-semibold">{g.titulo}</h2>
              </div>
              <ul className="space-y-1.5">
                {g.items.map((i) => (
                  <li key={i} className="text-sm flex items-center justify-between border-b border-border/50 py-1.5">
                    <span>{i}</span>
                    <span className="text-xs text-muted-foreground">Em breve</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
