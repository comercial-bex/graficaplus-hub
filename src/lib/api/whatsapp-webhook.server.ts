/* eslint-disable @typescript-eslint/no-explicit-any -- `rpc as any`: funções fora dos tipos gerados; é a forma que tests/rpc-assinaturas lê */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  chaveDoEvento,
  classificarEventoZapi,
  eventoSemRegistro,
  type EventoZapi,
  type Midia,
} from "@/domain/whatsapp/evento-zapi";
import { hashDoSegredo, hashesIguais } from "@/domain/whatsapp/segredo-webhook";

/**
 * Receptor do webhook do Z-API — o endereço que se cola no painel deles.
 *
 * ORDEM DAS COISAS
 *   1. Confere quem chama: instância cadastrada + hash do segredo da URL.
 *      Sem hash cadastrado, recusa (o antigo aceitava tudo nesse caso).
 *   2. Devolve 200 SEM GRAVAR o que é só barulho: presença (fulano ficou
 *      online) e recibo de `status@broadcast` (a empresa viu um status). Em
 *      06/10/2026 eram 20 dos 46 eventos do histórico.
 *   3. GRAVA O EVENTO CRU antes de processar, em whatsapp_webhook_eventos.
 *      Se o processamento falhar, o evento não se perde — e a chave única
 *      (provedor, external_id) barra o reenvio do Z-API.
 *   4. Processa pelo `type` do evento.
 *   5. Responde 200 quando terminou. Se a gravação do passo 3 falhar (banco
 *      fora), responde 500 para o Z-API tentar de novo — é a única falha em
 *      que reenviar ajuda.
 *
 * A gravação da mensagem é UMA função do banco (whatsapp_registrar_mensagem):
 * normaliza o telefone com a mesma regra das colunas geradas e resolve
 * cliente, lead e conversa de uma vez. Este arquivo não normaliza telefone —
 * foi exatamente o que o receptor antigo errou.
 *
 * MÍDIA QUE FALHA DEIXA RASTRO (06/10/2026). A cópia da mídia é bônus: a
 * mensagem fica gravada com o link do Z-API mesmo que a cópia falhe. Mas
 * antes o motivo só voltava ao Z-API na resposta HTTP, que ninguém lê — e um
 * PDF de cliente ficou no bucket sem linha em `arquivos` e sem ponteiro na
 * mensagem, invisível. Agora o motivo vai para `whatsapp_mensagens.erro`,
 * para `whatsapp_webhook_eventos.erro` (o Monitor mostra "processado com
 * falha") e para `whatsapp_logs`; e `reprocessarMidia` refaz a cópia sem
 * duplicar o que já está no bucket.
 */

const BUCKET = "whatsapp-midias";
/** Mídia maior que isso fica só com o link do Z-API (vale por 30 dias). */
const LIMITE_MIDIA_BYTES = 16 * 1024 * 1024;

type Resposta = Record<string, unknown>;

function json(status: number, corpo: Resposta): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function saudeDoWebhook(): Response {
  // GET sem efeito colateral: prova que a rota está publicada, sem expor nada.
  return json(200, { ok: true, servico: "webhook do Z-API", metodo: "POST" });
}

