import { useEffect } from "react";
import { TITULO_DA_CAIXA, tituloDaAba } from "@/domain/whatsapp/moldura";

/**
 * Escreve "(3) WhatsApp · BEX PRINT OS" no título da aba do navegador, com o
 * número de conversas não lidas por quem olha (onda 1, 12/11/2026). Dono:
 * MOLDURA.
 *
 * Na saída restaura o título-base SÓ se `document.title` ainda for o que este
 * efeito escreveu: se o roteador já escreveu o título da próxima tela, ele não
 * é apagado.
 */
export function useTituloDaAba(naoLidas: number): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const escrito = tituloDaAba(naoLidas);
    document.title = escrito;
    return () => {
      if (document.title === escrito) document.title = TITULO_DA_CAIXA;
    };
  }, [naoLidas]);
}
