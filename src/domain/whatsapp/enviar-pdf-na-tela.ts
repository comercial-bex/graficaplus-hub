import {
  instanciaConectada,
  instanciaDoEnvio,
  podeEnviarDocumento,
  type InstanciaParaEnvio,
  type TipoDeDocumento,
} from "@/domain/whatsapp/envio-de-documento";
import { DICAS_DO_PDF_AO_CLIENTE } from "@/lib/dicas";

/**
 * O botão "Enviar PDF ao cliente" como a tela o decide (onda "PDF ao cliente", 12/11/2026). Regras
 * puras: a MESMA conferência de permissão do servidor (`podeEnviarDocumento`) e a mesma leitura da
 * conexão (`instanciaConectada`), para o botão não aparecer para quem o servidor recusa.
 */

export const ROTULO_DO_BOTAO_PDF = "Enviar PDF ao cliente";

/**
 * 44 px de altura e letra de 16 px (aqui text-base). O dono enxerga mal: nenhum destes botões pode
 * ficar com o tamanho padrão do Button (36 px e 15 px).
 */
export const CLASSE_DO_BOTAO_PDF = "h-11 min-w-11 text-base";

export type EstadoDoBotaoPdf = {
  /** Falta permissão: o botão nem aparece. */
  visivel: boolean;
  /** Aparece, mas desligado (sem conexão, ocupado, esperando o documento). */
  ligado: boolean;
  /** O texto da Dica, sempre presente: diz o que o botão faz ou por que está desligado. */
  dica: string;
};

export function estadoDoBotaoPdf(a: {
  tipo: TipoDeDocumento;
  tem: (permissao: string) => boolean;
  /**
   * As instâncias do WhatsApp como a tela leu. `undefined` (ainda carregando ou a leitura falhou)
   * NÃO desliga o botão: "não deu para conferir" não é "desconectado", e o servidor confere de novo.
   */
  instancias: readonly InstanciaParaEnvio[] | undefined;
  /** O painel da conversa manda NESTA conversa: vale a instância dela, não a escolha de uma conversa nova. */
  instanciaId?: string | null;
  enviando?: boolean;
  /** A prévia ainda está montando o arquivo. */
  esperandoODocumento?: boolean;
}): EstadoDoBotaoPdf {
  if (!podeEnviarDocumento(a.tipo, a.tem).pode) {
    return { visivel: false, ligado: false, dica: DICAS_DO_PDF_AO_CLIENTE[a.tipo] };
  }
  if (a.instancias !== undefined) {
    const instancia = a.instanciaId
      ? (a.instancias.find((i) => i.id === a.instanciaId) ?? null)
      : instanciaDoEnvio(a.instancias);
    if (!instanciaConectada(instancia)) {
      return { visivel: true, ligado: false, dica: DICAS_DO_PDF_AO_CLIENTE.desconectado };
    }
  }
  if (a.enviando) return { visivel: true, ligado: false, dica: DICAS_DO_PDF_AO_CLIENTE.enviando };
  if (a.esperandoODocumento) return { visivel: true, ligado: false, dica: DICAS_DO_PDF_AO_CLIENTE.esperando_o_pdf };
  return { visivel: true, ligado: true, dica: DICAS_DO_PDF_AO_CLIENTE[a.tipo] };
}

/** O que a pergunta "Mandar só o link?" diz quando a geração do PDF falha (só orçamento). */
export function perguntaDoPdfQueFalhou(motivo: string): { titulo: string; texto: string } {
  const limpo = motivo.replace(/[\s.]+$/, "").trim();
  return {
    titulo: "Não consegui montar o PDF",
    texto: `${limpo ? `${limpo}. ` : ""}Quer mandar só o texto com o link de aprovação, sem o PDF? Se não, nada é enviado.`,
  };
}
