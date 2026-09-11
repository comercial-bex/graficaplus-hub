import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  chaveDoEvento,
  classificarEventoZapi,
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
 *   2. GRAVA O EVENTO CRU antes de processar, em whatsapp_webhook_eventos.
 *      Se o processamento falhar, o evento não se perde — e a chave única
 *      (provedor, external_id) barra o reenvio do Z-API.
 *   3. Processa pelo `type` do evento.
 *   4. Responde 200 quando terminou. Se a gravação do passo 2 falhar (banco
 *      fora), responde 500 para o Z-API tentar de novo — é a única falha em
 *      que reenviar ajuda.
 *
 * A gravação da mensagem é UMA função do banco (whatsapp_registrar_mensagem):
 * normaliza o telefone com a mesma regra das colunas geradas e resolve
 * cliente, lead e conversa de uma vez. Este arquivo não normaliza telefone —
 * foi exatamente o que o receptor antigo errou.
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

  const registro = await registrarEvento(payload);
  if (!registro.ok) return json(500, { ok: false, erro: "falha ao registrar o evento" });
  if (registro.jaProcessado) return json(200, { ok: true, value: true, duplicado: true });

  let resultado: Resposta = {};
  let erro: string | null = null;
  try {
    resultado = await tratar(evento, instancia.id);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  await supabaseAdmin
    .from("whatsapp_webhook_eventos")
    .update({ processado_em: erro ? null : new Date().toISOString(), erro })
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
  return json(200, { ok: true, value: true, tipo: evento.tipo, ...resultado });
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

async function tratar(evento: EventoZapi, instanciaId: string): Promise<Resposta> {
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
      // O evento cru já está em whatsapp_webhook_eventos; na mensagem fica o
      // ponteiro. Fora da chamada para o objeto dela não ter chave aninhada —
      // senão tests/rpc-assinaturas desiste de conferir os parâmetros.
      const ponteiro = { fonte: "whatsapp_webhook_eventos", chave: `msg:${evento.messageId}` };
      const { data, error } = await (supabaseAdmin.rpc as any)("whatsapp_registrar_mensagem", {
        p_instancia_id: instanciaId,
        p_zapi_message_id: evento.messageId,
        p_telefone: evento.telefone,
        p_direcao: evento.deMim ? "saida" : "entrada",
        p_tipo: evento.tipoMensagem,
        p_texto: evento.texto,
        p_legenda: evento.legenda,
        p_media_url: evento.midia?.url ?? null,
        p_nome_contato: evento.deMim ? null : evento.nome,
        p_payload: ponteiro,
        p_momento: evento.momento?.toISOString() ?? null,
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
      if (gravada.duplicada || !evento.midia || !gravada.mensagem_id || !gravada.conversa_id) {
        return { mensagem: gravada };
      }

      // A mensagem já está gravada com o link do Z-API. Guardar a cópia é
      // bônus: se falhar, a mensagem fica e o motivo vai para a resposta.
      try {
        await guardarMidia(evento.midia, {
          instanciaId,
          mensagemId: gravada.mensagem_id,
          conversaId: gravada.conversa_id,
          clienteId: gravada.cliente_id ?? null,
          osId: gravada.os_id ?? null,
        });
        return { mensagem: gravada, midia: "guardada" };
      } catch (e) {
        return { mensagem: gravada, midia_erro: e instanceof Error ? e.message : String(e) };
      }
    }
  }
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

/**
 * Copia a mídia do Z-API para o nosso armazenamento. O link deles vale 30
 * dias; arte que o cliente mandou no WhatsApp não pode sumir do histórico da
 * OS um mês depois.
 */
async function guardarMidia(
  midia: Midia,
  ctx: { instanciaId: string; mensagemId: string; conversaId: string; clienteId: string | null; osId: string | null },
) {
  if (!/^https:\/\//i.test(midia.url)) throw new Error("link de mídia não é https");

  const resposta = await fetch(midia.url);
  if (!resposta.ok) throw new Error(`Z-API devolveu ${resposta.status} ao baixar a mídia`);

  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > LIMITE_MIDIA_BYTES) throw new Error("mídia acima de 16 MB — ficou só o link");
  const corpo = await resposta.arrayBuffer();
  if (corpo.byteLength > LIMITE_MIDIA_BYTES) throw new Error("mídia acima de 16 MB — ficou só o link");

  const tipo = (midia.mimeType ?? resposta.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim();
  const nomeOriginal = midia.nomeArquivo?.replace(/[^\w.\-]+/g, "_") ?? null;
  const extensao = nomeOriginal?.includes(".") ? null : (EXTENSAO[tipo] ?? "bin");
  const nome = nomeOriginal ?? `${ctx.mensagemId}.${extensao}`;
  const caminho = `${ctx.instanciaId}/${ctx.conversaId}/${Date.now()}-${nome}`;

  const { error: erroUpload } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(caminho, corpo, { contentType: tipo, upsert: false });
  if (erroUpload) throw new Error(erroUpload.message);

  const { data: arquivo, error: erroArquivo } = await supabaseAdmin
    .from("arquivos")
    .insert({
      nome,
      caminho,
      bucket: BUCKET,
      mime_type: tipo,
      tamanho_bytes: corpo.byteLength,
      cliente_id: ctx.clienteId,
      os_id: ctx.osId,
      conversa_id: ctx.conversaId,
    } as never)
    .select("id")
    .single();
  if (erroArquivo) throw new Error(erroArquivo.message);

  const { error: erroMensagem } = await supabaseAdmin
    .from("whatsapp_mensagens")
    .update({
      storage_bucket: BUCKET,
      storage_path: caminho,
      arquivo_id: (arquivo as { id: string }).id,
    })
    .eq("id", ctx.mensagemId);
  if (erroMensagem) throw new Error(erroMensagem.message);
}