export async function processarWebhookZapi(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { ok: false, erro: "corpo não é JSON" });
  }

  const evento = classificarEventoZapi(payload);
  if (!evento.instanceId) {
    return json(400, { ok: false, erro: "evento sem instanceId" });
  }

  const { data: instancia, error: erroInstancia } = await supabaseAdmin
    .from("whatsapp_instancias")
    .select("id, webhook_secret_hash, ativa")
    .eq("zapi_instance_id", evento.instanceId)
    .maybeSingle();
  if (erroInstancia) return json(500, { ok: false, erro: "falha ao consultar a instância" });
  if (!instancia) return json(404, { ok: false, erro: "instância não cadastrada no sistema" });
  if (!instancia.ativa) return json(410, { ok: false, erro: "instância desativada" });
  if (!instancia.webhook_secret_hash) {
    return json(401, { ok: false, erro: "gere a URL do webhook no sistema antes de conectar" });
  }
  if (!hashesIguais(await hashDoSegredo(token), instancia.webhook_secret_hash)) {
    return json(401, { ok: false, erro: "token inválido" });
  }

  // Barulho: 200 sem INSERT. Só depois de conferir o token — ninguém de fora
  // descobre nada pela resposta.
  const barulho = eventoSemRegistro(payload);
  if (barulho) return json(200, { ok: true, value: true, ignorado: barulho, registrado: false });

  const registro = await registrarEvento(payload);
  if (!registro.ok) return json(500, { ok: false, erro: "falha ao registrar o evento" });
  if (registro.jaProcessado) return json(200, { ok: true, value: true, duplicado: true });

  let resultado: Resposta = {};
  let erro: string | null = null;
  try {
    resultado = await tratar(evento, instancia.id, registro.id);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  // Processado com falha: a mensagem entrou, a mídia não. Fica processado_em
  // E o erro — é o estado que o Monitor mostra como "processado com falha".
  const falhaParcial =
    typeof resultado.midia_erro === "string"
      ? `cópia da mídia falhou: ${resultado.midia_erro}`
      : null;
  await supabaseAdmin
    .from("whatsapp_webhook_eventos")
    .update({ processado_em: erro ? null : new Date().toISOString(), erro: erro ?? falhaParcial })
    .eq("id", registro.id);

  // Toda chamada autenticada conta como sinal de vida da conexão: é o que a
  // tela mostra como "último evento recebido".
  await supabaseAdmin
    .from("whatsapp_instancias")
    .update({ ultimo_evento_at: new Date().toISOString() })
    .eq("id", instancia.id);

  if (erro) {
    // Evento gravado e não processado: o reenvio do Z-API reprocessa, porque
    // a checagem de repetido só barra o que tem processado_em.
    return json(500, { ok: false, erro });
  }

  // A assistente de IA (caixa v3): só para mensagem NOVA de cliente — nem eco
  // do celular, nem modelo de empresa, nem reenvio. Roda aqui dentro, com
  // teto de tempo, e nunca derruba o 200: a mensagem já está gravada.
  const alvo = alvoDoAssistente(evento, resultado);
  if (alvo) {
    try {
      const { assistenteSemDerrubar } = await import("@/lib/api/whatsapp-assistente.server");
      resultado.assistente = await assistenteSemDerrubar(alvo.conversaId, alvo.mensagemId);
    } catch (e) {
      resultado.assistente = { acao: "erro", erro: e instanceof Error ? e.message : String(e) };
    }
  }
  return json(200, { ok: true, value: true, tipo: evento.tipo, ...resultado });
}

/** A mensagem que a assistente deve olhar, ou `null`. */
export function alvoDoAssistente(
  evento: EventoZapi,
  resultado: Resposta,
): { conversaId: string; mensagemId: string } | null {
  if (evento.tipo !== "mensagem" || evento.deMim || evento.deModelo) return null;
  const m = resultado.mensagem as
    | { duplicada?: boolean; mensagem_id?: string; conversa_id?: string }
    | undefined;
  if (!m || m.duplicada || !m.mensagem_id || !m.conversa_id) return null;
  return { conversaId: m.conversa_id, mensagemId: m.mensagem_id };
}

async function registrarEvento(
  payload: unknown,
): Promise<{ ok: false } | { ok: true; id: string; jaProcessado: boolean }> {
  const chave = chaveDoEvento(payload);

  if (chave) {
    const { data: existente } = await supabaseAdmin
      .from("whatsapp_webhook_eventos")
      .select("id, processado_em")
      .eq("provedor", "zapi")
      .eq("external_id", chave)
      .maybeSingle();
    if (existente) {
      return { ok: true, id: existente.id, jaProcessado: existente.processado_em !== null };
    }
  }

  // external_id é NOT NULL. Evento sem chave derivável (tipo desconhecido sem
  // `momment`) ganha uma única: fica registrado, só não tem como barrar reenvio.
  const { data, error } = await supabaseAdmin
    .from("whatsapp_webhook_eventos")
    .insert({
      provedor: "zapi",
      external_id: chave ?? `sem-chave:${crypto.randomUUID()}`,
      payload: payload as never,
    })
    .select("id")
    .single();

  if (error) {
    // Duas entregas simultâneas: a outra ganhou a corrida da chave única.
    if (chave && /duplicate key|23505/.test(`${error.code} ${error.message}`)) {
      return { ok: true, id: "", jaProcessado: true };
    }
    return { ok: false };
  }
  return { ok: true, id: data.id, jaProcessado: false };
}

