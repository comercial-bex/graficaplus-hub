import { z } from "zod";

export const whatsappWebhookSchema = z.object({
  external_id: z.string().min(1),
  telefone: z.string().min(8),
  mensagem: z.string().optional(),
  tipo: z.string().default("texto"),
  anexos: z.array(z.object({ url: z.string().url(), mime_type: z.string().optional() })).default([]),
});
