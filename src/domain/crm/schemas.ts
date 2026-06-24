import { z } from "zod";

export const converterLeadPayloadSchema = z.object({
  cliente_id: z.string().uuid().optional(),
  nome: z.string().min(1).optional(),
  empresa: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  documento: z.string().optional(),
});

export type ConverterLeadPayload = z.infer<typeof converterLeadPayloadSchema>;
