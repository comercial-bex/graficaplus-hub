/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Smile, Meh, Frown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pos-venda")({
  head: () => ({ meta: [{ title: "Pós-venda / NPS — BEX PRINT OS" }] }),
  component: PosVendaPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function PosVendaPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [selectedPesquisa, setSelectedPesquisa] = useState<string | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");

  const { data: pesquisas = [] } = useQuery({
    queryKey: ["pos-venda-pesquisas"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pos_venda_pesquisas")
        .select("*, ordens_servico(numero, titulo), clientes(nome)")
        .order("agendada_para", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { data: respostas = [] } = useQuery({
    queryKey: ["pos-venda-respostas"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("pos_venda_respostas")
        .select("*, pos_venda_pesquisas(os_id, ordens_servico(numero, titulo))")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const nps = (() => {
    const validas = respostas.filter((r: any) => r.nota != null);
    if (validas.length === 0) return null;
    const p = validas.filter((r: any) => r.nps_classificacao === "promotor").length;
    const d = validas.filter((r: any) => r.nps_classificacao === "detrator").length;
    return Math.round(((p - d) / validas.length) * 100);
  })();

  const totais = {
    agendadas: pesquisas.filter((p: any) => p.status === "agendada").length,
    enviadas: pesquisas.filter((p: any) => p.status === "enviada").length,
    respondidas: respostas.length,
    promotores: respostas.filter((r: any) => r.nps_classificacao === "promotor").length,
    detratores: respostas.filter((r: any) => r.nps_classificacao === "detrator").length,
  };

  async function enviarResposta() {
    if (!selectedPesquisa || nota == null) {
      return toast.error("Selecione uma pesquisa e uma nota");
    }
    const pesquisa = pesquisas.find((p: any) => p.id === selectedPesquisa);
    const { error } = await (supabase as any).from("pos_venda_respostas").insert({
      pesquisa_id: selectedPesquisa,
      cliente_id: pesquisa?.cliente_id,
      nota,
      comentario: comentario || null,
    });
    if (error) return toast.error(error.message);
    await (supabase as any)
      .from("pos_venda_pesquisas")
      .update({ status: "respondida" })
      .eq("id", selectedPesquisa);
    toast.success("Resposta registrada");
    setSelectedPesquisa(null);
    setNota(null);
    setComentario("");
    qc.invalidateQueries({ queryKey: ["pos-venda-pesquisas"] });
    qc.invalidateQueries({ queryKey: ["pos-venda-respostas"] });
  }

  async function marcarEnviada(id: string) {
    const { error } = await (supabase as any)
      .from("pos_venda_pesquisas")
      .update({ status: "enviada", enviada_em: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pesquisa marcada como enviada");
    qc.invalidateQueries({ queryKey: ["pos-venda-pesquisas"] });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Análise · Pós-venda"
        title="Pós-venda & NPS"
        description="Pesquisas agendadas automaticamente pelo fechar_os. Colete NPS, comentários e feedback do cliente."
        actions={<StatusChip label={`NPS: ${nps ?? "—"}`} tone={nps != null && nps >= 50 ? "lime" : "cyan"} />}
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Agendadas" value={totais.agendadas} icon={TrendingUp} tone="cyan" />
        <KpiCard label="Respondidas" value={totais.respondidas} icon={Star} tone="lime" />
        <KpiCard label="Promotores" value={totais.promotores} icon={Smile} tone="lime" />
        <KpiCard
          label="Detratores"
          value={totais.detratores}
          icon={Frown}
          tone={totais.detratores > 0 ? "magenta" : "muted"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pesquisas agendadas / a enviar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pesquisas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhuma pesquisa. Elas são criadas automaticamente ao fechar OS.
              </p>
            ) : (
              pesquisas.map((p: any) => (
                <div
                  key={p.id}
                  className={`rounded border p-3 cursor-pointer ${
                    selectedPesquisa === p.id ? "border-primary bg-muted/50" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPesquisa(p.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedPesquisa(p.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        OS #{p.ordens_servico?.numero ?? "—"} ·{" "}
                        {p.ordens_servico?.titulo ?? ""}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {p.clientes?.nome ?? "—"} · {p.tipo} · agendada{" "}
                        {p.agendada_para
                          ? new Date(p.agendada_para).toLocaleDateString("pt-BR")
                          : "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusChip
                        label={p.status}
                        tone={
                          p.status === "respondida"
                            ? "lime"
                            : p.status === "enviada"
                              ? "cyan"
                              : "muted"
                        }
                      />
                      {p.status === "agendada" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            marcarEnviada(p.id);
                          }}
                        >
                          Enviar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedPesquisa ? "Registrar resposta NPS" : "Histórico de respostas"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedPesquisa ? (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-2 font-mono">
                    "Em uma escala de 0 a 10, quanto você recomendaria a BEX Print?"
                  </div>
                  <div className="grid grid-cols-11 gap-1">
                    {Array.from({ length: 11 }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setNota(i)}
                        className={`h-10 rounded font-mono text-sm font-bold transition-colors ${
                          nota === i
                            ? i >= 9
                              ? "bg-[color:var(--bex-lime)] text-black"
                              : i >= 7
                                ? "bg-[color:var(--bex-cyan)] text-black"
                                : "bg-[color:var(--bex-magenta)] text-white"
                            : "bg-muted hover:bg-muted/70"
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                    <span>Nada provável</span>
                    <span>Extremamente provável</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground">
                    Comentário
                  </label>
                  <Textarea
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    rows={3}
                    placeholder="O que motivou a nota?"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setSelectedPesquisa(null)}>
                    Cancelar
                  </Button>
                  <Button onClick={enviarResposta} disabled={nota == null}>
                    Registrar resposta
                  </Button>
                </div>
              </div>
            ) : respostas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Sem respostas registradas.
              </p>
            ) : (
              <div className="space-y-2">
                {respostas.slice(0, 20).map((r: any) => (
                  <div key={r.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {r.nps_classificacao === "promotor" && (
                          <Smile className="h-4 w-4 text-[color:var(--bex-lime)]" />
                        )}
                        {r.nps_classificacao === "neutro" && (
                          <Meh className="h-4 w-4 text-[color:var(--bex-cyan)]" />
                        )}
                        {r.nps_classificacao === "detrator" && (
                          <Frown className="h-4 w-4 text-[color:var(--bex-magenta)]" />
                        )}
                        <span className="font-mono text-lg font-bold">{r.nota}</span>
                        <StatusChip
                          label={r.nps_classificacao ?? "—"}
                          tone={
                            r.nps_classificacao === "promotor"
                              ? "lime"
                              : r.nps_classificacao === "detrator"
                                ? "magenta"
                                : "cyan"
                          }
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        OS #{r.pos_venda_pesquisas?.ordens_servico?.numero ?? "—"}
                      </span>
                    </div>
                    {r.comentario && (
                      <div className="text-xs text-foreground italic">"{r.comentario}"</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
