import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export const Route = createFileRoute("/_authenticated/precificacao")({
  head: () => ({ meta: [{ title: "Precificação — BEX PRINT OS" }] }),
  component: PrecificacaoPage,
});

function PrecificacaoPage() {
  const [material, setMaterial] = useState(45);
  const [insumos, setInsumos] = useState(8);
  const [maoObra, setMaoObra] = useState(25);
  const [maquina, setMaquina] = useState(35);
  const [acabamento, setAcabamento] = useState(12);
  const [outros, setOutros] = useState(5);
  const [margem, setMargem] = useState([50]);

  const calc = useMemo(() => {
    const custo = material + insumos + maoObra + maquina + acabamento + outros;
    const m = margem[0] / 100;
    const preco = custo / (1 - m);
    const lucro = preco - custo;
    const markup = preco / custo;
    return { custo, preco, lucro, markup };
  }, [material, insumos, maoObra, maquina, acabamento, outros, margem]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Precificação</h1>
        <p className="text-muted-foreground">Calculadora de custo, preço, margem e markup</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Composição de custo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Matéria-prima", material, setMaterial],
              ["Insumos", insumos, setInsumos],
              ["Mão de obra", maoObra, setMaoObra],
              ["Hora de máquina", maquina, setMaquina],
              ["Acabamento", acabamento, setAcabamento],
              ["Outros (taxa, imposto, comissão)", outros, setOutros],
            ].map(([label, val, setter]: any) => (
              <div key={label} className="grid grid-cols-3 items-center gap-3">
                <Label className="col-span-2">{label}</Label>
                <Input type="number" value={val} onChange={(e) => setter(Number(e.target.value))} />
              </div>
            ))}
            <div className="pt-4 border-t">
              <div className="flex justify-between mb-2">
                <Label>Margem desejada</Label>
                <span className="font-medium">{margem[0]}%</span>
              </div>
              <Slider value={margem} onValueChange={setMargem} min={10} max={80} step={1} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Resultado</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-muted p-4">
                <div className="text-xs text-muted-foreground">Custo total</div>
                <div className="text-2xl font-bold">R$ {calc.custo.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-accent/10 p-4">
                <div className="text-xs text-muted-foreground">Preço de venda</div>
                <div className="text-2xl font-bold text-accent">R$ {calc.preco.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-4">
                <div className="text-xs text-muted-foreground">Lucro</div>
                <div className="text-2xl font-bold text-emerald-600">R$ {calc.lucro.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-violet-500/10 p-4">
                <div className="text-xs text-muted-foreground">Markup</div>
                <div className="text-2xl font-bold text-violet-600">{calc.markup.toFixed(2)}x</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Fórmulas: Preço = Custo / (1 − Margem) · Lucro = Preço − Custo · Markup = Preço / Custo
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