async function tratar(
  evento: EventoZapi,
  instanciaId: string,
  eventoId: string,
): Promise<Resposta> {
  switch (evento.tipo) {
    case "ignorado":
      return { ignorado: evento.motivo };

    case "conexao": {
      const { error } = await supabaseAdmin
        .from("whatsapp_instancias")
        .update({
          conectado: evento.conectado,
          status: evento.conectado ? "conectada" : "desconectada",
        })
        .eq("id", instanciaId);
      if (error) throw new Error(error.message);
      return { conectado: evento.conectado };
    }

    case "status": {
      // `rpc as any` (idioma do projeto): as funções novas ainda não estão nos
      // tipos gerados, e é essa forma que tests/rpc-assinaturas sabe ler.
      const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_registrar_status", {
        p_instancia_id: instanciaId,
        p_ids: evento.ids,
        p_status: evento.status,
        p_momento: evento.momento?.toISOString() ?? null,
      });
      if (error) throw new Error(error.message);
      return { recibo: data as Resposta };
    }

    case "mensagem": {
      // Eco de envio feito pela tela: o Z-API pode avisar o "fromMe" antes de
      // o consumidor gravar o zapi_message_id na mensagem pendente. Completa a
      // pendente em vez de criar uma segunda cópia na conversa.
      if (evento.deMim && evento.texto) {
        const completada = await completarPendente(
          instanciaId,
          evento.telefone,
          evento.texto,
          evento.messageId,
        );
        if (completada) return { mensagem: { duplicada: false, completou_pendente: completada } };
      }
      // O evento cru já está em whatsapp_webhook_eventos; na mensagem fica o
      // ponteiro. Fora da chamada para o objeto dela não ter chave aninhada —
      // senão tests/rpc-assinaturas desiste de conferir os parâmetros.
      const ponteiro = { fonte: "whatsapp_webhook_eventos", chave: `msg:${evento.messageId}` };
      const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_registrar_mensagem", {
        p_instancia_id: instanciaId,
        p_zapi_message_id: evento.messageId,
        p_telefone: evento.telefone,
        // fromMe sem fromApi: digitada no celular da empresa. É saída, e nunca
        // vira lead (a função do banco só abre lead para 'entrada').
        p_direcao: evento.deMim ? "saida" : "entrada",
        p_tipo: evento.tipoMensagem,
        p_texto: evento.texto,
        p_legenda: evento.legenda,
        p_media_url: evento.midia?.url ?? null,
        p_nome_contato: evento.deMim ? null : evento.nome,
        p_payload: ponteiro,
        p_momento: evento.momento?.toISOString() ?? null,
        // Mensagem de modelo (template de empresa) é automação, não gente:
        // entra na caixa, mas não abre lead nem atendimento.
        p_origem: evento.deModelo ? "automacao" : undefined,
      });
      if (error) throw new Error(error.message);

      const gravada = data as {
        duplicada: boolean;
        mensagem_id?: string;
        conversa_id?: string;
        cliente_id?: string | null;
        os_id?: string | null;
        lead_criado?: boolean;
      };
      if (!gravada.duplicada && gravada.mensagem_id && evento.deMim) {
        // Resposta dada pelo celular da empresa (notifySentByMe).
        await supabaseAdmin
          .from("whatsapp_mensagens")
          .update({ origem: "celular" } as never)
          .eq("id", gravada.mensagem_id);
      }
      if (gravada.duplicada || !evento.midia || !gravada.mensagem_id || !gravada.conversa_id) {
        return { mensagem: gravada };
      }

      // A mensagem já está gravada com o link do Z-API. Guardar a cópia é
      // bônus: se falhar, a mensagem fica e o motivo vai para a mensagem, para
      // o evento, para o log e para a resposta.
      const ctx = {
        instanciaId,
        mensagemId: gravada.mensagem_id,
        conversaId: gravada.conversa_id,
        clienteId: gravada.cliente_id ?? null,
        osId: gravada.os_id ?? null,
      };
      try {
        const copia = await guardarMidia(evento.midia, ctx);
        return { mensagem: gravada, midia: copia.reaproveitada ? "reaproveitada" : "guardada" };
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await registrarFalhaDeMidia(motivo, { ...ctx, eventoId, midia: evento.midia });
        return { mensagem: gravada, midia_erro: motivo };
      }
    }
  }
}

