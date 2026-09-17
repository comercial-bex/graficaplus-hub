/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { normalizarCatalogo, type ItemDoCatalogo } from "@/domain/parceiros/preco";
import type { MarcaDoParceiro, PainelDoParceiro } from "@/domain/parceiros/painel";

/**
 * Conversa com o banco do clube de parceiros.
 *
 * As tabelas e funções do módulo ainda não estão nos tipos gerados do Supabase
 * (a migração é aplicada à mão), então as chamadas passam por `as any`. Os nomes
 * de parâmetro são conferidos por tests/rpc-assinaturas.test.ts — por isso cada
 * RPC é chamada com o nome literal, e não por um apelido que o teste não enxerga.
 */

export const BUCKET_MARCAS = "parceiros-marcas";

/** Chaves de cache compartilhadas entre o layout e as telas do parceiro. */
export const CHAVE_PAINEL = ["parceiro-painel"] as const;
export const CHAVE_CATALOGO = ["parceiro-catalogo"] as const;
export const chaveDoLogo = (caminho: string | null | undefined) => ["parceiro-logo", caminho ?? ""] as const;

/** O banco responde 42501 quando o usuário não é parceiro ativo. */
export function ehAcessoNegado(erro: unknown): boolean {
  const e = erro as { code?: string; message?: string } | null;
  return e?.code === "42501" || /Acesso de parceiro/i.test(e?.message ?? "");
}

// ─── Lado do parceiro ───────────────────────────────────────────────────────

export async function carregarPainel(): Promise<PainelDoParceiro> {
  const { data, error } = await (supabase.rpc as any)("parceiro_painel");
  if (error) throw error;
  return data as PainelDoParceiro;
}

export async function carregarCatalogo(): Promise<ItemDoCatalogo[]> {
  const { data, error } = await (supabase.rpc as any)("parceiro_catalogo");
  if (error) throw error;
  return normalizarCatalogo((data ?? []) as unknown[]);
}

export async function marcarOfertaVista(ofertaId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("parceiro_marcar_oferta_vista", { p_oferta_id: ofertaId });
  if (error) throw error;
}

export async function salvarMarca(dados: MarcaDoParceiro): Promise<void> {
  const { error } = await (supabase.rpc as any)("parceiro_salvar_marca", { p_dados: dados });
  if (error) throw error;
}

export type PedidoEnviado = {
  orcamento_id: string;
  numero: number;
  itens: number;
  itens_livres_fora_do_pedido: number;
  total: number;
  credito_usado: number;
};

export async function enviarPedido(orcamentoId: string, usarCredito: number): Promise<PedidoEnviado> {
  const { data, error } = await (supabase.rpc as any)("parceiro_enviar_pedido", {
    p_orcamento_id: orcamentoId,
    p_usar_credito: usarCredito,
  });
  if (error) throw error;
  return data as PedidoEnviado;
}

/**
 * URL assinada do logo. O bucket é privado — o logo de um parceiro não é
 * público só porque o PDF dele é. Uma hora basta para a tela e para o PDF.
 */
export async function urlDoLogo(caminho: string | null | undefined): Promise<string | null> {
  if (!caminho) return null;
  const { data } = await supabase.storage.from(BUCKET_MARCAS).createSignedUrl(caminho, 3600);
  return data?.signedUrl ?? null;
}

/** O PDF só aceita PNG e JPEG: SVG e WebP sairiam em branco no cabeçalho. */
export const TIPOS_DE_LOGO = ["image/png", "image/jpeg"];
export const TAMANHO_MAXIMO_LOGO = 2 * 1024 * 1024;

export async function enviarLogo(parceiroId: string, arquivo: File): Promise<string> {
  if (!TIPOS_DE_LOGO.includes(arquivo.type)) {
    throw new Error("Envie o logo em PNG ou JPG — é o formato que o PDF consegue imprimir.");
  }
  if (arquivo.size > TAMANHO_MAXIMO_LOGO) {
    throw new Error("O logo precisa ter até 2 MB.");
  }
  const extensao = arquivo.type === "image/png" ? "png" : "jpg";
  // nome novo a cada envio: a URL assinada antiga não mostra o logo velho do cache
  const caminho = `${parceiroId}/logo-${Date.now()}.${extensao}`;
  const { error } = await supabase.storage
    .from(BUCKET_MARCAS)
    .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw error;
  return caminho;
}

// ─── Lado da gestão (equipe da gráfica) ─────────────────────────────────────

export type ResumoDoParceiro = {
  id: string;
  cliente_id: string;
  nome: string;
  cliente_nome: string;
  usuario_email: string | null;
  responsavel_nome: string | null;
  status: "ativo" | "suspenso" | "encerrado";
  /** sem `compras_90d`/`proximo` para quem não vê financeiro */
  nivel: { id: string | null; nome: string | null; cor: string | null; ordem: number; fixado: boolean; compras_90d?: number };
  /** nulo para quem não vê financeiro — é faturamento da gráfica */
  compras_30d: number | null;
  ultima_compra: string | null;
  dias_sem_comprar: number | null;
  orcamentos_30d: number;
  metragem_orcada_30d: number;
  pedidos_30d: number;
  saldo_credito: number;
  conquistas_a_entregar: number;
  ultimo_acesso_em: string | null;
  criado_em: string;
};

export async function resumoDosParceiros(): Promise<ResumoDoParceiro[]> {
  const { data, error } = await (supabase.rpc as any)("parceiros_resumo");
  if (error) throw error;
  return (data ?? []) as ResumoDoParceiro[];
}

export async function criarParceiro(params: {
  clienteId: string;
  responsavelId: string | null;
  nivelFixoId: string | null;
}): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("parceiro_criar", {
    p_cliente_id: params.clienteId,
    p_responsavel_id: params.responsavelId,
    p_nivel_fixo_id: params.nivelFixoId,
  });
  if (error) throw error;
  return data as string;
}

export async function vincularUsuarioAoParceiro(parceiroId: string, usuarioId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("parceiro_vincular_usuario", {
    p_parceiro_id: parceiroId,
    p_usuario_id: usuarioId,
  });
  if (error) throw error;
}

export async function ajustarCredito(parceiroId: string, valor: number, descricao: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("parceiro_ajustar_credito", {
    p_parceiro_id: parceiroId,
    p_valor: valor,
    p_descricao: descricao,
  });
  if (error) throw error;
}

export type ConquistaPendente = {
  id: string;
  parceiro_nome: string;
  campanha: string;
  recompensa: string;
  alcancado_em: string;
  valor_apurado: number;
};

export async function conquistasPendentes(): Promise<ConquistaPendente[]> {
  const { data, error } = await (supabase.rpc as any)("parceiro_conquistas_pendentes");
  if (error) throw error;
  return (data ?? []) as ConquistaPendente[];
}

export async function entregarConquista(conquistaId: string, observacao: string | null): Promise<void> {
  const { error } = await (supabase.rpc as any)("parceiro_entregar_conquista", {
    p_conquista_id: conquistaId,
    p_observacao: observacao,
  });
  if (error) throw error;
}

export type UsuarioEncontrado = { id: string; nome: string | null; email: string | null };

/** Contas que não são da equipe — quem pode virar login de parceiro. */
export async function buscarContaParaParceiro(busca: string): Promise<UsuarioEncontrado[]> {
  const { data, error } = await (supabase.rpc as any)("buscar_usuario_para_portal", { p_busca: busca });
  if (error) throw error;
  return (data ?? []) as UsuarioEncontrado[];
}
