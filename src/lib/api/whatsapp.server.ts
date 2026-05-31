import process from "node:process";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type JsonRecord = Record<string, unknown>;

type SendMessageInput = {
  instanciaId: string;
  conversaId?: string;
  phone: string;
  text?: string;
  imageUrl?: string;
  documentUrl?: string;
  fileName?: string;
  caption?: string;
  clienteId?: string;
  osId?: string;
  userId?: string;
};

type IncomingWebhookInput = {
  instanciaId?: string;
  instanceId?: string;
  phone?: string;
  from?: string;
  senderName?: string;
  contactName?: string;
  messageId?: string;
  message?: string;
  text?: { message?: string } | string;
  image?: { imageUrl?: string; mimeType?: string; caption?: string };
  document?: { documentUrl?: string; mimeType?: string; fileName?: string; caption?: string };
  audio?: { audioUrl?: string; mimeType?: string };
  video?: { videoUrl?: string; mimeType?: string; caption?: string };
  [key: string]: unknown;
};

const WHATSAPP_MEDIA_BUCKET = "whatsapp-midias";

function zapiConfig() {
  const baseUrl = process.env.ZAPI_BASE_URL ?? "https://api.z-api.io";
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;
  const accountToken = process.env.ZAPI_ACCOUNT_TOKEN;
  const instanceToken = process.env.ZAPI_INSTANCE_TOKEN;

  const missing = [
    ...(!clientToken ? ["ZAPI_CLIENT_TOKEN"] : []),
    ...(!instanceToken ? ["ZAPI_INSTANCE_TOKEN"] : []),
  ];
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(", ")} server environment variable(s)`);
  }

  return { baseUrl, clientToken, accountToken, instanceToken };
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function zapiHeaders() {
  const { clientToken, accountToken } = zapiConfig();
  return {
    "content-type": "application/json",
    "client-token": clientToken,
    ...(accountToken ? { authorization: `Bearer ${accountToken}` } : {}),
  };
}

async function getInstance(instanceId: string) {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_instancias" as never)
    .select("*" as never)
    .eq("id" as never, instanceId)
    .single();

  if (error || !data) throw new Error(error?.message ?? "Instância WhatsApp não encontrada");
  return data as unknown as { id: string; zapi_instance_id: string };
}

async function zapiPost(instanceId: string, path: string, body: JsonRecord) {
  const instance = await getInstance(instanceId);
  const { baseUrl, instanceToken } = zapiConfig();
  const url = `${baseUrl}/instances/${instance.zapi_instance_id}/token/${instanceToken}${path}`;

  const response = await fetch(url, {
    method: "POST",
    headers: zapiHeaders(),
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let payload: unknown = responseText;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    // Z-API may return plain text on errors.
  }

  if (!response.ok) {
    throw new Error(`Z-API ${response.status}: ${responseText}`);
  }

  return payload as JsonRecord;
}

async function logWhatsapp(data: JsonRecord) {
  await supabaseAdmin.from("whatsapp_logs" as never).insert(data as never);
}

export async function resolveCustomerByPhone(phone: string, contactName?: string) {
  const normalized = normalizePhone(phone);

  const { data: cliente } = await supabaseAdmin
    .from("clientes")
    .select("id,nome,telefone")
    .eq("telefone_normalizado" as never, normalized as never)
    .maybeSingle();

  if (cliente) return { clienteId: cliente.id, leadId: null, nome: cliente.nome as string };

  const { data: existingLead } = await supabaseAdmin
    .from("leads" as never)
    .select("id,nome" as never)
    .eq("telefone_normalizado" as never, normalized)
    .maybeSingle();

  if (existingLead) {
    const lead = existingLead as unknown as { id: string; nome: string };
    return { clienteId: null, leadId: lead.id, nome: lead.nome };
  }

  const { data: lead, error } = await supabaseAdmin
    .from("leads" as never)
    .insert({
      nome: contactName || `Lead WhatsApp ${normalized}`,
      telefone: phone,
      origem: "whatsapp",
      interesse: "Atendimento iniciado via WhatsApp",
      status: "novo",
      temporario: true,
    } as never)
    .select("id,nome" as never)
    .single();

  if (error) throw new Error(error.message);
  const createdLead = lead as unknown as { id: string; nome: string };
  return { clienteId: null, leadId: createdLead.id, nome: createdLead.nome };
}

async function upsertConversation(input: {
  instanciaId: string;
  phone: string;
  contactName?: string;
  lastMessage?: string;
  unreadIncrement?: number;
  clienteId?: string | null;
  leadId?: string | null;
  osId?: string | null;
}) {
  const resolved =
    input.clienteId || input.leadId
      ? null
      : await resolveCustomerByPhone(input.phone, input.contactName);
  const clienteId = input.clienteId ?? resolved?.clienteId ?? null;
  const leadId = input.leadId ?? resolved?.leadId ?? null;
  const nomeContato = input.contactName ?? resolved?.nome ?? null;

  const { data: existing } = await supabaseAdmin
    .from("whatsapp_conversas" as never)
    .select("id,nao_lidas" as never)
    .eq("instancia_id" as never, input.instanciaId)
    .eq("telefone_normalizado" as never, normalizePhone(input.phone))
    .maybeSingle();

  if (existing) {
    const row = existing as unknown as { id: string; nao_lidas: number };
    const { data, error } = await supabaseAdmin
      .from("whatsapp_conversas" as never)
      .update({
        nome_contato: nomeContato,
        cliente_id: clienteId,
        lead_id: leadId,
        os_id: input.osId ?? null,
        ultima_mensagem: input.lastMessage ?? null,
        ultima_mensagem_at: new Date().toISOString(),
        nao_lidas: row.nao_lidas + (input.unreadIncrement ?? 0),
      } as never)
      .eq("id" as never, row.id)
      .select("*" as never)
      .single();
    if (error) throw new Error(error.message);
    return data as unknown as {
      id: string;
      cliente_id: string | null;
      lead_id: string | null;
      os_id: string | null;
    };
  }

  const { data, error } = await supabaseAdmin
    .from("whatsapp_conversas" as never)
    .insert({
      instancia_id: input.instanciaId,
      telefone: input.phone,
      nome_contato: nomeContato,
      cliente_id: clienteId,
      lead_id: leadId,
      os_id: input.osId ?? null,
      ultima_mensagem: input.lastMessage ?? null,
      ultima_mensagem_at: new Date().toISOString(),
      nao_lidas: input.unreadIncrement ?? 0,
    } as never)
    .select("*" as never)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as {
    id: string;
    cliente_id: string | null;
    lead_id: string | null;
    os_id: string | null;
  };
}

async function createOutgoingMessage(
  input: SendMessageInput & { type: "texto" | "imagem" | "documento"; response: JsonRecord },
) {
  const conversa = input.conversaId
    ? {
        id: input.conversaId,
        cliente_id: input.clienteId ?? null,
        lead_id: null,
        os_id: input.osId ?? null,
      }
    : await upsertConversation({
        instanciaId: input.instanciaId,
        phone: input.phone,
        lastMessage: input.text ?? input.caption ?? input.fileName ?? "Mídia enviada",
        clienteId: input.clienteId,
        osId: input.osId,
      });

  const messageId = String(input.response.messageId ?? input.response.id ?? "");
  const { data, error } = await supabaseAdmin
    .from("whatsapp_mensagens" as never)
    .insert({
      conversa_id: conversa.id,
      instancia_id: input.instanciaId,
      zapi_message_id: messageId || null,
      direcao: "saida",
      tipo: input.type,
      status: "enviada",
      texto: input.text ?? null,
      legenda: input.caption ?? null,
      media_url: input.imageUrl ?? input.documentUrl ?? null,
      cliente_id: conversa.cliente_id,
      os_id: conversa.os_id,
      payload: input.response,
      enviada_por: input.userId ?? null,
      enviado_em: new Date().toISOString(),
    } as never)
    .select("id" as never)
    .single();

  if (error) throw new Error(error.message);
  await logWhatsapp({
    instancia_id: input.instanciaId,
    conversa_id: conversa.id,
    mensagem_id: (data as { id: string }).id,
    tipo: `envio_${input.type}`,
    sucesso: true,
    response: input.response,
  });
  return {
    conversaId: conversa.id,
    mensagemId: (data as { id: string }).id,
    zapiMessageId: messageId || null,
  };
}

export async function sendWhatsAppText(input: SendMessageInput) {
  const response = await zapiPost(input.instanciaId, "/send-text", {
    phone: normalizePhone(input.phone),
    message: input.text,
  });
  return createOutgoingMessage({ ...input, type: "texto", response });
}

export async function sendWhatsAppImage(input: SendMessageInput) {
  const response = await zapiPost(input.instanciaId, "/send-image", {
    phone: normalizePhone(input.phone),
    image: input.imageUrl,
    caption: input.caption,
  });
  return createOutgoingMessage({ ...input, type: "imagem", response });
}

export async function sendWhatsAppDocument(input: SendMessageInput) {
  const response = await zapiPost(input.instanciaId, "/send-document", {
    phone: normalizePhone(input.phone),
    document: input.documentUrl,
    fileName: input.fileName,
    caption: input.caption,
  });
  return createOutgoingMessage({ ...input, type: "documento", response });
}

async function persistRemoteMedia(params: {
  url?: string;
  instanciaId: string;
  conversaId: string;
  clienteId?: string | null;
  osId?: string | null;
  fileName?: string;
  mimeType?: string;
}) {
  if (!params.url) return { storagePath: null, arquivoId: null };

  const response = await fetch(params.url);
  if (!response.ok) throw new Error(`Falha ao baixar mídia recebida: ${response.status}`);
  const contentType =
    params.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream";
  const extension = params.fileName?.split(".").pop() || contentType.split("/").pop() || "bin";
  const fileName = params.fileName ?? `${crypto.randomUUID()}.${extension}`;
  const storagePath = `${params.instanciaId}/${params.conversaId}/${Date.now()}-${fileName}`;
  const body = await response.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(WHATSAPP_MEDIA_BUCKET)
    .upload(storagePath, body, { contentType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data: arquivo, error: arquivoError } = await supabaseAdmin
    .from("arquivos")
    .insert({
      os_id: params.osId ?? null,
      cliente_id: params.clienteId ?? null,
      nome: fileName,
      caminho: storagePath,
      mime_type: contentType,
      tamanho_bytes: body.byteLength,
    })
    .select("id")
    .single();
  if (arquivoError) throw new Error(arquivoError.message);

  return { storagePath, arquivoId: arquivo.id };
}

function incomingText(payload: IncomingWebhookInput) {
  if (typeof payload.text === "string") return payload.text;
  return (
    payload.message ??
    payload.text?.message ??
    payload.image?.caption ??
    payload.document?.caption ??
    payload.video?.caption ??
    null
  );
}

function incomingMedia(payload: IncomingWebhookInput) {
  if (payload.image?.imageUrl)
    return {
      type: "imagem" as const,
      url: payload.image.imageUrl,
      mimeType: payload.image.mimeType,
    };
  if (payload.document?.documentUrl)
    return {
      type: "documento" as const,
      url: payload.document.documentUrl,
      mimeType: payload.document.mimeType,
      fileName: payload.document.fileName,
    };
  if (payload.video?.videoUrl)
    return {
      type: "video" as const,
      url: payload.video.videoUrl,
      mimeType: payload.video.mimeType,
    };
  if (payload.audio?.audioUrl)
    return {
      type: "audio" as const,
      url: payload.audio.audioUrl,
      mimeType: payload.audio.mimeType,
    };
  return null;
}

export async function handleIncomingMessageWebhook(payload: IncomingWebhookInput) {
  const instanciaId = payload.instanciaId ?? payload.instanceId;
  const phone = payload.phone ?? payload.from;
  if (!instanciaId || !phone) throw new Error("Webhook sem instanciaId ou telefone");

  const text = incomingText(payload);
  const media = incomingMedia(payload);
  const conversa = await upsertConversation({
    instanciaId,
    phone,
    contactName: payload.senderName ?? payload.contactName,
    lastMessage: text ?? (media ? "Mídia recebida" : "Mensagem recebida"),
    unreadIncrement: 1,
  });
  const stored = await persistRemoteMedia({
    url: media?.url,
    instanciaId,
    conversaId: conversa.id,
    clienteId: conversa.cliente_id,
    osId: conversa.os_id,
    fileName: media?.fileName,
    mimeType: media?.mimeType,
  });

  const { data, error } = await supabaseAdmin
    .from("whatsapp_mensagens" as never)
    .insert({
      conversa_id: conversa.id,
      instancia_id: instanciaId,
      zapi_message_id: payload.messageId ?? null,
      direcao: "entrada",
      tipo: media?.type ?? "texto",
      status: "recebida",
      texto: text,
      legenda:
        payload.image?.caption ?? payload.document?.caption ?? payload.video?.caption ?? null,
      media_url: media?.url ?? null,
      storage_bucket: stored.storagePath ? WHATSAPP_MEDIA_BUCKET : null,
      storage_path: stored.storagePath,
      arquivo_id: stored.arquivoId,
      cliente_id: conversa.cliente_id,
      os_id: conversa.os_id,
      payload: payload as JsonRecord,
      recebido_em: new Date().toISOString(),
    } as never)
    .select("id" as never)
    .single();

  if (error) throw new Error(error.message);
  await logWhatsapp({
    instancia_id: instanciaId,
    conversa_id: conversa.id,
    mensagem_id: (data as { id: string }).id,
    tipo: "webhook_mensagem",
    sucesso: true,
    request: payload as JsonRecord,
  });
  return { conversaId: conversa.id, mensagemId: (data as { id: string }).id };
}

export async function handleMessageStatusWebhook(payload: {
  instanciaId?: string;
  instanceId?: string;
  messageId: string;
  status: string;
  [key: string]: unknown;
}) {
  const instanciaId = payload.instanciaId ?? payload.instanceId;
  if (!instanciaId) throw new Error("Webhook sem instanciaId");
  const statusMap: Record<string, string> = {
    SENT: "enviada",
    DELIVERED: "entregue",
    READ: "lida",
    FAILED: "falha",
    sent: "enviada",
    delivered: "entregue",
    read: "lida",
    failed: "falha",
  };
  const status = statusMap[payload.status] ?? payload.status;
  const timestampColumn =
    status === "entregue" ? "entregue_em" : status === "lida" ? "lido_em" : null;

  const updatePayload: JsonRecord = { status, payload };
  if (timestampColumn) updatePayload[timestampColumn] = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("whatsapp_mensagens" as never)
    .update(updatePayload as never)
    .eq("instancia_id" as never, instanciaId)
    .eq("zapi_message_id" as never, payload.messageId)
    .select("id,conversa_id" as never)
    .maybeSingle();
  if (error) throw new Error(error.message);
  await logWhatsapp({
    instancia_id: instanciaId,
    mensagem_id: (data as { id?: string } | null)?.id,
    conversa_id: (data as { conversa_id?: string } | null)?.conversa_id,
    tipo: "webhook_status",
    sucesso: true,
    request: payload,
  });
  return { updated: Boolean(data) };
}

export async function handleConnectionWebhook(payload: {
  instanciaId?: string;
  instanceId?: string;
  connected?: boolean;
  status?: string;
  [key: string]: unknown;
}) {
  const instanciaId = payload.instanciaId ?? payload.instanceId;
  if (!instanciaId) throw new Error("Webhook sem instanciaId");
  const connected = payload.connected ?? payload.status === "connected";
  const status = connected
    ? "conectada"
    : payload.status === "connecting"
      ? "conectando"
      : "desconectada";
  const { error } = await supabaseAdmin
    .from("whatsapp_instancias" as never)
    .update({
      conectado: connected,
      status,
      ultimo_evento_at: new Date().toISOString(),
      metadados: payload,
    } as never)
    .eq("id" as never, instanciaId);
  if (error) throw new Error(error.message);
  await logWhatsapp({
    instancia_id: instanciaId,
    tipo: "webhook_conexao",
    sucesso: true,
    request: payload,
  });
  return { updated: true };
}
