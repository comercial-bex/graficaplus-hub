import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Play, Square, Timer } from "lucide-react";
import { toast } from "sonner";

type Apontamento = {
  id: string;
  maquina_id: string;
  etapa: string | null;
  quantidade: number | null;
  iniciado_em: string;
  finalizado_em: string | null;
  observacoes: string | null;
  maquinas?: { nome: string; custo_hora: number | null } | null;
};

const ETAPAS = ["Impressão", "Recorte", "Laminação", "Acabamento", "Aplicação"];

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Duração em horas e minutos, do jeito que a oficina fala. */
function duracao(inicio: string, fim: string | null): string {
  const ms = new Date(fim ?? Date.now()).getTime() - new Date(inicio).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

/**
 * Apontamento de produção por máquina.
 *
 * Era o elo morto que impedia o custo real de existir: sem apontamento, a OS
 * nunca tinha custo de máquina, o previsto do orçamento não ganhava um realizado
 * para comparar, e `fechar_os` ficava travado em "custos_operacionais".
 *
 * Fechar o apontamento LANÇA o custo (horas × custo/hora). Máquina sem custo/hora
 * registra o tempo e avisa — um custo de R$ 0,00 no resultado da OS mente pior
 * que um custo ausente, porque parece que a conta foi feita.
 */
export function ApontamentoDaOS({ osId }: { osId: string }) {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const podeIniciar = hasPermission("producao.start");
  const podeFinalizar = hasPermission("producao.finish");

  const [maquina, setMaquina] = useState("");
  const [etapa, setEtapa] = useState("");
  const [quantidade, setQuantidade] = useState("");

  const { data: apontamentos = [], isLoading } = useQuery({
    queryKey: ["apontamentos", osId],
    queryFn: async (): Promise<Apontamento[]> => {
      const { data, error } = await (supabase as any)
        .from("apontamentos_producao")
        .select(
          "id, maquina_id, etapa, quantidade, iniciado_em, finalizado_em, observacoes, maquinas(nome, custo_hora)",
        )
        .eq("os_id", osId)
        .order("iniciado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Apontamento[];
    },
  });

  const { data: maquinas = [] } = useQuery({
    queryKey: ["maquinas-para-apontar"],
    enabled: podeIniciar,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("maquinas")
        .select("id, nome, custo_hora")
        .eq("ativa", true)
        .order("nome");
      return data ?? [];
    },
  });

  const iniciar = useMutation({
    mutationFn: async () => {
      if (!maquina) throw new Error("Escolha a máquina");
      const { error } = await (supabase.rpc as any)("iniciar_apontamento", {
        p_os_id: osId,
        p_maquina_id: maquina,
        p_etapa: etapa || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setEtapa("");
      toast.success("Produção iniciada");
      qc.invalidateQueries({ queryKey: ["apontamentos", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao iniciar"),
  });

  const finalizar = useMutation({
    mutationFn: async (a: Apontamento) => {
      const { data, error } = await (supabase.rpc as any)("finalizar_apontamento", {
        p_apontamento_id: a.id,
        p_quantidade: quantidade ? Number(quantidade) : null,
        p_observacoes: null,
      });
      if (error) throw error;
      return data as { custo_gerado: boolean; custo?: number; horas: number; aviso?: string };
    },
    onSuccess: (r) => {
      setQuantidade("");
      if (r.custo_gerado) {
        toast.success(`Produção encerrada · ${brl(r.custo ?? 0)} de custo de máquina lançado`);
      } else {
        // Aviso, não erro: o tempo foi registrado; o que falta é cadastro.
        toast.warning(r.aviso ?? "Tempo registrado sem custo.");
      }
      qc.invalidateQueries({ queryKey: ["apontamentos", osId] });
      qc.invalidateQueries({ queryKey: ["os", osId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao finalizar"),
  });

  const aberto = apontamentos.find((a) => !a.finalizado_em);
  const semCusto = maquinas.filter((m: any) => !Number(m.custo_hora)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Produção por máquina
          {aberto && (
            <Badge variant="destructive" className="gap-1 font-normal">
              em andamento · {duracao(aberto.iniciado_em, null)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {podeIniciar && semCusto > 0 && maquinas.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              {semCusto === maquinas.length
                ? "Nenhuma máquina tem custo/hora cadastrado"
                : `${semCusto} de ${maquinas.length} máquinas sem custo/hora`}
              . O tempo é registrado, mas não vira custo na OS — preencha em Máquinas.
            </div>
          </div>
        )}

        {podeIniciar && !aberto && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs">Máquina</Label>
              <Select value={maquina} onValueChange={setMaquina}>
                <SelectTrigger><SelectValue placeholder="Escolha a máquina" /></SelectTrigger>
                <SelectContent>
                  {maquinas.map((m: any) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nome}
                      {Number(m.custo_hora) > 0
                        ? ` · ${brl(Number(m.custo_hora))}/h`
                        : " · sem custo/h"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <Label className="text-xs">Etapa</Label>
              <Select value={etapa} onValueChange={setEtapa}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  {ETAPAS.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={iniciar.isPending || !maquina} onClick={() => iniciar.mutate()}>
              <Play className="h-4 w-4 mr-1" /> Iniciar produção
            </Button>
          </div>
        )}

        {aberto && podeFinalizar && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-sm">
              <strong>{aberto.maquinas?.nome ?? "Máquina"}</strong>
              {aberto.etapa && ` · ${aberto.etapa}`} — rodando há{" "}
              <strong>{duracao(aberto.iniciado_em, null)}</strong>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Label htmlFor="qtd-produzida" className="text-xs">Quantidade produzida</Label>
                <Input
                  id="qtd-produzida"
                  type="number"
                  min="0"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                disabled={finalizar.isPending}
                onClick={() => finalizar.mutate(aberto)}
              >
                <Square className="h-4 w-4 mr-1" /> Encerrar e lançar custo
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : apontamentos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhuma produção apontada nesta OS. Sem apontamento, a OS não tem custo de máquina
            e o fechamento fica travado.
          </div>
        ) : (
          <div className="divide-y rounded-md border text-sm">
            {apontamentos.map((a) => {
              const custoHora = Number(a.maquinas?.custo_hora ?? 0);
              const horas =
                (new Date(a.finalizado_em ?? Date.now()).getTime() -
                  new Date(a.iniciado_em).getTime()) /
                3600000;
              return (
                <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                  <span className="font-medium">{a.maquinas?.nome ?? "—"}</span>
                  {a.etapa && <Badge variant="outline" className="font-normal">{a.etapa}</Badge>}
                  <span className="text-muted-foreground">
                    {duracao(a.iniciado_em, a.finalizado_em)}
                  </span>
                  {a.quantidade != null && (
                    <span className="text-muted-foreground">· {a.quantidade} un</span>
                  )}
                  {a.finalizado_em ? (
                    custoHora > 0 ? (
                      <span className="ml-auto font-mono">{brl(horas * custoHora)}</span>
                    ) : (
                      <span className="ml-auto text-xs text-amber-600">sem custo/hora</span>
                    )
                  ) : (
                    <Badge variant="destructive" className="ml-auto font-normal">aberto</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
