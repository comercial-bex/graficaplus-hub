import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { AlertTriangle, Gauge } from "lucide-react";

export const Route = createFileRoute("/_authenticated/produtividade-3d")({
  head: () => ({ meta: [{ title: "Produtividade 3D — BEX PRINT OS" }] }),
  component: ProdutividadePage,
});

type Linha = {
  maquina_id: string;
  maquina: string;
  custo_hora: number;
  jobs_concluidos: number;
  jobs_falha: number;
  taxa_falha_pct: number | null;
  horas_impressas: number;
  horas_previstas: number;
  pecas_produzidas: number;
  minutos_por_peca: number | null;
  custo_maquina: number;
  custo_energia: number;
  gramas_consumidas: number;
  custo_material: number;
  custo_total: number;
  custo_por_peca: number | null;
};

const brl = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n: number | null, casas = 1) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: casas });

const hoje = new Date().toISOString().slice(0, 10);
const trintaDias = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);

/**
 * Produtividade da impressão 3D.
 *
 * A pergunta que a tela responde é a que decide comprar máquina nova: quanto sai
 * de peça por hora, e a que custo. Os dados existiam espalhados — tempo no
 * apontamento, peças na placa, custo/hora na configuração, gramas no consumo —
 * e ninguém os juntava.
 */
function ProdutividadePage() {
  const { canSeeFinancials } = useAuth();
  const [inicio, setInicio] = useState(trintaDias);
  const [fim, setFim] = useState(hoje);

  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["produtividade-3d", inicio, fim],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await (supabase.rpc as any)("produtividade_3d", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });

  const comProducao = linhas.filter((l) => l.horas_impressas > 0);
  const totalPecas = comProducao.reduce((s, l) => s + l.pecas_produzidas, 0);
  const totalHoras = comProducao.reduce((s, l) => s + Number(l.horas_impressas), 0);
  const totalCusto = comProducao.reduce((s, l) => s + Number(l.custo_total), 0);
  const totalFalhas = comProducao.reduce((s, l) => s + l.jobs_falha, 0);
  const totalJobs = comProducao.reduce((s, l) => s + l.jobs_concluidos + l.jobs_falha, 0);

  return (
    <div>
      <SectionHeader
        breadcrumb="Impressão 3D"
        title="Produtividade"
        description="Quanto sai de peça por hora, e a que custo. A falha entra na conta: gasta filamento e máquina sem entregar peça."
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

      {comProducao.length > 0 && (
        <div className="mb-4 grid gap-1px sm:grid-cols-4 overflow-hidden rounded-md border">
          <Resumo rotulo="Peças produzidas" valor={String(totalPecas)} />
          <Resumo rotulo="Horas de máquina" valor={`${num(totalHoras, 1)} h`} />
          <Resumo
            rotulo="Taxa de falha"
            valor={totalJobs > 0 ? `${num((totalFalhas * 100) / totalJobs, 1)}%` : "—"}
            alerta={totalJobs > 0 && (totalFalhas * 100) / totalJobs > 10}
          />
          {canSeeFinancials && (
            <Resumo
              rotulo="Custo por peça"
              valor={totalPecas > 0 ? brl(totalCusto / totalPecas) : "—"}
            />
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : linhas.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhuma impressora 3D configurada.
            </div>
          ) : comProducao.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              Nenhuma impressão apontada neste período. Os números aparecem quando a produção
              for registrada em Produção 3D.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Máquina</TableHead>
                    <TableHead className="text-right">Horas</TableHead>
                    <TableHead className="text-right">Peças</TableHead>
                    <TableHead className="text-right">Min/peça</TableHead>
                    <TableHead className="text-right">Falha</TableHead>
                    <TableHead className="text-right">Filamento</TableHead>
                    {canSeeFinancials && (
                      <>
                        <TableHead className="text-right">Máquina</TableHead>
                        <TableHead className="text-right">Energia</TableHead>
                        <TableHead className="text-right">Material</TableHead>
                        <TableHead className="text-right">Custo/peça</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comProducao.map((l) => {
                    const atrasada =
                      Number(l.horas_previstas) > 0 &&
                      Number(l.horas_impressas) > Number(l.horas_previstas) * 1.1;
                    return (
                      <TableRow key={l.maquina_id}>
                        <TableCell className="font-medium">
                          {l.maquina}
                          {canSeeFinancials && (
                            <div className="text-xs text-muted-foreground">
                              {brl(Number(l.custo_hora))}/h
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {num(Number(l.horas_impressas))}
                          {/* Real acima do previsto é sinal de perfil de fatiamento
                              otimista ou máquina precisando de manutenção. */}
                          {atrasada && (
                            <div className="text-xs text-amber-600">
                              prev. {num(Number(l.horas_previstas))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">{l.pecas_produzidas}</TableCell>
                        <TableCell className="text-right font-mono">
                          {num(l.minutos_por_peca)}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.taxa_falha_pct == null ? (
                            "—"
                          ) : (
                            <Badge
                              variant={Number(l.taxa_falha_pct) > 10 ? "destructive" : "secondary"}
                              className="font-normal"
                            >
                              {num(l.taxa_falha_pct)}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {num(Number(l.gramas_consumidas))} g
                        </TableCell>
                        {canSeeFinancials && (
                          <>
                            <TableCell className="text-right font-mono">{brl(Number(l.custo_maquina))}</TableCell>
                            <TableCell className="text-right font-mono">{brl(Number(l.custo_energia))}</TableCell>
                            <TableCell className="text-right font-mono">{brl(Number(l.custo_material))}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {brl(l.custo_por_peca)}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalJobs > 0 && (totalFalhas * 100) / totalJobs > 10 && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            A taxa de falha está acima de 10%. Cada falha queima filamento e hora de máquina sem
            entregar peça — é o número que mais mexe no custo por peça, e ele já está embutido
            na coluna ao lado.
          </div>
        </div>
      )}
    </div>
  );
}

function Resumo({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="bg-card p-4 border-r last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      <div className={`mt-1 flex items-center gap-1.5 text-xl font-semibold ${alerta ? "text-amber-600" : ""}`}>
        {alerta && <Gauge className="h-4 w-4" />}
        {valor}
      </div>
    </div>
  );
}
