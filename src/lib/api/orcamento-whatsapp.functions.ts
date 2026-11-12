import { brCodePix } from "@/domain/pagamento/pix";
import { BOTOES_DO_PIX, TEXTO_DOS_BOTOES_DO_PIX } from "@/domain/pagamento/botoes-do-pix";
import { mensagensDoPix, pedidoDeSinal } from "@/domain/pagamento/sinal";

/**
 * O Pix do SINAL que segue o orçamento na conversa do cliente (decisão do dono de 27/10/2026): o QR
 * Code com o valor e o copia e cola, pedindo o comprovante de volta. O comprovante que o cliente
 * manda pela mesma conversa é reconhecido pelo webhook e vira anexo do orçamento
 * (`anexar_comprovante_recebido`).
 *
 * Desde 12/11/2026 o orçamento em si sai por `enviarDocumentoAoCliente`
 * (`documento-whatsapp.functions.ts`), que chama `enviarPixDoSinal` daqui depois do PDF. A antiga
 * `enviarOrcamentoPeloSistema` saiu: aceitava qualquer arquivo com o prefixo da pasta do orçamento.
 */

export type Orc = {
  id: string;
  numero: number;
  titulo: string;
  contato_nome: string | null;
  contato_telefone: string | null;
  cliente_id: string | null;
  valor_total: number | string | null;
  condicao_pagamento: Record<string, unknown> | null;
};

/** Texto na mesma fila da caixa (a ordem de saída é a de criação). */
export async function enfileirarTexto(
  db: any,
  conversaId: string,
  usuarioId: string,
  texto: string,
  origem: string,
  extra?: Record<string, unknown>,
) {
  const { enfileirarMensagem } = await import("./whatsapp-fila.server");
  return enfileirarMensagem(db, { conversaId, usuarioId, texto, origem, extra });
}

/** O Pix do sinal: QR Code (imagem) com o copia e cola na legenda, na mesma conversa. */
export async function enviarPixDoSinal(
  db: any,
  orc: Orc,
  conversaId: string,
  clienteNome: string | null,
  usuarioId: string,
): Promise<{ enviado: boolean; valor: number; motivo: string | null }> {
  const { data: cfg } = await db.from("empresa_config").select("nome, razao_social, cidade, pix_chave").eq("id", true).maybeSingle();
  const chave = String(cfg?.pix_chave ?? "").trim();
  const pedido = pedidoDeSinal({
    total: Number(orc.valor_total ?? 0),
    condicao: orc.condicao_pagamento,
    chaveConfigurada: chave.length > 0,
  });
  if (!pedido.enviar) return { enviado: false, valor: 0, motivo: pedido.motivo };

  const empresa = String(cfg?.nome ?? cfg?.razao_social ?? "BEX PRINT");
  const copiaECola = brCodePix({
    chave,
    valor: pedido.valor,
    nome: empresa,
    cidade: String(cfg?.cidade ?? "Macapa"),
    identificador: `ORC${orc.numero}`,
  });
  const msgs = mensagensDoPix({
    cliente: clienteNome,
    valor: pedido.valor,
    numeroDoOrcamento: orc.numero,
    empresa,
    parcelas: pedido.parcelas,
    copiaECola,
  });

  // O QR Code nasce aqui (no servidor) e sobe para a pasta da conversa: o cliente lê com a câmera do banco.
  const mod: any = await import("qrcode");
  const toBuffer = mod.toBuffer ?? mod.default?.toBuffer;
  const png: Buffer = await toBuffer(copiaECola, { type: "png", width: 512, margin: 2 });
  const nomeArquivo = `pix-orcamento-${orc.numero}.png`;
  const destino = `caixa/${conversaId}/${Date.now()}-${nomeArquivo}`;
  const { error: erroSobe } = await db.storage
    .from("whatsapp-midias")
    .upload(destino, png, { contentType: "image/png", upsert: false });
  if (erroSobe) throw new Error(erroSobe.message);
  const { error } = await db.rpc("whatsapp_responder_arquivo", {
    p_conversa_id: conversaId,
    p_usuario: usuarioId,
    p_tipo: "imagem",
    p_storage_path: destino,
    p_nome_arquivo: nomeArquivo,
    p_legenda: msgs.legendaDoQr,
  });
  if (error) throw new Error(error.message);
  // Depois do QR Code: a apresentação e, SOZINHO, o código para copiar.
  await enfileirarTexto(db, conversaId, usuarioId, msgs.introducao, "pix_sinal");
  // O código vai SOZINHO e sem a assinatura de pessoa, para copiar com um toque.
  await enfileirarTexto(db, conversaId, usuarioId, msgs.codigo, "pix_sinal_codigo", { sem_assinatura: true });
  // E o menu: Já paguei / Ver orçamento / Falar com a equipe. Se o Z-API recusar botão, a fila manda
  // o mesmo menu como texto.
  await enfileirarTexto(db, conversaId, usuarioId, TEXTO_DOS_BOTOES_DO_PIX, "pix_sinal_botoes", {
    tipo: "botoes",
    sem_assinatura: true,
    botoes: BOTOES_DO_PIX.map(({ id, rotulo }) => ({ id, rotulo })),
  });

  // Fica registrado no orçamento: o que foi pedido, quando, e com qual código. É isso que o
  // webhook usa para reconhecer o comprovante e o que a tela mostra como "aguardando".
  // Relê a condição agora: a cópia do começo do envio pode ter ficado velha (outra pessoa editou no passo 3).
  const { data: atual } = await db.from("orcamentos").select("condicao_pagamento").eq("id", orc.id).maybeSingle();
  const condicao = { ...((atual?.condicao_pagamento ?? orc.condicao_pagamento) ?? {}) } as Record<string, unknown>;
  if (!String(condicao.forma ?? "").trim()) condicao.forma = "PIX";
  condicao.pix_enviado = { valor: pedido.valor, em: new Date().toISOString(), copia_e_cola: copiaECola };
  await db.from("orcamentos").update({ condicao_pagamento: condicao }).eq("id", orc.id);
  return { enviado: true, valor: pedido.valor, motivo: null };
}
