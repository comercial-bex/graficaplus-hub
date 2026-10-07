import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { conferirCarrinho, type Carrinho } from "@/domain/catalogo/carrinho";
import {
  esperaEmTexto,
  mensagemDaCotacao,
  nomeBemFormado,
  pedidoDoCarrinho,
  telefoneBemFormado,
  type RespostaDaCotacao,
} from "@/domain/catalogo/cotacao";
import { linkDoWhatsapp } from "@/domain/catalogo/link-do-catalogo";
import { ErroDaVitrine, pedirCotacao } from "@/lib/catalogo-publico";

const CHAVE_DO_CONTATO = "bexprint:vitrine:contato";

/**
 * "Pedir cotação", no celular do cliente: nome e WhatsApp, o pedido fica
 * registrado na gráfica e o botão abre o WhatsApp com a lista pronta. Se o
 * registro não der (muitos pedidos, sem internet), o WhatsApp continua sendo
 * o caminho — o cliente nunca fica sem jeito de pedir.
 */
export function PedirCotacaoDialog({
  aberto,
  token,
  titulo,
  whatsapp,
  carrinho,
  onOpenChange,
  onRegistrado,
  onLinkInvalido,
}: {
  aberto: boolean;
  token: string;
  titulo: string;
  /** O WhatsApp da gráfica, só dígitos; `null` = sem número configurado. */
  whatsapp: string | null;
  carrinho: Carrinho;
  onOpenChange: (aberto: boolean) => void;
  onRegistrado: () => void;
  onLinkInvalido: () => void;
}) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resposta, setResposta] = useState<RespostaDaCotacao | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setResposta(null);
    try {
      const guardado = window.localStorage.getItem(CHAVE_DO_CONTATO);
      if (guardado) {
        const c = JSON.parse(guardado) as { nome?: unknown; telefone?: unknown };
        if (typeof c.nome === "string") setNome(c.nome);
        if (typeof c.telefone === "string") setTelefone(c.telefone);
      }
    } catch {
      // Sem armazenamento: a pessoa digita de novo.
    }
  }, [aberto]);

  const problemas = useMemo(() => conferirCarrinho(carrinho), [carrinho]);
  const nomeOk = nomeBemFormado(nome);
  const telefoneOk = telefoneBemFormado(telefone);
  const pode =
    !!nomeOk && !!telefoneOk && problemas.length === 0 && carrinho.length > 0 && !enviando;
  const mensagem = mensagemDaCotacao(titulo, nomeOk ?? nome, carrinho);
  const linkWhatsapp = whatsapp ? linkDoWhatsapp(whatsapp, mensagem) : null;

  async function pedir() {
    if (!pode || !nomeOk || !telefoneOk) return;
    setEnviando(true);
    try {
      window.localStorage.setItem(CHAVE_DO_CONTATO, JSON.stringify({ nome: nomeOk, telefone }));
    } catch {
      // Sem armazenamento: segue.
    }
    try {
      const r = await pedirCotacao(token, pedidoDoCarrinho(nomeOk, telefoneOk, carrinho));
      setResposta(r);
    } catch (e) {
      if (e instanceof ErroDaVitrine && e.motivo === "link_invalido") {
        onOpenChange(false);
        onLinkInvalido();
        return;
      }
      setResposta({ estado: "fora_do_ar" });
    } finally {
      setEnviando(false);
    }
  }

  const registrado = resposta?.estado === "registrado";

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {registrado ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <MessageCircle className="h-5 w-5" />
            )}
            {registrado ? "Pedido registrado" : "Pedir cotação"}
          </DialogTitle>
          <DialogDescription>
            {registrado
              ? "A Bex Print já recebeu a sua lista. Para combinar valores e prazo, abra a conversa no WhatsApp — a mensagem já vai pronta."
              : `${carrinho.length === 1 ? "1 item" : `${carrinho.length} itens`} no carrinho. Diga seu nome e seu WhatsApp; a Bex Print responde por lá.`}
          </DialogDescription>
        </DialogHeader>

        {!registrado && (
          <div className="space-y-3">
            {problemas.length > 0 && (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  Acerte a quantidade no carrinho antes:
                  <ul className="mt-1 list-disc pl-4">
                    {problemas.map((p) => (
                      <li key={p.chave}>{p.mensagem}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cotacao-nome">Seu nome</Label>
              <Input
                id="cotacao-nome"
                value={nome}
                maxLength={120}
                autoComplete="name"
                onChange={(e) => setNome(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cotacao-telefone">Seu WhatsApp (com DDD)</Label>
              <Input
                id="cotacao-telefone"
                value={telefone}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(96) 99999-9999"
                onChange={(e) => setTelefone(e.target.value)}
                className="h-11"
              />
            </div>
            {resposta?.estado === "bloqueado" && (
              <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Muitos pedidos deste aparelho em pouco tempo. Tente de novo em{" "}
                  {esperaEmTexto(resposta.libera_s)} — ou mande direto pelo WhatsApp, com a lista
                  pronta.
                </span>
              </p>
            )}
            {resposta?.estado === "pedido_invalido" && (
              <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{" "}
                {resposta.mensagem}
              </p>
            )}
            {resposta?.estado === "fora_do_ar" && (
              <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Não deu para registrar o pedido agora. Mande direto pelo WhatsApp: a lista vai
                  pronta.
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {registrado ? (
            <>
              {linkWhatsapp && (
                <Button asChild className="h-12 w-full text-base sm:w-auto">
                  <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-2 h-5 w-5" /> Abrir o WhatsApp
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => {
                  onRegistrado();
                  onOpenChange(false);
                }}
              >
                Pronto
              </Button>
            </>
          ) : resposta && linkWhatsapp ? (
            <>
              <Button
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Voltar
              </Button>
              <Button asChild className="h-12 w-full text-base sm:w-auto">
                <a href={linkWhatsapp} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 h-5 w-5" /> Mandar pelo WhatsApp
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="h-11 w-full sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Voltar
              </Button>
              <Button
                className="h-12 w-full text-base sm:w-auto"
                disabled={!pode}
                onClick={() => void pedir()}
              >
                {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Pedir cotação
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
