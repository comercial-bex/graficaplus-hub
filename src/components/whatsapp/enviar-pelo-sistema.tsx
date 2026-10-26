import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { enviarTextoPeloSistema } from "@/lib/api/whatsapp-texto.functions";
import { acionarEnvio } from "@/components/whatsapp/usar-caixa-de-entrada";

/**
 * "Enviar pelo sistema": manda o texto pelo WhatsApp da gráfica (Z-API), na conversa do número,
 * em vez de abrir o wa.me no celular de quem clicou. Some para quem não tem `whatsapp.reply`.
 */
export function BotaoEnviarPeloSistema({
  telefone,
  nome,
  texto,
  origem,
  rotulo = "Enviar pelo sistema",
  variant = "outline",
  size = "sm",
  onEnviado,
}: {
  telefone: string | null | undefined;
  nome?: string | null;
  texto: string;
  origem: string;
  rotulo?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm";
  onEnviado?: () => void;
}) {
  const { hasPermission } = useAuth();
  const [enviando, setEnviando] = useState(false);
  if (!hasPermission("whatsapp.reply") || !telefone?.trim() || !texto.trim()) return null;

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    try {
      await enviarTextoPeloSistema({ data: { telefone: telefone!, nome: nome ?? undefined, texto, origem } });
      const http = await acionarEnvio();
      if ("falhaDeRede" in http || http.status >= 400) {
        toast.warning("Entrou na fila de envio; o despachante manda em até 2 minutos.");
      } else {
        toast.success("Mensagem enviada pelo WhatsApp da gráfica.");
      }
      onEnviado?.();
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar pelo sistema"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={enviar} disabled={enviando}>
      {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
      {rotulo}
    </Button>
  );
}
