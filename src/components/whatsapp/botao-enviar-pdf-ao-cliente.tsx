import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/bex/Dica";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import type { Permission } from "@/lib/permissions";
import { confirmarEnvioDoDocumento, enviarDocumentoAoCliente } from "@/lib/api/documento-whatsapp.functions";
import type { TipoDeDocumento } from "@/domain/whatsapp/envio-de-documento";
import {
  CLASSE_DO_BOTAO_PDF,
  ROTULO_DO_BOTAO_PDF,
  estadoDoBotaoPdf,
  type EstadoDoBotaoPdf,
  perguntaDoPdfQueFalhou,
} from "@/domain/whatsapp/enviar-pdf-na-tela";
import { acionarEnvio, useInstancias } from "@/components/whatsapp/usar-caixa-de-entrada";
import { enviarPdfAoCliente, type PdfGerado } from "@/components/whatsapp/fluxo-enviar-pdf-ao-cliente";

/**
 * "Enviar PDF ao cliente": UM botão, o mesmo efeito em todo lugar (passo 4 do orçamento, cabeçalho e
 * menu Mais da OS, tela do orçamento 3D, prévia do PDF na via do cliente e painel "Ligados a esta
 * conversa"). Todos chamam `enviarDocumentoAoCliente`; nada sai sem o clique de uma pessoa.
 *
 * - 44 px de altura e letra de 16 px; a Dica explica o que faz e, desligado, por quê.
 * - Sem permissão o botão não aparece; com o WhatsApp desconectado fica desligado com a Dica
 *   "Reconecte o WhatsApp no Monitor".
 * - Se o PDF falhar, no orçamento a tela PERGUNTA antes de mandar só o link.
 * - O aviso final diz o desfecho da linha da fila daquele envio (saiu, ainda na fila, não saiu).
 */

export type PropsDoBotaoPdf = {
  tipo: TipoDeDocumento;
  referenciaId: string;
  /** Número do documento na tela (orçamento, OS) ou o código da peça 3D. */
  numero: string | number;
  /** Quem monta o PDF da via do cliente. Padrão: gera no navegador (`gerarPDFDoClienteParaEnvio`). */
  gerarPdf?: () => Promise<PdfGerado>;
  /** Só o painel da conversa: manda NESTA conversa e confere a conexão DELA. */
  conversaId?: string;
  instanciaId?: string | null;
  /** A prévia ainda está montando o arquivo. */
  esperandoODocumento?: boolean;
  /** Depois do envio (saiu ou ficou na fila). */
  aoEnviar?: () => void;
};

export type VisualDoBotaoPdf = {
  variant?: "default" | "outline" | "secondary";
  className?: string;
  rotulo?: string;
};

export type EnvioDoPdf = {
  estado: EstadoDoBotaoPdf;
  enviando: boolean;
  enviar: () => Promise<void>;
  /** A pergunta "Mandar só o link?" (só o orçamento pergunta). Precisa estar na tela junto do botão. */
  dialogo: ReactNode;
};

/**
 * Toda a lógica do botão. A OS usa o hook direto porque o MESMO envio serve ao botão do computador e
 * ao item do menu Mais do celular, com um só estado de "enviando".
 */
