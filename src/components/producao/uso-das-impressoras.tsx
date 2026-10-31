/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { HORAS_POR_DIA_UTIL, simularUso } from "@/domain/impressao3d/uso-das-maquinas";

/**
 * O uso das impressoras (30/10/2026): o simulador "quantas horas e quantas
 * impressoras para esta quantidade" e a repartição dos jobs de uma OS entre as
 * impressoras. A conta é a do motor de custo (peças ÷ peças por placa = rodadas);
 * a repartição vai para o banco (`redistribuir_jobs_3d_da_os`), que põe cada
 * rodada na impressora menos carregada.
 */
export function UsoDasImpressoras({ jobs }: { jobs: any[] }) {
  const qc = useQueryClient();
  const [pecas, setPecas] = useState("100");
  const [porPlaca, setPorPlaca] = useState("1");
  const [minutos, setMinutos] = useState("110");
  const [repartindo, setRepartindo] = useState<string | null>(null);

  const impressoras = useQuery({
    queryKey: ["impressoras-3d-ativas"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas")
        .select("id, nome")
        .eq("tipo", "impressora_3d")
        .eq("ativa", true)
        .order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const total = impressoras.data?.length ?? 0;

  const simulacao = useMemo(
    () =>
      simularUso(
        { pecas: Number(pecas) || 0, pecasPorPlaca: Number(porPlaca) || 1, minutosPorRodada: Number(minutos) || 0 },
        total || 1,
      ),
    [pecas, porPlaca, minutos, total],
  );

  // OS com job ainda planejado e sem horário na agenda: são as que dá para repartir.
  const reparticaveis = useMemo(() => {
    const porOs = new Map<string, { id: string; numero: number | null; titulo: string; planejados: number; maquinas: Set<string> }>();
    for (const j of jobs) {
      if (j.status !== "planejado" || j.agenda_id || !j.os_id) continue;
      const atual = porOs.get(j.os_id) ?? {
        id: j.os_id as string,
        numero: j.ordens_servico?.numero ?? null,
        titulo: (j.ordens_servico?.titulo as string) ?? "",
        planejados: 0,
        maquinas: new Set<string>(),
      };
      atual.planejados += 1;
      atual.maquinas.add((j.maquinas?.nome as string) ?? "sem máquina");
      porOs.set(j.os_id, atual);
    }
    return [...porOs.values()].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  }, [jobs]);

  async function repartir(osId: string) {
    setRepartindo(osId);
    try {
      const { data, error } = await (supabase as any).rpc("redistribuir_jobs_3d_da_os", { p_os_id: osId });
      if (error) throw error;
      const partes = ((data?.por_maquina ?? []) as { nome: string; jobs: number }[])
        .filter((m) => m.jobs > 0)
        .map((m) => `${m.nome}: ${m.jobs}`)
        .join(" · ");
      toast.success(`Jobs repartidos entre as impressoras. ${partes}`);
      void qc.invalidateQueries({ queryKey: ["producao-3d-jobs-full"] });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setRepartindo(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quantas impressoras para esta quantidade?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="uso-pecas">Peças</Label>
              <Input id="uso-pecas" inputMode="numeric" value={pecas} onChange={(e) => setPecas(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="uso-placa">Peças por placa</Label>
              <Input id="uso-placa" inputMode="numeric" value={porPlaca} onChange={(e) => setPorPlaca(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="uso-min">Minutos por rodada</Label>
              <Input id="uso-min" inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {simulacao.rodadas} rodadas de impressão · {simulacao.horasTotais.toLocaleString("pt-BR")} h de máquina no total
            · dia útil de {HORAS_POR_DIA_UTIL} h (08:00 às 18:00, segunda a sexta).
          </p>
          {simulacao.excedeOTeto && (
            <p className="text-xs text-destructive">Acima de 300 rodadas o sistema recusa a OS: divida o pedido.</p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-normal">Impressoras</th>
                <th className="py-1 font-normal">Rodadas na mais cheia</th>
                <th className="py-1 font-normal">Horas</th>
                <th className="py-1 font-normal">Dias úteis</th>
              </tr>
            </thead>
            <tbody>
              {simulacao.cenarios.map((c) => (
                <tr key={c.maquinas} className="border-t border-border">
                  <td className="py-1">{c.maquinas}</td>
                  <td className="py-1">{c.rodadasNaMaisCarregada}</td>
                  <td className="py-1">{c.horasNaMaisCarregada.toLocaleString("pt-BR")}</td>
                  <td className="py-1">{c.diasUteis}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            {total} impressora(s) 3D ativa(s). Impressora roda de noite sem ninguém; a agenda só conta o horário comercial.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repartir os jobs de uma OS entre as impressoras</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reparticaveis.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma OS com job planejado e sem horário na agenda.
            </p>
          ) : (
            reparticaveis.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    OS #{o.numero ?? "—"} · {o.titulo}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.planejados} job(s) planejado(s) · hoje em: {[...o.maquinas].join(", ")}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={repartindo === o.id} onClick={() => void repartir(o.id)}>
                  {repartindo === o.id ? "Repartindo..." : "Repartir"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
