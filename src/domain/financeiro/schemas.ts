import { z } from "zod";

export const confirmarPagamentoSchema = z.object({
  parcela_id: z.string().uuid(),
  valor: z.string().regex(/^\d+(\.\d{1,2})?$/),
  meio: z.string().min(1),
  taxa: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  data: z.string().optional(),
  comprovante: z.string().url().optional(),
  referencia_externa: z.string().optional(),
});
