/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CHAVES } from "@/components/whatsapp/usar-caixa-de-entrada";
import {
  inicioDaJanela,
  type AtendimentoDoPainel,
  type ConversaDoPainel,
  type InstanciaDoPainel,
  type LeadDoPainel,
  type MensagemDoPainel,
  type OrcamentoDoPainel,
} from "@/domain/whatsapp/visao-geral";

/**
 * As linhas da Visão geral (/whatsapp-visao-geral). A conta é feita em
 * `domain/whatsapp/visao-geral.ts`; aqui só se busca — e toda leitura confere
 * o `error` e lança: a tela mostra a falha, nunca um zero que parece "ninguém
 * escreveu".
 *
 * Leads e orçamentos têm RLS própria (leads.read, staff): quem não pode ler
 * receberia lista vazia, e o cartão diria "0". Por isso a tela diz se pode, e
 * aqui não se busca o que a pessoa não pode ver (`null` = sem acesso).
 */

/** Teto de mensagens da janela; se bater, a tela avisa que a conta é parcial. */
export const LIMITE_MENSAGENS_DA_JANELA = 5000;

export type DadosDaVisaoGeral = {
  agora: Date;
  inicio: Date;
  mensagens: MensagemDoPainel[];
  mensagensNoLimite: boolean;
  conversas: ConversaDoPainel[];
  atendimentos: AtendimentoDoPainel[];
  instancias: InstanciaDoPainel[];
  ultimaDoCliente: string | null;
  leads: LeadDoPainel[] | null;
  orcamentos: OrcamentoDoPainel[] | null;
};

async function ler<T>(consulta: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as T;
}

export function useVisaoGeral(acesso: { leads: boolean; orcamentos: boolean }) {
  return useQuery({
    // Prefixo das conversas: o tempo real da caixa (que invalida
    // CHAVES.conversas) atualiza a Visão geral junto.
    queryKey: [...CHAVES.conversas, "visao-geral", acesso.leads, acesso.orcamentos] as const,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DadosDaVisaoGeral> => {
      const agora = new Date();
      const inicio = inicioDaJanela(agora);
      const desde = inicio.toISOString();
      const db = supabase as any;

      const [mensagens, conversas, atendimentos, instancias, ultima, leads, orcamentos] = await Promise.all([
        ler<MensagemDoPainel[]>(
          db
            .from("whatsapp_mensagens")
            .select("direcao, origem, enviada_por, recebido_em, enviado_em, created_at")
            .gte("created_at", desde)
            .order("created_at", { ascending: false })
            .limit(LIMITE_MENSAGENS_DA_JANELA),
        ),
        ler<ConversaDoPainel[]>(
          db
            .from("whatsapp_conversas")
            .select("id, fila, status, aguardando_desde, responsavel_id")
            .in("status", ["aberta", "pendente"])
            .limit(2000),
        ),
        // Abertos na janela, fechados na janela, ou ainda em andamento.
        ler<AtendimentoDoPainel[]>(
          db
            .from("whatsapp_atendimentos")
            .select("id, fila, aberto_em, primeira_resposta_em, fechado_em, fechado_por, responsavel_id, motivo_resolucao")
            .or(`aberto_em.gte.${desde},fechado_em.gte.${desde},fechado_em.is.null`)
            .limit(5000),
        ),
        // Lista explícita: webhook_secret_hash não é legível pela equipe.
        ler<InstanciaDoPainel[]>(
          db.from("whatsapp_instancias").select("status, conectado, ativa, ultimo_evento_at"),
        ),
        // A última de cliente de todos os tempos (pode ser antes da janela).
        // Modelo de empresa (origem automacao) não é cliente.
        ler<{ recebido_em: string | null; created_at: string }[]>(
          db
            .from("whatsapp_mensagens")
            .select("recebido_em, created_at")
            .eq("direcao", "entrada")
            .or("origem.is.null,origem.neq.automacao")
            .order("created_at", { ascending: false })
            .limit(1),
        ),
        acesso.leads
          ? ler<LeadDoPainel[]>(
              db.from("leads").select("status, cliente_id").eq("origem", "whatsapp").gte("created_at", desde),
            )
          : Promise.resolve(null),
        acesso.orcamentos
          ? ler<OrcamentoDoPainel[]>(
              db.from("orcamentos").select("status").not("conversa_id", "is", null).gte("created_at", desde),
            )
          : Promise.resolve(null),
      ]);

      return {
        agora,
        inicio,
        mensagens,
        mensagensNoLimite: mensagens.length >= LIMITE_MENSAGENS_DA_JANELA,
        conversas,
        atendimentos,
        instancias,
        ultimaDoCliente: ultima[0] ? (ultima[0].recebido_em ?? ultima[0].created_at) : null,
        leads,
        orcamentos,
      };
    },
  });
}
