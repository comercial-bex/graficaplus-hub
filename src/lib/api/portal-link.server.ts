/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: as funções portal_link_* não estão nos tipos gerados */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FORMATO_DO_CAMINHO,
  TAMANHO_MAXIMO_BYTES,
  bucketDoEnvio,
  caminhoDoEnvio,
  problemaNaMensagem,
  tipoDeEnvioValido,
  tipoDeMensagemValido,
  uuidBemFormado,
} from "@/domain/portal/envio-de-arquivo";
import {
  corpoDoPedido,
  credencialDoPedido,
  lerDoBanco,
  linkInvalido,
  pedidoInvalido,
  portaDoLink,
  portalIndisponivel,
  recusado,
  respostaPortal,
  type Corpo,
} from "@/lib/api/portal-comum.server";

/**
 * As cinco rotas do portal do cliente por link (`/publico/$token`).
 *
 *   GET  /api/portal/painel    as OS, artes, orçamentos e o que o cliente já mandou
 *   POST /api/portal/envio     {acao:"preparar"} → URL assinada para subir o arquivo
 *                              {acao:"confirmar"} → registra o que subiu
 *   POST /api/portal/arte      aprova a arte ou pede ajuste
 *   POST /api/portal/arquivo   URL assinada para ver/baixar arte, arquivo ou PDF
 *   POST /api/portal/mensagem  recado para a equipe
 *
 * RESPOSTAS (todas sem cache)
 *   200  o que a função do banco devolveu, com chaves escolhidas lá
 *   400  {erro:"pedido_invalido", mensagem}  corpo torto
 *   401  {erro:"link_invalido", mensagem}    sem token, mal formado, inválido,
 *                                            vencido ou cancelado — sem dizer qual
 *   404  {erro:"nao_encontrado"}             arquivo que não é deste cliente
 *   422  {erro:"recusado", mensagem}         o banco recusou com motivo escrito
 *   503  {erro:"portal_indisponivel"}        banco fora, chave de serviço
 *                                            ausente, armazenamento fora
 *
 * NUNCA 200 sem gravação: as rotas que escrevem só respondem 200 quando a
 * função do banco devolveu `ok: true` — é a gravação que gera o protocolo.
 */

/** Só estes dois buckets saem para leitura; comprovante não volta para o cliente. */
const BUCKETS_DE_LEITURA = new Set(["arquivos-clientes", "documentos-pdf"]);

/** Dez minutos: o bastante para abrir a arte no celular, pouco para circular. */
const VALIDADE_DA_URL_S = 600;

function texto(valor: unknown, padrao: string): string {
  return typeof valor === "string" && valor.trim() ? valor : padrao;
}

/**
 * Traduz a resposta de uma função `portal_link_*` que GRAVA: porta fechada →
 * 401; recusa → 422 com o motivo; resposta que este código não conhece → 503;
 * `null` quando gravou. (Banco fora já virou 503 antes de chegar aqui.)
 */
function negativaDoBanco(valor: Corpo): Response | null {
  const porta = portaDoLink(valor);
  if (porta === "fechada") return linkInvalido();
  if (porta !== "aberta") return portalIndisponivel();
  if (valor.ok === false) return recusado(texto(valor.mensagem, "Não foi possível concluir."));
  if (valor.ok !== true) return portalIndisponivel();
  return null;
}

/* ------------------------------------------------------------------------- */
/* GET /api/portal/painel                                                     */
/* ------------------------------------------------------------------------- */

export async function responderPainel(request: Request): Promise<Response> {
  const credencial = await credencialDoPedido(request);
  if (!credencial) return linkInvalido();

  const aberto = await lerDoBanco("portal_link_abrir", () =>
    (supabaseAdmin.rpc as any)("portal_link_abrir", { p_token_hash: credencial.hash }),
  );
  if (!aberto.ok) return portalIndisponivel();
  const porta = portaDoLink(aberto.valor);
  if (porta === "fechada") return linkInvalido();
  if (porta !== "aberta") return portalIndisponivel();
  // Repassa o jsonb como veio: este arquivo não escolhe coluna nem soma nada.
  return respostaPortal(200, aberto.valor);
}

/* ------------------------------------------------------------------------- */
/* POST /api/portal/envio                                                     */
/* ------------------------------------------------------------------------- */