/** Procura a saída pendente (mesmo texto, mesma conversa, últimos 60 s) e a completa. */
async function completarPendente(
  instanciaId: string,
  telefone: string,
  texto: string,
  messageId: string,
): Promise<string | null> {
  const desde = new Date(Date.now() - 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .select("id, conversa:whatsapp_conversas!whatsapp_mensagens_conversa_id_fkey(telefone)")
    .eq("instancia_id", instanciaId)
    .eq("direcao", "saida")
    .eq("status", "pendente")
    .eq("texto", texto)
    .is("zapi_message_id", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(5);
  const fim = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "").slice(-8);
  const alvo = ((data ?? []) as { id: string; conversa: { telefone: string } | null }[]).find(
    (m) => fim(m.conversa?.telefone) === fim(telefone),
  );
  if (!alvo) return null;
  const { data: feita } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .update({ zapi_message_id: messageId, status: "enviada", enviado_em: new Date().toISOString() })
    .eq("id", alvo.id)
    .is("zapi_message_id", null)
    .select("id");
  return feita && feita.length > 0 ? alvo.id : null;
}

const EXTENSAO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
};

type ContextoDaMidia = {
  instanciaId: string;
  mensagemId: string;
  conversaId: string;
  clienteId: string | null;
  osId: string | null;
};

/** O nome do arquivo no bucket: o original limpo, ou o id da mensagem + extensão. */
function nomeDoArquivo(midia: Midia, tipo: string, mensagemId: string): string {
  const nomeOriginal = midia.nomeArquivo?.replace(/[^\w.-]+/g, "_") ?? null;
  const extensao = nomeOriginal?.includes(".") ? null : (EXTENSAO[tipo] ?? "bin");
  return nomeOriginal ?? `${mensagemId}.${extensao}`;
}

/** O que já existe no bucket para esta conversa: nome e tamanho de cada objeto. */
async function objetosDaConversa(prefixo: string): Promise<{ name: string; size: number }[]> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(prefixo, { limit: 1000 });
  if (error) {
    // Sem a lista, o pior que acontece é uma cópia a mais. Fica no log.
    console.warn("[whatsapp-webhook] não deu para listar o bucket", error.message);
    return [];
  }
  return (data ?? []).map((o) => ({
    name: o.name,
    size: Number((o.metadata as { size?: unknown } | null)?.size ?? 0),
  }));
}

/**
 * Copia a mídia do Z-API para o nosso armazenamento. O link deles vale 30
 * dias; arte que o cliente mandou no WhatsApp não pode sumir do histórico da
 * OS um mês depois.
 *
 * IDEMPOTENTE. Antes de baixar, lista `${instancia}/${conversa}/` no bucket: um
 * objeto com o mesmo nome e o mesmo tamanho é reaproveitado — nada de
 * segunda cópia quando a primeira tentativa subiu o arquivo e falhou depois
 * (foi o caso do PDF de 06/10/2026: 977.421 bytes no bucket, zero linhas em
 * `arquivos`). Se o link do Z-API já venceu e o objeto existe, vale o objeto.
 */