export function useEnviarPdfAoCliente({
  tipo,
  referenciaId,
  numero,
  gerarPdf,
  conversaId,
  instanciaId,
  esperandoODocumento,
  aoEnviar,
}: PropsDoBotaoPdf) {
  const { hasPermission, nivelDeVisao } = useAuth();
  const qc = useQueryClient();
  const instancias = useInstancias();
  const [enviando, setEnviando] = useState(false);
  const [pergunta, setPergunta] = useState<{ titulo: string; texto: string } | null>(null);
  const resposta = useRef<((soOLink: boolean) => void) | null>(null);

  const estado = estadoDoBotaoPdf({
    tipo,
    tem: (p) => hasPermission(p as Permission),
    // Carregando ou com erro de leitura: `undefined`, que NÃO desliga o botão (o servidor confere).
    instancias: instancias.data,
    instanciaId,
    enviando,
    esperandoODocumento,
  });

  function perguntarSoOLink(motivo: string): Promise<boolean> {
    return new Promise((resolver) => {
      resposta.current = resolver;
      setPergunta(perguntaDoPdfQueFalhou(motivo));
    });
  }

  function responder(soOLink: boolean) {
    setPergunta(null);
    resposta.current?.(soOLink);
    resposta.current = null;
  }

  async function enviar() {
    if (enviando || !estado.ligado) return;
    setEnviando(true);
    try {
      const r = await enviarPdfAoCliente({
        tipo,
        referenciaId,
        numero,
        conversaId,
        gerarPdf:
          gerarPdf ??
          (async () => {
            const { gerarPDFDoClienteParaEnvio } = await import("@/lib/pdf/generate");
            return gerarPDFDoClienteParaEnvio({ tipo, referenciaId, nivelDeVisao });
          }),
        perguntarSoOLink,
        enviar: (pedido) => enviarDocumentoAoCliente({ data: pedido }),
        acionar: acionarEnvio,
        confirmar: (pedido) => confirmarEnvioDoDocumento({ data: pedido }),
      });
      if (r.cancelado) {
        toast.info(r.motivo);
        return;
      }
      const { tom, texto } = r.desfecho;
      if (tom === "sucesso") toast.success(texto);
      else if (tom === "aviso") toast.warning(texto);
      else toast.error(texto);
      for (const aviso of r.avisos) toast.warning(aviso);
      aoEnviar?.();
      // O que mudou com o envio: status e enviado_em do orçamento, histórico de PDFs, conversa.
      for (const chave of [
        ["orcamento", referenciaId],
        ["orcamentos"],
        ["documentos-gerados", tipo, referenciaId],
        ["envio-dos-documentos", tipo, referenciaId],
        ["wa-caixa-vinculos"],
        ["wa-caixa-mensagens"],
      ]) {
        void qc.invalidateQueries({ queryKey: chave });
      }
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível enviar o PDF ao cliente"));
    } finally {
      setEnviando(false);
    }
  }

  const dialogo = (
    <AlertDialog open={pergunta !== null} onOpenChange={(aberto) => !aberto && responder(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg">{pergunta?.titulo}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">{pergunta?.texto}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" className="h-11 text-base" onClick={() => responder(false)}>
            Não enviar nada
          </Button>
          <Button type="button" className="h-11 text-base" onClick={() => responder(true)}>
            Mandar só o link
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { estado, enviando, enviar, dialogo };
}

/** O botão: 44 px, letra de 16 px, Dica. Sem permissão não aparece. */
export function BotaoEnviarPdfAoCliente({
  variant = "default",
  className,
  rotulo = ROTULO_DO_BOTAO_PDF,
  ...envio
}: PropsDoBotaoPdf & VisualDoBotaoPdf) {
  const { estado, enviando, enviar, dialogo } = useEnviarPdfAoCliente(envio);
  if (!estado.visivel) return null;
  return (
    <>
      <Dica texto={estado.dica}>
        <Button
          type="button"
          variant={variant}
          className={`${CLASSE_DO_BOTAO_PDF}${className ? ` ${className}` : ""}`}
          onClick={() => void enviar()}
          disabled={!estado.ligado}
          data-testid="enviar-pdf-ao-cliente"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {rotulo}
        </Button>
      </Dica>
      {dialogo}
    </>
  );
}

/**
 * O mesmo envio como item do menu "Mais" (celular). O motivo de estar desligado vai escrito embaixo,
 * porque a Dica não abre no toque. A OS nunca pergunta "só o link", então o diálogo não é preciso aqui.
 */
export function ItemDoMenuEnviarPdf({ envio, rotulo = ROTULO_DO_BOTAO_PDF }: { envio: EnvioDoPdf; rotulo?: string }) {
  const { estado, enviando, enviar } = envio;
  if (!estado.visivel) return null;
  return (
    <Dica texto={estado.dica} lado="left" className="flex w-full">
      <DropdownMenuItem
        className="min-h-11 w-full flex-col items-start gap-0.5 py-3 text-base"
        disabled={!estado.ligado}
        onSelect={() => void enviar()}
        data-testid="enviar-pdf-ao-cliente-menu"
      >
        <span className="flex items-center">
          {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          {rotulo}
        </span>
        {!estado.ligado && <span className="text-xs text-muted-foreground">{estado.dica}</span>}
      </DropdownMenuItem>
    </Dica>
  );
}
