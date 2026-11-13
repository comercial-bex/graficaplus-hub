import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MensagemDaCaixa } from "@/domain/whatsapp/caixa-de-entrada";
import { rotuloDoTique, tiqueDaMensagem } from "@/domain/whatsapp/linha-do-tempo";

/**
 * O tique da mensagem que a empresa mandou (relógio, um tique, dois tiques,
 * dois tiques azuis, alerta), com o nome para o leitor de tela. Dono: CONVERSA
 * (onda 1, 12/11/2026). A bolha usa; a linha da lista (MOLDURA) também.
 *
 * As cores vêm dos tokens --chat-* (src/styles.css, bloco da CONVERSA): o azul
 * do "lida" e o vermelho da falha foram conferidos com 4,5:1 ou mais na bolha
 * verde, na branca e no cartão, em claro e escuro. Mensagem do cliente: nada.
 */
export function TiqueDaMensagem({
  m,
  className,
}: {
  m: Pick<MensagemDaCaixa, "direcao" | "status">;
  className?: string;
}) {
  const tique = tiqueDaMensagem(m);
  if (!tique) return null;
  const Icone =
    tique === "relogio"
      ? Clock
      : tique === "enviada"
        ? Check
        : tique === "falha"
          ? AlertCircle
          : CheckCheck;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        tique === "lida" && "text-(--chat-tique-lida)",
        tique === "falha" && "text-(--chat-falha)",
        className,
      )}
      data-tique={tique}
    >
      <Icone className="h-4 w-4" aria-hidden />
      <span className="sr-only">{rotuloDoTique(tique)}</span>
    </span>
  );
}
