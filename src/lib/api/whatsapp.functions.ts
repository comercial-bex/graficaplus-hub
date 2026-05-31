import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

const sendBaseSchema = z.object({
  instanciaId: uuid,
  conversaId: uuid.optional(),
  phone: z.string().min(8),
  clienteId: uuid.optional(),
  osId: uuid.optional(),
});

const webhookSecretSchema = z.object({
  secret: z.string().min(1).optional(),
});

async function assertWebhookSecret(secret?: string) {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    throw new Error("Webhook WhatsApp não autorizado");
  }
}

export const enviarTextoWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(sendBaseSchema.extend({ text: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { sendWhatsAppText } = await import("./whatsapp.server");
    return sendWhatsAppText({ ...data, userId: context.userId });
  });

export const enviarImagemWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    sendBaseSchema.extend({ imageUrl: z.string().url(), caption: z.string().optional() }),
  )
  .handler(async ({ data, context }) => {
    const { sendWhatsAppImage } = await import("./whatsapp.server");
    return sendWhatsAppImage({ ...data, userId: context.userId });
  });

export const enviarDocumentoWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    sendBaseSchema.extend({
      documentUrl: z.string().url(),
      fileName: z.string().min(1),
      caption: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { sendWhatsAppDocument } = await import("./whatsapp.server");
    return sendWhatsAppDocument({ ...data, userId: context.userId });
  });

export const webhookMensagemRecebidaWhatsapp = createServerFn({ method: "POST" })
  .inputValidator(webhookSecretSchema.extend({ payload: z.record(z.unknown()) }))
  .handler(async ({ data }) => {
    await assertWebhookSecret(data.secret);
    const { handleIncomingMessageWebhook } = await import("./whatsapp.server");
    return handleIncomingMessageWebhook(data.payload);
  });

export const webhookStatusMensagemWhatsapp = createServerFn({ method: "POST" })
  .inputValidator(
    webhookSecretSchema.extend({
      payload: z.object({ messageId: z.string().min(1), status: z.string().min(1) }).passthrough(),
    }),
  )
  .handler(async ({ data }) => {
    await assertWebhookSecret(data.secret);
    const { handleMessageStatusWebhook } = await import("./whatsapp.server");
    return handleMessageStatusWebhook(data.payload);
  });

export const webhookConexaoWhatsapp = createServerFn({ method: "POST" })
  .inputValidator(webhookSecretSchema.extend({ payload: z.object({}).passthrough() }))
  .handler(async ({ data }) => {
    await assertWebhookSecret(data.secret);
    const { handleConnectionWebhook } = await import("./whatsapp.server");
    return handleConnectionWebhook(data.payload);
  });
