/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/bex/SectionHeader";
import { StatusChip } from "@/components/bex/StatusChip";
import { KpiCard } from "@/components/bex/KpiCard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageCircle, Send, AlertTriangle, RefreshCw, CheckCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/whatsapp-monitor")({
  head: () => ({ meta: [{ title: "Monitor WhatsApp — BEX PRINT OS" }] }),
  component: WhatsappMonitorPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Erro: {error.message}</div>,
});

function toneForStatus(s: string): "cyan" | "magenta" | "lime" | "muted" {
  if (s === "entregue" || s === "lida" || s === "enviada") return "lime";
  if (s === "erro" || s === "falha") return "magenta";
  if (s === "pendente" || s === "fila") return "cyan";
  return "muted";
}

function WhatsappMonitorPage() {
  const qc = useQueryClient();
  const [osId, setOsId] = useState<string>("");

  const { data: ordens = [] } = useQuery({
    queryKey: ["os-para-monitor"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ordens_servico_operacional")
        .select("id, numero, titulo, cliente_id, cliente_nome")
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  const { data: mensagens = [], isFetching } = useQuery({
    queryKey: ["wa-msgs-os", osId],
    enabled: !!osId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("whatsapp_mensagens")
        .select("*")
        .eq("os_id", osId)
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const { data: fila = [] } = useQuery({
    queryKey: ["wa-fila-os", osId],
    enabled: !!osId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("whatsapp_fila_envio")
        .select("*")
        .in(
          "mensagem_id",
          (mensagens ?? []).map((m: any) => m.id).filter(Boolean),
        )
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const total = mensagens.length;
  const erros = mensagens.filter((m: any) => m.status === "erro" || m.status === "falha").length;
  const enviadas = mensagens.filter((m: any) =>
    ["enviada", "entregue", "lida"].includes(m.status),
  ).length;
  const pendentes = mensagens.filter((m: any) =>
    ["pendente", "fila", "recebida"].includes(m.status),
  ).length;

  async function reenviar(msg: any) {
    // Re-enqueue via whatsapp_fila_envio with a new idempotency key
    const key = `resend-${msg.id}-${Date.now()}`;
    const { error } = await (supabase as any).from("whatsapp_fila_envio").insert({
      conversa_id: msg.conversa_id,
      mensagem_id: msg.id,
      payload: msg.payload ?? { texto: msg.texto },
      idempotency_key: key,
      status: "pendente",
    });
    if (error) return toast.error("Falha ao reenviar: " + error.message);
    // Reset message status to pending for visibility
    await (supabase as any)
      .from("whatsapp_mensagens")
      .update({ status: "pendente", erro: null })
      .eq("id", msg.id);
    toast.success("Mensagem reenfileirada para envio");
    qc.invalidateQueries({ queryKey: ["wa-msgs-os", osId] });
    qc.invalidateQueries({ queryKey: ["wa-fila-os", osId] });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        breadcrumb="Atendimento · WhatsApp"
        title="Monitor de automações WhatsApp por OS"
        description="Acompanhe mensagens enviadas pelas automações, status de entrega e reenvie manualmente quando necessário"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["wa-msgs-os", osId] })}
            disabled={!osId}
          >
            <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selecionar OS</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={osId} onValueChange={setOsId}>
            <SelectTrigger className="w-full md:w-[480px]">
              <SelectValue placeholder="Escolha uma ordem de serviço..." />
            </SelectTrigger>
            <SelectContent>
              {ordens.map((o: any) => (
                <SelectItem key={o.id} value={o.id}>
                  #{o.numero} · {o.titulo} · {o.cliente_nome ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {osId && (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total mensagens" value={total} icon={MessageCircle} tone="cyan" />
            <KpiCard label="Enviadas" value={enviadas} icon={CheckCheck} tone="lime" />
            <KpiCard label="Pendentes / fila" value={pendentes} icon={Send} tone="cyan" />
            <KpiCard
              label="Erros"
              value={erros}
              icon={AlertTriangle}
              tone={erros > 0 ? "magenta" : "muted"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Histórico de mensagens</CardTitle>
            </CardHeader>
            <CardContent>
              {isFetching ? (
                <p className="text-center py-6 text-muted-foreground text-sm">Carregando...</p>
              ) : mensagens.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  Sem mensagens registradas para esta OS.
                </p>
              ) : (
                <div className="space-y-2">
                  {mensagens.map((m: any) => (
                    <div
                      key={m.id}
                      className="rounded border p-3 text-sm flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">
                            {m.direcao} · {m.tipo}
                          </span>
                          <StatusChip
                            label={m.status}
                            tone={toneForStatus(m.status)}
                          />
                          <span className="text-xs text-muted-foreground font-mono">
                            {new Date(m.created_at).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <div className="line-clamp-2 text-foreground">
                          {m.texto ?? m.legenda ?? "(mídia)"}
                        </div>
                        {m.erro && (
                          <div className="mt-1 text-xs text-destructive font-mono">
                            ⚠ {m.erro}
                          </div>
                        )}
                      </div>
                      {(m.status === "erro" ||
                        m.status === "falha" ||
                        m.status === "pendente") &&
                        m.direcao === "saida" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reenviar(m)}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Reenviar
                          </Button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {fila.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fila de envio ativa</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {fila.map((f: any) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded border p-2 font-mono text-xs"
                  >
                    <span className="truncate">{f.idempotency_key}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">tent. {f.tentativas}</span>
                      <StatusChip label={f.status} tone={toneForStatus(f.status)} />
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
