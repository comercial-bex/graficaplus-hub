/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import type {
  AbaStatus,
  ConversaDaCaixa,
  EventoDaConversa,
  Fila,
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

/**
 * O tempo real (Realtime nas tabelas whatsapp_*) avisa cada mudança; este
 * intervalo é só a rede de segurança se o canal cair.
 */
const INTERVALO_MS = 120_000;
export const POR_PAGINA = 50;

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
  "erro, recebido_em, enviado_em, created_at, enviada_por, origem";

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

/**
 * O despachante do SERVIDOR (job do pg_cron → POST /api/whatsapp/despachar)
 * está ligado? GET na mesma rota diz se há DESPACHANTE_TOKEN, sem mostrá-lo.
 * Rota ausente (front antigo) ou servidor fora lançam: "não deu para conferir"
 * é diferente de "desligado".
 */
export async function lerSaudeDoDespachante(): Promise<{ ligado: boolean }> {
  const resposta = await fetch("/api/whatsapp/despachar");
  if (!resposta.ok) throw new Error(`o servidor respondeu ${resposta.status}`);
  const corpo = (await resposta.json().catch(() => null)) as { ligado?: unknown } | null;
  if (typeof corpo?.ligado !== "boolean") throw new Error("resposta inesperada do servidor");
  return { ligado: corpo.ligado };
}

/** Link temporário para a mídia guardada no nosso armazenamento (bucket privado). */
export async function linkDaMidia(bucket: string, caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 120);
  if (error) throw error;
  return data.signedUrl;
}

/* ------------------------------------------------------------------ */
/* Caixa v2: paginação, tempo real, equipe, eventos, vínculos           */
/* ------------------------------------------------------------------ */

function termoSeguro(t: string): string {
  // Vírgula e parênteses quebram o filtro `or` do PostgREST.
  return t.replace(/[,()%*]/g, " ").trim();
}

function filtrarConsulta(q: any, f: { fila: Fila; status: AbaStatus; busca: string; userId: string | null }) {
  q = f.status === "resolvida" ? q.in("status", ["resolvida", "arquivada"]) : q.eq("status", f.status);
  if (f.fila === "minhas") q = q.eq("responsavel_id", f.userId ?? "00000000-0000-0000-0000-000000000000");
  if (f.fila === "nao_atribuidas") q = q.is("responsavel_id", null);
  const termo = termoSeguro(f.busca);
  if (termo) {
    const digitos = termo.replace(/\D/g, "");
    const partes = [`nome_contato.ilike.%${termo}%`, `ultima_mensagem.ilike.%${termo}%`];
    if (digitos.length >= 3) partes.push(`telefone.ilike.%${digitos}%`);
    q = q.or(partes.join(","));
  }
  return q;
}

export function useConversasPaginadas(f: { fila: Fila; status: AbaStatus; busca: string; userId: string | null }) {
  return useInfiniteQuery({
    queryKey: [...CHAVES.conversas, "pag", f.fila, f.status, f.busca, f.userId] as const,
    initialPageParam: 0,
    refetchInterval: INTERVALO_MS,
    queryFn: async ({ pageParam }) => {
      let q = (supabase as any).from("whatsapp_conversas").select(SELECT_CONVERSAS);
      q = filtrarConsulta(q, f);
      const { data, error } = await q
        .order("ultima_mensagem_at", { ascending: false, nullsFirst: false })
        .range(pageParam, pageParam + POR_PAGINA - 1);
      if (error) throw error;
      return (data ?? []) as ConversaDaCaixa[];
    },
    getNextPageParam: (ultima, todas) =>
      ultima.length < POR_PAGINA ? undefined : todas.length * POR_PAGINA,
  });
}

/** Contadores das pílulas e abas (consulta só de contagem, sem linhas). */
export function useContadores(status: AbaStatus, userId: string | null) {
  return useQuery({
    queryKey: [...CHAVES.conversas, "contadores", status, userId] as const,
    refetchInterval: INTERVALO_MS,
    queryFn: async () => {
      const contar = async (fila: Fila, st: AbaStatus) => {
        const q = filtrarConsulta(
          (supabase as any).from("whatsapp_conversas").select("id", { count: "exact", head: true }),
          { fila, status: st, busca: "", userId },
        );
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };
      const [minhas, naoAtribuidas, todas, aberta, pendente, resolvida] = await Promise.all([
        contar("minhas", status),
        contar("nao_atribuidas", status),
        contar("todas", status),
        contar("todas", "aberta"),
        contar("todas", "pendente"),
        contar("todas", "resolvida"),
      ]);
      return { minhas, nao_atribuidas: naoAtribuidas, todas, aberta, pendente, resolvida };
    },
  });
}

/** Uma conversa pelo id — a aberta pode não estar na página carregada da lista. */
export function useConversa(id: string | null) {
  return useQuery({
    queryKey: [...CHAVES.conversas, "uma", id] as const,
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_conversas")
        .select(SELECT_CONVERSAS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ConversaDaCaixa | null;
    },
  });
}

export function useMensagensPaginadas(conversaId: string) {
  return useInfiniteQuery({
    queryKey: [...CHAVES.mensagens(conversaId), "pag"] as const,
    initialPageParam: null as string | null,
    refetchInterval: INTERVALO_MS,
    queryFn: async ({ pageParam }) => {
      let q = (supabase as any)
        .from("whatsapp_mensagens")
        .select(SELECT_MENSAGENS)
        .eq("conversa_id", conversaId);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(POR_PAGINA);
      if (error) throw error;
      return (data ?? []) as MensagemDaCaixa[];
    },
    getNextPageParam: (ultima) =>
      ultima.length < POR_PAGINA ? undefined : ultima[ultima.length - 1].created_at,
  });
}