export async function processarEnvio(request: Request): Promise<Response> {
  const credencial = await credencialDoPedido(request);
  if (!credencial) return linkInvalido();
  const corpo = await corpoDoPedido(request);
  if (!corpo) return pedidoInvalido("Pedido sem dados.");

  const tipo = corpo.tipo;
  if (!tipoDeEnvioValido(tipo)) return pedidoInvalido("Diga o que é o arquivo.");
  const osId = corpo.os_id ?? null;
  if (osId !== null && !uuidBemFormado(osId)) return pedidoInvalido("Pedido (OS) inválido.");
  const nome = typeof corpo.nome === "string" ? corpo.nome.trim() : "";
  if (!nome || nome.length > 200) return pedidoInvalido("Nome de arquivo inválido.");

  if (corpo.acao === "preparar") {
    const tamanho = Number(corpo.tamanho);
    if (!Number.isFinite(tamanho) || tamanho <= 0) return pedidoInvalido("O arquivo está vazio.");
    if (tamanho > TAMANHO_MAXIMO_BYTES)
      return pedidoInvalido("Arquivo grande demais para o portal.");

    const aberto = await lerDoBanco("portal_link_abrir_envio", () =>
      (supabaseAdmin.rpc as any)("portal_link_abrir_envio", {
        p_token_hash: credencial.hash,
        p_os_id: osId,
        p_tipo: tipo,
      }),
    );
    if (!aberto.ok) return portalIndisponivel();
    const negativa = negativaDoBanco(aberto.valor);
    if (negativa) return negativa;
    const clienteId = aberto.valor.cliente_id;
    if (!uuidBemFormado(clienteId)) return portalIndisponivel();

    // A pasta é montada AQUI, com o cliente que o banco tirou do link — nunca
    // com um id vindo do navegador. O banco confere de novo ao registrar.
    const caminho = caminhoDoEnvio({ clienteId, osId, nome });
    const bucket = bucketDoEnvio(tipo);
    const assinatura = await assinarEnvio(bucket, caminho);
    if (!assinatura) return portalIndisponivel();
    return respostaPortal(200, { bucket, caminho, assinatura });
  }

  if (corpo.acao === "confirmar") {
    const caminho = corpo.caminho;
    if (typeof caminho !== "string" || !FORMATO_DO_CAMINHO.test(caminho)) {
      return pedidoInvalido("Caminho do arquivo inválido.");
    }
    const mensagem = typeof corpo.mensagem === "string" ? corpo.mensagem : null;
    if (mensagem && mensagem.length > 1000) {
      return pedidoInvalido("Mensagem longa demais: o limite é 1.000 caracteres.");
    }

    const registrado = await lerDoBanco("portal_link_registrar_envio", () =>
      (supabaseAdmin.rpc as any)("portal_link_registrar_envio", {
        p_token_hash: credencial.hash,
        p_os_id: osId,
        p_tipo: tipo,
        p_caminho: caminho,
        p_nome: nome,
        p_mensagem: mensagem,
      }),
    );
    if (!registrado.ok) return portalIndisponivel();
    const negativa = negativaDoBanco(registrado.valor);
    if (negativa) return negativa;
    const v = registrado.valor;
    return respostaPortal(200, {
      ok: true,
      protocolo: v.protocolo,
      os_numero: v.os_numero ?? null,
      tipo: v.tipo,
    });
  }

  return pedidoInvalido("Ação desconhecida.");
}

/* ------------------------------------------------------------------------- */
/* POST /api/portal/arte                                                      */
/* ------------------------------------------------------------------------- */

export async function processarArte(request: Request): Promise<Response> {
  const credencial = await credencialDoPedido(request);
  if (!credencial) return linkInvalido();
  const corpo = await corpoDoPedido(request);
  if (!corpo) return pedidoInvalido("Pedido sem dados.");

  const arquivoId = corpo.arquivo_id;
  if (!uuidBemFormado(arquivoId)) return pedidoInvalido("Arte inválida.");
  const decisao = corpo.decisao;
  if (decisao !== "aprovado" && decisao !== "ajuste") return pedidoInvalido("Decisão inválida.");
  const comentario = typeof corpo.comentario === "string" ? corpo.comentario : null;
  if (comentario && comentario.length > 1000) {
    return pedidoInvalido("Comentário longo demais: o limite é 1.000 caracteres.");
  }

  const decidido = await lerDoBanco("portal_link_decidir_arte", () =>
    (supabaseAdmin.rpc as any)("portal_link_decidir_arte", {
      p_token_hash: credencial.hash,
      p_arquivo_id: arquivoId,
      p_decisao: decisao,
      p_comentario: comentario,
    }),
  );
  if (!decidido.ok) return portalIndisponivel();
  const negativa = negativaDoBanco(decidido.valor);
  if (negativa) return negativa;
  const v = decidido.valor;
  return respostaPortal(200, { ok: true, decisao: v.decisao, os_numero: v.os_numero ?? null });
}

