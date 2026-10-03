/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import type {
  ConversaDaCaixa,
  MensagemDaCaixa,
  RespostaDoConsumidor,
} from "@/domain/whatsapp/caixa-de-entrada";

/**
 * As leituras e gravações da caixa de entrada (/whatsapp).
 *
 * Toda consulta lê o `error` e lança: a tela mostra "falha ao carregar" com o
 * motivo, nunca uma caixa vazia que parece "ninguém escreveu". As colunas são
 * listadas à mão e foram conferidas em information_schema em 02/10/2026 — e
 * tests/whatsapp-caixa-de-entrada.test.ts confere de novo a cada mudança.
 */

/** Teto da lista. Se bater, a tela avisa que há mais antigas fora dela. */
export const LIMITE_CONVERSAS = 300;
export const LIMITE_MENSAGENS = 200;

/** Sem realtime ligado nestas tabelas: a caixa pergunta de novo a cada 30 s. */
const INTERVALO_MS = 30_000;

export const CHAVES = {
  instancias: ["wa-caixa-instancias"] as const,
  conversas: ["wa-caixa-conversas"] as const,
  mensagens: (conversaId: string) => ["wa-caixa-mensagens", conversaId] as const,
  respostas: ["wa-caixa-respostas-rapidas"] as const,
  clientes: ["wa-caixa-clientes"] as const,
  historico: (clienteId: string, nivel: NivelDeVisao) =>
    ["wa-caixa-historico", clienteId, nivel] as const,
};

export type InstanciaDaCaixa = {
  id: string;
  nome: string | null;
  numero: string | null;
  status: string | null;
  conectado: boolean | null;
  ultimo_evento_at: string | null;
  ativa: boolean | null;
  created_at: string | null;
};

export function useInstancias() {
  return useQuery({
    queryKey: CHAVES.instancias,
    refetchInterval: INTERVALO_MS,
    queryFn: async () => {
      // Lista explícita: `webhook_secret_hash` não é legível pela equipe e
      // select("*") falharia inteiro (grant por coluna, migração 20260911120000).
      const { data, error } = await supabase
        .from("whatsapp_instancias")
        .select("id, nome, numero, status, conectado, ultimo_evento_at, ativa, created_at")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as InstanciaDaCaixa[];
    },
  });
}

// `leads` tem DUAS ligações com whatsapp_conversas (conversas.lead_id e
// leads.conversa_id). Sem o nome da chave o PostgREST recusa o embed inteiro
// (PGRST201) — conferido contra o banco em 02/10/2026.
export const SELECT_CONVERSAS =
  "id, instancia_id, telefone, nome_contato, cliente_id, lead_id, os_id, status, etiquetas, " +
  "ultima_mensagem, ultima_mensagem_at, nao_lidas, responsavel_id, created_at, " +
  "cliente:clientes!whatsapp_conversas_cliente_id_fkey(id, nome), " +
  "lead:leads!whatsapp_conversas_lead_id_fkey(id, nome, status)";

export function useConversas(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVES.conversas,
    enabled: habilitado,
    refetchInterval: INTERVALO_MS,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_conversas")
        .select(SELECT_CONVERSAS)
        .order("ultima_mensagem_at", { ascending: false, nullsFirst: false })
        .limit(LIMITE_CONVERSAS);
      if (error) throw error;
      return (data ?? []) as ConversaDaCaixa[];
    },
  });
}

export const SELECT_MENSAGENS =
  "id, conversa_id, direcao, tipo, status, texto, legenda, media_url, storage_bucket, storage_path, " +
  "erro, recebido_em, enviado_em, created_at";

export function useMensagens(conversaId: string | null) {
  return useQuery({
    queryKey: CHAVES.mensagens(conversaId ?? ""),
    enabled: !!conversaId,
    refetchInterval: INTERVALO_MS,
    queryFn: async () => {
      // As mais NOVAS primeiro, para o corte de 200 levar as antigas — depois
      // a ordem é invertida para a conversa ler de cima para baixo.
      const { data, error } = await (supabase as any)
        .from("whatsapp_mensagens")
        .select(SELECT_MENSAGENS)
        .eq("conversa_id", conversaId)
        .order("created_at", { ascending: false })
        .limit(LIMITE_MENSAGENS);
      if (error) throw error;
      return ((data ?? []) as MensagemDaCaixa[]).slice().reverse();
    },
  });
}

export type RespostaRapida = { id: string; titulo: string; categoria: string; texto: string };

export function useRespostasRapidas() {
  return useQuery({
    queryKey: CHAVES.respostas,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("respostas_rapidas")
        .select("id, titulo, categoria, texto")
        .eq("ativo", true)
        .order("categoria")
        .order("titulo");
      if (error) throw error;
      return (data ?? []) as RespostaRapida[];
    },
  });
}

export type ClienteParaVincular = {
  id: string;
  nome: string;
  whatsapp_principal: string | null;
  telefone: string | null;
};