export function useEventosDaConversa(conversaId: string) {
  return useQuery({
    queryKey: ["wa-caixa-eventos", conversaId] as const,
    refetchInterval: INTERVALO_MS,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_conversa_eventos")
        .select("id, conversa_id, tipo, de_usuario, para_usuario, detalhe, created_at")
        .eq("conversa_id", conversaId)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return ((data ?? []) as EventoDaConversa[]).slice().reverse();
    },
  });
}

export type PessoaDaEquipe = { id: string; nome: string | null; avatar_url: string | null };

export function useEquipe() {
  return useQuery({
    queryKey: ["wa-caixa-equipe"] as const,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("whatsapp_equipe");
      if (error) throw error;
      return (data ?? []) as PessoaDaEquipe[];
    },
  });
}

export function mapaDeNomes(equipe: PessoaDaEquipe[] | undefined): Map<string, string> {
  return new Map((equipe ?? []).map((p) => [p.id, (p.nome ?? "").split(" ")[0] || "Equipe"]));
}

/** Lista de conversas em tempo real. Um canal só, desligado ao sair da tela. */
export function useTempoRealDaCaixa() {
  const qc = useQueryClient();
  useEffect(() => {
    const canal = supabase
      .channel("wa-caixa-conversas")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversas" }, () => {
        void qc.invalidateQueries({ queryKey: CHAVES.conversas });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [qc]);
}

/** Mensagens e eventos da conversa aberta, filtrados por ela. */
export function useTempoRealDaConversa(conversaId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const canal = supabase
      .channel(`wa-caixa-conversa-${conversaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_mensagens", filter: `conversa_id=eq.${conversaId}` },
        () => void qc.invalidateQueries({ queryKey: CHAVES.mensagens(conversaId) }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_conversa_eventos", filter: `conversa_id=eq.${conversaId}` },
        () => void qc.invalidateQueries({ queryKey: ["wa-caixa-eventos", conversaId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [conversaId, qc]);
}

export type VinculoResumo = {
  id: string;
  numero: number;
  titulo: string | null;
  status: string;
  valor_total: number | null;
};

export function useVinculosDaConversa(conversaId: string, osId: string | null, nivel: NivelDeVisao) {
  return useQuery({
    queryKey: ["wa-caixa-vinculos", conversaId, osId, nivel] as const,
    queryFn: async () => {
      const { data: ids, error } = await (supabase as any)
        .from("orcamentos")
        .select("id")
        .eq("conversa_id", conversaId);
      if (error) throw error;
      const lista = ((ids ?? []) as { id: string }[]).map((x) => x.id);
      const orc = lista.length
        ? await fromFinancialView("orcamentos", nivel)
            .select("id, numero, titulo, status, valor_total")
            .in("id", lista)
            .order("created_at", { ascending: false })
        : { data: [], error: null };
      if (orc.error) throw orc.error;
      const os = osId
        ? await fromFinancialView("ordens_servico", nivel)
            .select("id, numero, titulo, status, valor_total")
            .eq("id", osId)
            .maybeSingle()
        : { data: null, error: null };
      if (os.error) throw os.error;
      return {
        orcamentos: (orc.data ?? []) as VinculoResumo[],
        os: (os.data ?? null) as VinculoResumo | null,
      };
    },
  });
}

export async function buscarParaVincular(
  tabela: "orcamentos" | "ordens_servico",
  termo: string,
  nivel: NivelDeVisao,
): Promise<(VinculoResumo & { cliente_nome?: string | null })[]> {
  const t = termoSeguro(termo);
  let q: any = fromFinancialView(tabela, nivel).select("id, numero, titulo, status, valor_total, cliente_id");
  if (t) {
    const n = Number(t.replace(/\D/g, ""));
    const partes = [`titulo.ilike.%${t}%`];
    if (n > 0) partes.push(`numero.eq.${n}`);
    q = q.or(partes.join(","));
  }
  const { data, error } = await q.order("created_at", { ascending: false }).limit(15);
  if (error) throw error;
  const linhas = (data ?? []) as (VinculoResumo & { cliente_id: string | null })[];
  const clientes = [...new Set(linhas.map((l) => l.cliente_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (clientes.length) {
    const { data: cs } = await supabase.from("clientes").select("id, nome").in("id", clientes);
    for (const c of cs ?? []) nomes.set(c.id, c.nome);
  }
  // Busca pelo cliente também: filtra no navegador pelo nome.
  let res = linhas.map((l) => ({ ...l, cliente_nome: l.cliente_id ? (nomes.get(l.cliente_id) ?? null) : null }));
  if (t && res.length === 0) {
    const { data: cs } = await supabase.from("clientes").select("id, nome").ilike("nome", `%${t}%`).limit(10);
    const ids = (cs ?? []).map((c) => c.id);
    if (ids.length) {
      const r2 = await (fromFinancialView(tabela, nivel) as any)
        .select("id, numero, titulo, status, valor_total, cliente_id")
        .in("cliente_id", ids)
        .order("created_at", { ascending: false })
        .limit(15);
      if (r2.error) throw r2.error;
      const nm = new Map((cs ?? []).map((c) => [c.id, c.nome]));
      res = (r2.data ?? []).map((l: any) => ({ ...l, cliente_nome: nm.get(l.cliente_id) ?? null }));
    }
  }
  return res;
}

/** Sobe o anexo para o bucket privado, na pasta da conversa. */
export async function subirAnexo(conversaId: string, arquivo: Blob, nome: string): Promise<string> {
  const limpo = nome.replace(/[^\w.\-]+/g, "_").slice(-120) || "arquivo";
  const caminho = `caixa/${conversaId}/${Date.now()}-${limpo}`;
  const { error } = await supabase.storage
    .from("whatsapp-midias")
    .upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (error) throw error;
  return caminho;
}
