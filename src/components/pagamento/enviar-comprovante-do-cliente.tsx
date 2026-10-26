import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import { pedirEnvioDoComprovantePublico, registrarComprovantePublico } from "@/lib/api/orcamento-comprovante.functions";
import { problemaNoComprovante } from "@/domain/pagamento/comprovante";

/**
 * Página pública do orçamento: o cliente que pagou o Pix manda o comprovante aqui, sem login.
 * O arquivo vai para a pasta deste orçamento e a equipe vê no orçamento, na parte do Pix.
 */
export function EnviarComprovanteDoCliente({ token }: { token: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviados, setEnviados] = useState<string[]>([]);

  async function enviar(arquivo: File) {
    const dados = { nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size };
    const problema = problemaNoComprovante(dados);
    if (problema) return toast.error(problema);
    setEnviando(true);
    try {
      const pedido = await pedirEnvioDoComprovantePublico({ data: { token, ...dados } });
      const { error } = await supabase.storage.from("comprovantes").uploadToSignedUrl(pedido.caminho, pedido.token, arquivo, {
        contentType: arquivo.type,
      });
      if (error) throw error;
      await registrarComprovantePublico({ data: { token, caminho: pedido.caminho, ...dados } });
      setEnviados((l) => [...l, arquivo.name]);
      toast.success("Comprovante enviado. A gráfica vai conferir.");
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar o comprovante"));
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <Card data-testid="enviar-comprovante-do-cliente">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="font-medium">Já pagou? Envie o comprovante</p>
          <p className="text-sm text-muted-foreground">
            Uma foto da tela do banco ou o PDF do comprovante do Pix. A gráfica confere e dá baixa no seu pagamento.
          </p>
        </div>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void enviar(e.target.files[0])}
        />
        <Button type="button" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()}>
          {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
          {enviados.length > 0 ? "Enviar outro comprovante" : "Escolher o comprovante"}
        </Button>
        {enviados.map((n) => (
          <p key={n} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden /> {n} enviado
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
