import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/breakdown-3d")({
  head: () => ({ meta: [{ title: "Custo por peça 3D — BEX PRINT OS" }] }),
  component: BreakdownPage,
});

type Linha = {
  orcamento_id: string;
  titulo: string;
  cliente: string;
  status: string;
  quantidade: number;
  custo_material: number;
  custo_maquina: number;
  custo_energia: number;
  custo_mao_obra: number;
  custo_acabamento: number;
  custo_indireto: number;
  custo_operacional: number;
  markup: number;
  margem: number;
  preco: number;
  valor_unitario: number;
  gramas_reais: number;
  custo_material_real: number;
  horas_reais: number;
  custo_maquina_real: number;
  produzido: boolean;
  divergencia_material: number | null;
};

const brl = (n: number | null) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(Number(n) * 100).toFixed(1)}%`;

const hoje = new Date().toISOString().slice(0, 10);
const noventa = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);

/**
 * Custo por peça 3D: o que foi orçado e o que a peça custou de verdade.
 *
 * A quebra por orçamento já existia na tela de detalhe, uma peça por vez. Quem
 * forma preço precisa do conjunto — em quais peças a conta errou, e para que
 * lado. O lado do realizado só passou a existir quando o filamento começou a
 * sair do estoque e a hora de máquina virou apontamento.
 */
function BreakdownPage() {
  const [inicio, setInicio] = useState(noventa);
  const [fim, setFim] = useState(hoje);

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["breakdown-3d", inicio, fim],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase.rpc as any)("breakdown_3d", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  // Orçamento de impressão 3D sem custo de máquina só acontece quando o tempo
  // não foi informado — e aí a hora de impressora virou brinde.
  const semMaquina = linhas.filter((l) => Number(l.custo_maquina) === 0);

  return (
    <div>
      <SectionHeader
        breadcrumb="Impressão 3D"
        title="Custo por peça"
        description="O que foi orçado em cada peça e, quando houve produção, o que ela custou de verdade."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="de" className="text-xs">De</Label>
          <Input id="de" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label htmlFor="ate" className="text-xs">Até</Label>
          <Input id="ate" type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" />
        </div>
      </div>

      {semMaquina.length > 0 && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <strong>
              {semMaquina.length === 1
                ? "Um orçamento está"
                : `${semMaquina.length} orçamentos estão`}{" "}
              sem custo de máquina.
            </strong>{" "}
            Isso acontece quando o tempo de impressão não foi informado: a hora de impressora e
            a energia saem zeradas, e a peça é vendida abaixo do custo real. Refaça o cálculo
            informando o tempo do fatiador.
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : linhas.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhum orçamento 3D no período.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Peça</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Material</TableHead>
                    <TableHead className="text-right">Máquina</TableHead>
                    <TableHead className="text-right">Energia</TableHead>
                    <TableHead className="text-right">Mão de obra</TableHead>
                    <TableHead className="text-right">Custo</TableHead>
                    <TableHead className="text-right">Markup</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Realizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => {
                    const zerado = Number(l.custo_maquina) === 0;
                    const div = l.divergencia_material;
                    return (
                      <TableRow key={l.orcamento_id}>
                        <TableCell>
                          <div className="font-medium">{l.titulo}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.cliente} · {l.status}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">{l.quantidade}</TableCell>
                        <TableCell className="text-right font-mono">{brl(l.custo_material)}</TableCell>
                        <TableCell
                          className={`text-right font-mono ${zerado ? "text-destructive font-semibold" : ""}`}
                        >
                          {brl(l.custo_maquina)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${Number(l.custo_energia) === 0 ? "text-destructive" : ""}`}
                        >
                          {brl(l.custo_energia)}
                        </TableCell>
                        <TableCell className="text-right font-mono">{brl(l.custo_mao_obra)}</TableCell>
                        <TableCell className="text-right font-mono">{brl(l.custo_operacional)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(l.markup).toFixed(2)}×
                          <div className="text-xs text-muted-foreground">
                            margem {pct(l.margem)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {brl(l.preco)}
                        </TableCell>
                        <TableCell className="text-right">
                          {!l.produzido ? (
                            <span className="text-xs text-muted-foreground">não produzido</span>
                          ) : (
                            <div className="text-xs">
                              <div className="font-mono">
                                {Number(l.gramas_reais).toFixed(0)} g ·{" "}
                                {Number(l.horas_reais).toFixed(1)} h
                              </div>
                              {div != null && (
                                <Badge
                                  variant={Number(div) > 0 ? "destructive" : "secondary"}
                                  className="mt-1 font-normal"
                                >
                                  {Number(div) > 0 ? "+" : ""}
                                  {brl(div)} de material
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
