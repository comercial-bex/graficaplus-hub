import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Info, Loader2, QrCode, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/bex/StatusChip";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { qrCodeZapi, reprocessarMensagensSemTexto } from "@/lib/api/whatsapp-caixa.functions";

/** Aviso fixo do notifySentByMe. */
export function AvisoNotificarEnviadas() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p>
        No painel do Z-API, ligue <strong>“Notificar enviadas por mim”</strong> (notifySentByMe) para que as
        respostas dadas pelo celular apareçam aqui.
      </p>
    </div>
  );
}

/**
 * QR Code dentro do sistema: a imagem vem pelo servidor (o token nunca chega
 * ao navegador), atualiza a cada 20 s e some quando o "Ao conectar" chega.
 */
export function ConectarPorQrCode() {
  const { hasPermission } = useAuth();
  const qc = useQueryClient();
  const buscarQr = useServerFn(qrCodeZapi);
  const [aberto, setAberto] = useState(false);

  const instancia = useQuery({
    queryKey: ["whatsapp-instancias", "qr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_instancias")
        .select("id, conectado, status")
        .eq("ativa", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Status em tempo real: o webhook grava "conectado" ao receber ConnectedCallback.
  useEffect(() => {
    const canal = supabase
      .channel("wa-monitor-instancia")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_instancias" }, () => {
        void qc.invalidateQueries({ queryKey: ["whatsapp-instancias"] });
        void qc.invalidateQueries({ queryKey: ["wa-caixa-instancias"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);

  const conectado = instancia.data?.conectado === true;
  const qr = useQuery({
    queryKey: ["wa-qr-code"],
    enabled: aberto && !conectado,
    refetchInterval: 20_000,
    queryFn: () => buscarQr(),
  });

  useEffect(() => {
    if (qr.data?.conectado) {
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["whatsapp-instancias"] });
      toast.success("WhatsApp conectado.");
    }
  }, [qr.data?.conectado, qc]);

  if (!hasPermission("whatsapp.manage") || !instancia.data) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4" /> Conectar o celular
        </CardTitle>
        <StatusChip label={conectado ? "Conectado" : "Desconectado"} tone={conectado ? "lime" : "magenta"} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {conectado ? (
          <p className="text-muted-foreground">O celular está conectado ao Z-API.</p>
        ) : !aberto ? (
          <Button onClick={() => setAberto(true)}>
            <QrCode className="mr-1 h-4 w-4" /> Conectar
          </Button>
        ) : qr.isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando o QR Code…
          </p>
        ) : qr.isError ? (
          <p className="text-destructive">{mensagemErro(qr.error)}</p>
        ) : qr.data?.erro ? (
          <p className="text-destructive">{qr.data.erro}</p>
        ) : qr.data?.imagem ? (
          <div className="flex flex-wrap items-start gap-4">
            <img src={qr.data.imagem} alt="QR Code do WhatsApp" className="h-56 w-56 rounded border bg-white p-2" />
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>No celular da empresa, abra o WhatsApp Business.</li>
              <li>Toque em Aparelhos conectados › Conectar aparelho.</li>
              <li>Aponte para este código. Ele se renova sozinho a cada 20 segundos.</li>
              <li>Quando conectar, este quadro fecha sozinho.</li>
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Corrige mensagens antigas que ficaram sem texto ("[sistema]"). Só administrador. */
export function ReprocessarSemTexto() {
  const { roles } = useAuth() as unknown as { roles?: string[] };
  const reprocessar = useServerFn(reprocessarMensagensSemTexto);
  const qc = useQueryClient();
  const [rodando, setRodando] = useState(false);
  if (!roles?.includes("admin")) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={rodando}
      onClick={async () => {
        setRodando(true);
        try {
          const r = await reprocessar();
          toast.success(
            r.corrigidas === 0
              ? "Nenhuma mensagem sem texto para corrigir."
              : `${r.corrigidas} mensagem(ns) corrigida(s).`,
          );
          void qc.invalidateQueries({ queryKey: ["wa-caixa-conversas"] });
          void qc.invalidateQueries({ queryKey: ["wa-caixa-mensagens"] });
        } catch (e) {
          toast.error(mensagemErro(e));
        } finally {
          setRodando(false);
        }
      }}
    >
      {rodando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wrench className="mr-1 h-4 w-4" />}
      Reprocessar mensagens sem texto
    </Button>
  );
}
