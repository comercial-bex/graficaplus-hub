import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, Send } from "lucide-react";
import { toast } from "sonner";

/**
 * Gera o link que o cliente abre para aprovar a arte.
 *
 * O token só existe em claro nesta resposta — o banco guarda o hash. Fechar o
 * diálogo sem copiar significa gerar outro link, e gerar outro invalida este.
 * Por isso o link fica na tela até alguém copiar, em vez de sumir num toast.
 */
export function EnviarParaAprovacao({
  arquivoId,
  arquivoNome,
  osNumero,
  telefoneCliente,
  onGerado,
}: {
  arquivoId: string;
  arquivoNome: string;
  osNumero?: number | null;
  telefoneCliente?: string | null;
  onGerado?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState("7");
  const [link, setLink] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function gerar() {
    setGerando(true);
    const { data, error } = await (supabase.rpc as any)("criar_link_aprovacao", {
      p_arquivo_id: arquivoId,
      p_dias: Number(dias) || 7,
    });
    setGerando(false);
    if (error) return toast.error(error.message);
    const token = (data as { token: string }).token;
    setLink(`${window.location.origin}/aprovar/${token}`);
    onGerado?.();
  }

  async function copiar() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
    }
  }

  const mensagem = link
    ? `Olá! A arte do seu pedido${osNumero ? ` ${osNumero}` : ""} está pronta. ` +
      `Confira e aprove por aqui: ${link}`
    : "";

  // wa.me só aceita dígitos; sem telefone o botão não aparece em vez de abrir
  // o WhatsApp num número vazio.
  const digitos = (telefoneCliente ?? "").replace(/\D/g, "");
  const whatsapp =
    digitos.length >= 10
      ? `https://wa.me/${digitos.startsWith("55") ? digitos : `55${digitos}`}?text=${encodeURIComponent(mensagem)}`
      : null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setLink(null);
          setAberto(true);
        }}
      >
        <Send className="h-3.5 w-3.5 mr-1" /> Enviar p/ aprovação
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar arte para aprovação</DialogTitle>
            <DialogDescription>
              O cliente abre o link, vê a arte e aprova ou pede ajuste — sem precisar de conta.
              A decisão fica registrada e a OS anda sozinha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Arte:</span>{" "}
              <span className="font-medium">{arquivoNome}</span>
            </div>

            {!link ? (
              <div>
                <Label htmlFor="dias-validade">Validade do link</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="dias-validade"
                    type="number"
                    min="1"
                    max="60"
                    className="w-24"
                    value={dias}
                    onChange={(e) => setDias(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="link-aprovacao">Link para enviar</Label>
                  <div className="flex gap-2">
                    <Input id="link-aprovacao" readOnly value={link} onFocus={(e) => e.target.select()} />
                    <Button variant="outline" size="icon" onClick={copiar} aria-label="Copiar link">
                      {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Copie agora: o link não é recuperável depois. Gerar outro cancela este.
                </p>
                {whatsapp && (
                  <Button asChild className="w-full">
                    <a href={whatsapp} target="_blank" rel="noreferrer">
                      Abrir no WhatsApp com a mensagem pronta
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              {link ? "Fechar" : "Cancelar"}
            </Button>
            {!link && (
              <Button onClick={gerar} disabled={gerando}>
                {gerando ? "Gerando…" : "Gerar link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
