import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { price, operationalCost, failureReserve, MOTOR_VERSION } from "@/domain/impressao3d/cost-engine";

export const Route = createFileRoute("/_authenticated/impressao-3d")({
  head: () => ({ meta: [{ title: "Impressão 3D — BEX PRINT OS" }] }),
  component: Impressao3DPage,
});

function money(value: { toString(decimals?: number): string }, decimals = 2) { return `R$ ${value.toString(decimals)}`; }

function Impressao3DPage() {
  const custo = operationalCost({ material: "30.5000", maquina: "35.7000", energia: "1.1220", maoDeObra: "40.0000", embalagem: "5.0000", indiretosRateados: "10.0000", reservaFalha: 0 });
  const precos = price({ custoOperacional: custo, tributosVenda: "0.06", taxaPagamento: "0.03", margemLiquidaAlvo: "0.25", margemMinima: "0.10", quantidade: 1 });
  const risco = failureReserve("0.10", 60);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Impressão 3D</h1>
        <p className="text-muted-foreground">Motor profissional de orçamento, importação de slicer, produção, custo previsto e custo realizado.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Nível atual", "validado pelo fatiador"],
          ["Custo operacional", money(custo, 4)],
          ["Preço sugerido", money(precos.precoComercial)],
          ["Margem líquida", `${(precos.margemLiquida.toNumber() * 100).toFixed(2)}%`],
        ].map(([title, value]) => <Card key={title}><CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{value}</CardContent></Card>)}
      </div>
      <Card>
        <CardHeader><CardTitle>Assistente de orçamento 3D</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {["cliente e pedido","arquivo","importação/fatiamento","placas","filamentos","máquina","energia","serviços","acabamento","risco","taxas","margem","resultado","versão e envio"].map((step, index) => <div className="rounded-lg border p-3" key={step}><Badge variant="secondary">{index + 1}</Badge><div className="mt-2 text-sm font-medium">{step}</div></div>)}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Resultado interno</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>Exibe custo por componente, preço mínimo, preço sugerido, preço praticado, unitário, lucro, margem, markup, desconto máximo, pendências e nível de precisão.</p><p>Reserva de falha exemplo: {risco.toString(6)}.</p><p>Versão do motor: {MOTOR_VERSION}.</p></CardContent></Card>
        <Card><CardHeader><CardTitle>Resultado para cliente</CardTitle></CardHeader><CardContent className="text-sm">Mostra descrição, quantidade, prazo, valor, condições, validade e observações permitidas. Custos, margem, risco, taxas internas e notas internas permanecem ocultos.</CardContent></Card>
      </div>
    </div>
  );
}
