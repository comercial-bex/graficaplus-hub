import { z } from "zod";

export const converterOrcamentoOpcoesSchema = z.object({
  parcelas: z.number().int().positive().optional(),
  vencimento_primeira_parcela: z.string().optional(),
});

export type ConverterOrcamentoOpcoes = z.infer<typeof converterOrcamentoOpcoesSchema>;