/* ------------------------------------------------------------------------- */
/* POST /api/portal/arquivo                                                   */
/* ------------------------------------------------------------------------- */

export async function processarArquivo(request: Request): Promise<Response> {
  const credencial = await credencialDoPedido(request);
  if (!credencial) return linkInvalido();
  const corpo = await corpoDoPedido(request);
  if (!corpo) return pedidoInvalido("Pedido sem dados.");

  const tipo = corpo.tipo;
  if (tipo !== "arquivo" && tipo !== "documento") return pedidoInvalido("Tipo inválido.");
  const id = corpo.id;
  if (!uuidBemFormado(id)) return pedidoInvalido("Arquivo inválido.");
  const baixar = corpo.para === "baixar";

  const objeto = await lerDoBanco("portal_link_objeto", () =>
    (supabaseAdmin.rpc as any)("portal_link_objeto", {
      p_token_hash: credencial.hash,
      p_tipo: tipo,
      p_id: id,
    }),
  );
  if (!objeto.ok) return portalIndisponivel();
  const porta = portaDoLink(objeto.valor);
  if (porta === "fechada") return linkInvalido();
  if (porta !== "aberta") return portalIndisponivel();
  if (objeto.valor.ok !== true) {
    return respostaPortal(404, {
      erro: "nao_encontrado",
      mensagem: "Arquivo não encontrado entre os seus pedidos.",
    });
  }

  const { bucket, caminho, nome, mime } = objeto.valor;
  if (typeof bucket !== "string" || !BUCKETS_DE_LEITURA.has(bucket)) return portalIndisponivel();
  if (typeof caminho !== "string" || typeof nome !== "string") return portalIndisponivel();

  const url = await assinarLeitura(bucket, caminho, nome, baixar);
  if (!url) return portalIndisponivel();
  return respostaPortal(200, { url, nome, mime: typeof mime === "string" ? mime : null });
}

/* ------------------------------------------------------------------------- */
/* POST /api/portal/mensagem                                                  */
/* ------------------------------------------------------------------------- */

export async function processarMensagem(request: Request): Promise<Response> {
  const credencial = await credencialDoPedido(request);
  if (!credencial) return linkInvalido();
  const corpo = await corpoDoPedido(request);
  if (!corpo) return pedidoInvalido("Pedido sem dados.");

  const tipo = corpo.tipo;
  if (!tipoDeMensagemValido(tipo)) return pedidoInvalido("Escolha o assunto.");
  const osId = corpo.os_id ?? null;
  if (osId !== null && !uuidBemFormado(osId)) return pedidoInvalido("Pedido (OS) inválido.");
  const mensagem = typeof corpo.mensagem === "string" ? corpo.mensagem : "";
  const problema = problemaNaMensagem(mensagem);
  if (problema) return pedidoInvalido(problema);

  const gravado = await lerDoBanco("portal_link_enviar_mensagem", () =>
    (supabaseAdmin.rpc as any)("portal_link_enviar_mensagem", {
      p_token_hash: credencial.hash,
      p_os_id: osId,
      p_tipo: tipo,
      p_mensagem: mensagem,
    }),
  );
  if (!gravado.ok) return portalIndisponivel();
  const negativa = negativaDoBanco(gravado.valor);
  if (negativa) return negativa;
  const v = gravado.valor;
  return respostaPortal(200, { ok: true, protocolo: v.protocolo, os_numero: v.os_numero ?? null });
}

/* ------------------------------------------------------------------------- */
/* Armazenamento: só URL assinada, nunca leitura de conteúdo                  */
/* ------------------------------------------------------------------------- */

/**
 * A URL de envio vale para UM caminho, montado aqui. O cliente sobe o arquivo
 * direto para o Storage com ela — o arquivo não passa por este servidor.
 */
async function assinarEnvio(bucket: string, caminho: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(caminho);
    if (error || !data) {
      console.error("[portal] armazenamento recusou a URL de envio", error?.name ?? "sem resposta");
      return null;
    }
    return data.token;
  } catch {
    console.error("[portal] armazenamento fora ao preparar o envio");
    return null;
  }
}

async function assinarLeitura(
  bucket: string,
  caminho: string,
  nome: string,
  baixar: boolean,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(caminho, VALIDADE_DA_URL_S, baixar ? { download: nome } : undefined);
    if (error || !data?.signedUrl) {
      console.error(
        "[portal] armazenamento recusou a URL de leitura",
        error?.name ?? "sem resposta",
      );
      return null;
    }
    return data.signedUrl;
  } catch {
    console.error("[portal] armazenamento fora ao abrir o arquivo");
    return null;
  }
}