export function useClientesParaVincular(habilitado: boolean) {
  return useQuery({
    queryKey: CHAVES.clientes,
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id, nome, whatsapp_principal, telefone")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClienteParaVincular[];
    },
  });
}

export type ItemDoHistorico = {
  id: string;
  numero: number;
  titulo: string;
  status: string;
  created_at: string;
};

/**
 * Orçamentos e OS do cliente, pela view do nível de quem olha. Só número,
 * título e status: nada de valor aqui, então nenhum nível vê dinheiro que não
 * deveria — e as três views têm essas cinco colunas.
 */
export function useHistoricoDoCliente(clienteId: string | null, nivel: NivelDeVisao) {
  return useQuery({
    queryKey: CHAVES.historico(clienteId ?? "", nivel),
    enabled: !!clienteId,
    queryFn: async () => {
      const [orc, os] = await Promise.all([
        fromFinancialView("orcamentos", nivel)
          .select("id, numero, titulo, status, created_at")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false })
          .limit(5),
        fromFinancialView("ordens_servico", nivel)
          .select("id, numero, titulo, status, created_at")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      if (orc.error) throw orc.error;
      if (os.error) throw os.error;
      return {
        orcamentos: (orc.data ?? []) as ItemDoHistorico[],
        os: (os.data ?? []) as ItemDoHistorico[],
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Gravações                                                           */
/* ------------------------------------------------------------------ */

/**
 * UPDATE que o RLS barra não dá erro: devolve zero linhas. Sem pedir a linha
 * de volta, a tela diria "concluído" com nada gravado — o botão que finge.
 */
async function atualizarConversa(
  conversaId: string,
  mudanca: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await (supabase as any)
    .from("whatsapp_conversas")
    .update(mudanca)
    .eq("id", conversaId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Seu perfil não pode alterar esta conversa (falta a permissão whatsapp › reply).",
    );
  }
}

/** Concluir zera as não lidas: quem concluiu leu. */
export function concluirAtendimento(conversaId: string) {
  return atualizarConversa(conversaId, { status: "resolvida", nao_lidas: 0 });
}

export function reabrirAtendimento(conversaId: string) {
  return atualizarConversa(conversaId, { status: "aberta" });
}

export function gravarEtiquetas(conversaId: string, etiquetas: string[]) {
  return atualizarConversa(conversaId, { etiquetas });
}

/** Liga a conversa à OS criada a partir dela: as mensagens novas já chegam com a OS (o webhook copia). */
export function ligarConversaAOs(conversaId: string, osId: string) {
  return atualizarConversa(conversaId, { os_id: osId });
}

/**
 * Abrir a conversa marca como lida. Só para quem pode responder — o RLS
 * recusaria os outros — e só quando há o que marcar. Zero linhas aqui não é
 * erro: outra pessoa pode ter lido no mesmo instante.
 */
export async function marcarComoLida(conversaId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("whatsapp_conversas")
    .update({ nao_lidas: 0 })
    .eq("id", conversaId)
    .gt("nao_lidas", 0)
    .select("id");
  if (error) throw error;
}

export async function vincularCliente(conversaId: string, clienteId: string) {
  const { data, error } = await (supabase.rpc as any)("whatsapp_vincular_cliente", {
    p_conversa_id: conversaId,
    p_cliente_id: clienteId,
  });
  if (error) throw error;
  return data as { mensagens: number };
}

/** Grava a resposta (pendente) e a linha da fila, numa transação só, no banco. */
export async function enfileirarResposta(conversaId: string, texto: string) {
  const { data, error } = await (supabase.rpc as any)("whatsapp_responder", {
    p_conversa_id: conversaId,
    p_texto: texto,
  });
  if (error) throw error;
  return data as { mensagem_id: string; fila_id: string };
}

/**
 * Aciona o consumidor (POST /api/whatsapp/enviar) com a sessão de quem
 * respondeu. Não lança: devolve o que aconteceu, para a tela dizer exatamente
 * isso — inclusive "ficou na fila".
 */
export async function acionarEnvio(): Promise<
  { status: number; corpo: RespostaDoConsumidor | null } | { falhaDeRede: string }
> {
  const { data: sessao, error } = await supabase.auth.getSession();
  if (error || !sessao.session) {
    return { falhaDeRede: "sessão expirada — entre de novo" };
  }
  try {
    const resposta = await fetch("/api/whatsapp/enviar", {
      method: "POST",
      headers: { authorization: `Bearer ${sessao.session.access_token}` },
    });
    const corpo = (await resposta.json().catch(() => null)) as RespostaDoConsumidor | null;
    return { status: resposta.status, corpo };
  } catch (e) {
    return { falhaDeRede: e instanceof Error ? e.message : "sem rede" };
  }
}

/** Link temporário para a mídia guardada no nosso armazenamento (bucket privado). */
export async function linkDaMidia(bucket: string, caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 120);
  if (error) throw error;
  return data.signedUrl;
}
