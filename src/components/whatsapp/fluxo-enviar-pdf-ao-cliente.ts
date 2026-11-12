import {
  desfechoDoEnvioDoDocumento,
  type DesfechoDoDocumento,
  type RespostaDoAcionamento,
  type TipoDeDocumento,
} from "@/domain/whatsapp/envio-de-documento";
import type {
  PedidoDeConfirmacao,
  PedidoDeEnvioDoDocumento,
  ResultadoDaConfirmacao,
  ResultadoDoEnvioDoDocumento,
} from "@/lib/api/documento-whatsapp.functions";

/**
 * O caminho do clique em "Enviar PDF ao cliente", sem React: o que acontece, em que ordem, e o que a
 * tela diz no fim. Recebe de fora gerar o PDF, perguntar, enviar e acionar o despachante, para
 * provar com fakes (tests/enviar-pdf-ao-cliente-fluxo.test.ts) as garantias da tela:
 *
 *  1. PDF que falha NÃO vira envio de link em silêncio: no orçamento a tela PERGUNTA, e só manda o
 *     link se a pessoa disser sim. Na OS e no 3D não existe "só o link": para aí.
 *  2. O aviso final olha a linha da fila DAQUELE envio (`filaId`), nunca só o HTTP do despachante.
 *  3. Falha ao registrar o envio em `documentos_enviados` vira aviso à parte; não desfaz o envio.
 *  4. Status e enviado_em do orçamento só mudam depois que a linha da fila SAIU (o servidor confere a
 *     mensagem no banco); fila ou falha deixam o orçamento como estava.
 */

export type PdfGerado = { documentoId: string; numero: string | number };

export type DependenciasDoFluxo = {
  tipo: TipoDeDocumento;
  referenciaId: string;
  /** O número do documento na tela; vale quando não há PDF (só o link). */
  numero: string | number;
  /** Só o painel da conversa. */
  conversaId?: string;
  gerarPdf: () => Promise<PdfGerado>;
  /** Mostra a pergunta e devolve a resposta da pessoa: true = "Mandar só o link". */
  perguntarSoOLink: (motivo: string) => Promise<boolean>;
  enviar: (pedido: PedidoDeEnvioDoDocumento) => Promise<ResultadoDoEnvioDoDocumento>;
  acionar: () => Promise<RespostaDoAcionamento>;
  /** Só quando a linha da fila saiu: o orçamento passa a enviado e ganha enviado_em (no servidor). */
  confirmar: (pedido: PedidoDeConfirmacao) => Promise<ResultadoDaConfirmacao>;
};

export type DesfechoDoFluxo =
  | { cancelado: true; motivo: string }
  | {
      cancelado: false;
      desfecho: DesfechoDoDocumento;
      resultado: ResultadoDoEnvioDoDocumento;
      /** Avisos à parte (registro que falhou, por exemplo). */
      avisos: string[];
    };

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function enviarPdfAoCliente(d: DependenciasDoFluxo): Promise<DesfechoDoFluxo> {
  let pdf: PdfGerado | null = null;
  try {
    pdf = await d.gerarPdf();
  } catch (e) {
    const motivo = texto(e);
    if (d.tipo !== "orcamento") {
      // Só o orçamento tem o texto com o link de aprovação; OS e 3D sem PDF não têm o que mandar.
      throw new Error(`Não consegui montar o PDF: ${motivo.replace(/[\s.]+$/, "")}. Nada foi enviado.`);
    }
    const soOLink = await d.perguntarSoOLink(motivo);
    if (!soOLink) return { cancelado: true, motivo: "Nada foi enviado." };
  }

  const resultado = await d.enviar({
    tipo: d.tipo,
    referenciaId: d.referenciaId,
    documentoId: pdf ? pdf.documentoId : null,
    ...(d.conversaId ? { conversaId: d.conversaId } : {}),
  });

  const http = await d.acionar();
  const desfecho = desfechoDoEnvioDoDocumento(http, resultado.filaId, {
    tipo: d.tipo,
    numero: pdf?.numero ?? d.numero,
    comPdf: resultado.comPdf,
  });

  const avisos: string[] = [];
  if (!resultado.registro.ok) {
    avisos.push(
      `O envio foi feito, mas o sistema não conseguiu registrá-lo em Documentos enviados: ${resultado.registro.motivo.replace(/[\s.]+$/, "")}.`,
    );
  }
  if (desfecho.situacao === "saiu") {
    try {
      const c = await d.confirmar({ tipo: d.tipo, referenciaId: d.referenciaId, mensagemId: resultado.mensagemId });
      if (!c.ok) {
        avisos.push(
          `O PDF saiu, mas o sistema não conseguiu marcar o envio: ${c.motivo.replace(/[\s.]+$/, "")}. Confira o status do ${d.tipo === "orcamento" ? "orçamento" : "documento"}.`,
        );
      }
    } catch (e) {
      avisos.push(`O PDF saiu, mas o sistema não conseguiu marcar o envio: ${texto(e).replace(/[\s.]+$/, "")}.`);
    }
  } else if (d.tipo === "orcamento") {
    avisos.push("O orçamento continua como estava até o PDF sair pelo WhatsApp. Confira na conversa e, se saiu, marque como enviado.");
  }
  return { cancelado: false, desfecho, resultado, avisos };
}
