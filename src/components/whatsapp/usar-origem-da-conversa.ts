import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizarTipo } from "@/domain/crm/tipo-do-lead";
import type { OrigemDoTipo, TipoDeContato } from "@/domain/whatsapp/origem-do-contato";

export type OrigemDaConversa = {
  tipo: TipoDeContato | null;
  tipoOrigem: OrigemDoTipo | null;
  anuncioNome: string | null;
  produto: string | null;
  parceiroCadastrado: boolean;
};

const ORIGENS: readonly string[] = ["anuncio", "palavra", "telefone", "manual"];

/**
 * Lê, só para a equipe, o tipo do lead, o anúncio do atendimento aberto e se o
 * cliente ligado é parceiro ativo. Leituras estreitas com a RLS normal. Coluna
 * ainda inexistente (migração não aplicada) vira "sem informação", nunca erro de tela.
 */
export function useOrigemDaConversa(c: {
  id: string;
  lead_id: string | null;
  cliente_id: string | null;
  atendimento_ativo_id?: string | null;
}) {
  return useQuery({
    queryKey: ["whatsapp", "origem-da-conversa", c.id, c.lead_id, c.cliente_id, c.atendimento_ativo_id ?? null],
    staleTime: 15_000,
    queryFn: async (): Promise<OrigemDaConversa> => {
      const saida: OrigemDaConversa = {
        tipo: null,
        tipoOrigem: null,
        anuncioNome: null,
        produto: null,
        parceiroCadastrado: false,
      };
      if (c.lead_id) {
        const { data, error } = await supabase
          .from("leads")
          .select("tipo, tipo_origem")
          .eq("id", c.lead_id)
          .maybeSingle();
        if (!error && data) {
          const d = data as unknown as { tipo?: unknown; tipo_origem?: unknown };
          saida.tipo = normalizarTipo(d.tipo);
          saida.tipoOrigem =
            typeof d.tipo_origem === "string" && ORIGENS.includes(d.tipo_origem)
              ? (d.tipo_origem as OrigemDoTipo)
              : null;
        }
      }
      if (c.atendimento_ativo_id) {
        const { data, error } = await supabase
          .from("whatsapp_atendimentos")
          .select("anuncio_titulo, produto")
          .eq("id", c.atendimento_ativo_id)
          .maybeSingle();
        if (!error && data) {
          const d = data as unknown as { anuncio_titulo?: string | null; produto?: string | null };
          saida.anuncioNome = d.anuncio_titulo?.trim() || null;
          saida.produto = d.produto?.trim() || null;
        }
      }
      if (c.cliente_id) {
        const { data, error } = await supabase
          .from("parceiros")
          .select("id")
          .eq("cliente_id", c.cliente_id)
          .eq("status", "ativo")
          .limit(1);
        saida.parceiroCadastrado = !error && (data?.length ?? 0) > 0;
      }
      return saida;
    },
  });
}