async function guardarMidia(
  midia: Midia,
  ctx: ContextoDaMidia,
): Promise<{ caminho: string; reaproveitada: boolean }> {
  if (!/^https:\/\//i.test(midia.url)) throw new Error("link de mídia não é https");

  const prefixo = `${ctx.instanciaId}/${ctx.conversaId}`;
  const existentes = await objetosDaConversa(prefixo);

  let resposta: Response | null = null;
  let erroDoLink: string;
  try {
    const r = await fetch(midia.url);
    if (r.ok) resposta = r;
    erroDoLink = `Z-API devolveu ${r.status} ao baixar a mídia`;
  } catch (e) {
    erroDoLink = `falha de rede ao baixar a mídia: ${e instanceof Error ? e.message : String(e)}`;
  }

  const tipo = (
    midia.mimeType ??
    resposta?.headers.get("content-type") ??
    "application/octet-stream"
  )
    .split(";")[0]
    .trim();
  const nome = nomeDoArquivo(midia, tipo, ctx.mensagemId);
  const candidato = existentes.find((o) => o.name.endsWith(`-${nome}`)) ?? null;

  let caminho: string;
  let tamanho: number;
  let reaproveitada = false;

  if (!resposta) {
    if (!candidato) throw new Error(erroDoLink);
    caminho = `${prefixo}/${candidato.name}`;
    tamanho = candidato.size;
    reaproveitada = true;
  } else {
    const declarado = Number(resposta.headers.get("content-length") ?? 0);
    if (declarado > LIMITE_MIDIA_BYTES) throw new Error("mídia acima de 16 MB — ficou só o link");
    if (candidato && declarado > 0 && candidato.size === declarado) {
      // Mesmo nome, mesmo tamanho: é a cópia da tentativa anterior.
      caminho = `${prefixo}/${candidato.name}`;
      tamanho = candidato.size;
      reaproveitada = true;
    } else {
      const corpo = await resposta.arrayBuffer();
      if (corpo.byteLength > LIMITE_MIDIA_BYTES) {
        throw new Error("mídia acima de 16 MB — ficou só o link");
      }
      if (candidato && candidato.size === corpo.byteLength) {
        caminho = `${prefixo}/${candidato.name}`;
        tamanho = candidato.size;
        reaproveitada = true;
      } else {
        caminho = `${prefixo}/${Date.now()}-${nome}`;
        tamanho = corpo.byteLength;
        const { error: erroUpload } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(caminho, corpo, { contentType: tipo, upsert: false });
        if (erroUpload) throw new Error(erroUpload.message);
      }
    }
  }

  // A linha de `arquivos` também é reaproveitada: uma por caminho.
  const { data: jaRegistrado, error: erroBusca } = await supabaseAdmin
    .from("arquivos")
    .select("id")
    .eq("bucket", BUCKET)
    .eq("caminho", caminho)
    .limit(1)
    .maybeSingle();
  if (erroBusca) throw new Error(erroBusca.message);

  let arquivoId = (jaRegistrado as { id: string } | null)?.id ?? null;
  if (!arquivoId) {
    const { data: arquivo, error: erroArquivo } = await supabaseAdmin
      .from("arquivos")
      .insert({
        nome,
        caminho,
        bucket: BUCKET,
        mime_type: tipo,
        tamanho_bytes: tamanho,
        cliente_id: ctx.clienteId,
        os_id: ctx.osId,
        conversa_id: ctx.conversaId,
      } as never)
      .select("id")
      .single();
    if (erroArquivo) throw new Error(erroArquivo.message);
    arquivoId = (arquivo as { id: string }).id;
  }

  const { error: erroMensagem } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .update({ storage_bucket: BUCKET, storage_path: caminho, arquivo_id: arquivoId, erro: null })
    .eq("id", ctx.mensagemId);
  if (erroMensagem) throw new Error(erroMensagem.message);

  return { caminho, reaproveitada };
}

/**
 * O rastro da cópia que falhou: na mensagem (a conversa mostra o motivo), no
 * evento (o Monitor mostra "processado com falha") e em `whatsapp_logs`.
 * Nenhuma dessas gravações pode derrubar o webhook — a mensagem já entrou.
 */
async function registrarFalhaDeMidia(
  motivo: string,
  ctx: ContextoDaMidia & { eventoId: string; midia: Midia },
): Promise<void> {
  const texto = `cópia da mídia falhou: ${motivo}`;
  const { error: erroMensagem } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .update({ erro: texto })
    .eq("id", ctx.mensagemId);
  if (erroMensagem)
    console.error("[whatsapp-webhook] falha ao anotar o erro na mensagem", erroMensagem.message);

  if (ctx.eventoId) {
    const { error: erroEvento } = await supabaseAdmin
      .from("whatsapp_webhook_eventos")
      .update({ erro: texto })
      .eq("id", ctx.eventoId);
    if (erroEvento)
      console.error("[whatsapp-webhook] falha ao anotar o erro no evento", erroEvento.message);
  }

  const { error: erroLog } = await supabaseAdmin.from("whatsapp_logs").insert({
    tipo: "erro",
    sucesso: false,
    erro: texto,
    instancia_id: ctx.instanciaId,
    conversa_id: ctx.conversaId,
    mensagem_id: ctx.mensagemId,
    request: {
      origem: "webhook_mensagem",
      evento_id: ctx.eventoId,
      media_url: ctx.midia.url,
      nome_arquivo: ctx.midia.nomeArquivo,
      mime_type: ctx.midia.mimeType,
    } as Json,
    response: null,
  });
  if (erroLog) console.error("[whatsapp-webhook] falha ao gravar o log da mídia", erroLog.message);
}

/**
 * Refaz a cópia da mídia de um evento já recebido — a ação "Reprocessar
 * mídia" do Monitor (quem tem whatsapp.manage; a permissão é conferida em
 * `whatsapp-midia.functions.ts`, antes de chegar aqui).
 *
 * Reaproveita o que já está no bucket (ver `guardarMidia`) e, quando dá
 * certo, limpa o erro do evento e da mensagem.
 */
export async function reprocessarMidia(
  eventoId: string,
): Promise<
  | { ok: true; caminho: string; reaproveitada: boolean; mensagem_id: string }
  | { ok: false; erro: string }
> {
  const { data: evento, error: erroEvento } = await supabaseAdmin
    .from("whatsapp_webhook_eventos")
    .select("id, payload")
    .eq("id", eventoId)
    .maybeSingle();
  if (erroEvento) return { ok: false, erro: `falha ao ler o evento: ${erroEvento.message}` };
  if (!evento) return { ok: false, erro: "evento não encontrado" };

  const classificado = classificarEventoZapi(evento.payload);
  if (classificado.tipo !== "mensagem" || !classificado.midia) {
    return { ok: false, erro: "este evento não é uma mensagem com mídia" };
  }

  const { data: instancia, error: erroInstancia } = await supabaseAdmin
    .from("whatsapp_instancias")
    .select("id")
    .eq("zapi_instance_id", classificado.instanceId)
    .maybeSingle();
  if (erroInstancia)
    return { ok: false, erro: `falha ao ler a instância: ${erroInstancia.message}` };
  if (!instancia) return { ok: false, erro: "a instância deste evento não está cadastrada" };

  const { data: mensagem, error: erroMensagem } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .select("id, conversa_id, cliente_id, os_id")
    .eq("instancia_id", instancia.id)
    .eq("zapi_message_id", classificado.messageId)
    .maybeSingle();
  if (erroMensagem) return { ok: false, erro: `falha ao ler a mensagem: ${erroMensagem.message}` };
  if (!mensagem) {
    return {
      ok: false,
      erro: "a mensagem deste evento não está gravada: reenvie o evento pelo Z-API",
    };
  }

  const ctx: ContextoDaMidia = {
    instanciaId: instancia.id,
    mensagemId: mensagem.id,
    conversaId: mensagem.conversa_id,
    clienteId: mensagem.cliente_id ?? null,
    osId: mensagem.os_id ?? null,
  };
  try {
    const copia = await guardarMidia(classificado.midia, ctx);
    const { error: erroLimpeza } = await supabaseAdmin
      .from("whatsapp_webhook_eventos")
      .update({ erro: null, processado_em: new Date().toISOString() })
      .eq("id", eventoId);
    if (erroLimpeza) {
      return {
        ok: false,
        erro: `a cópia foi feita, mas o evento não foi atualizado: ${erroLimpeza.message}`,
      };
    }
    return { ok: true, ...copia, mensagem_id: mensagem.id };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    await registrarFalhaDeMidia(motivo, { ...ctx, eventoId, midia: classificado.midia });
    return { ok: false, erro: motivo };
  }
}
