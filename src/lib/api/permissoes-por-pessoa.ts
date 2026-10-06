import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erros";
import {
  lerPermissoesDaPessoa,
  lerUsoNoBanco,
  type PermissoesDaPessoa,
  type UsoNoBanco,
} from "@/domain/acesso/permissoes-por-pessoa";

/**
 * As funções do banco das permissões por pessoa (migração 20261006200000).
 *
 * Ainda não estão nos tipos gerados (types.ts), por isso o cliente é visto
 * por uma interface mínima — mas a chamada continua `cliente.rpc("nome",
 * { … })` escrita por extenso: é assim que tests/rpc-assinaturas.test.ts
 * confere os nomes de parâmetro contra a assinatura do banco.
 */

type ErroRpc = { message: string; code?: string } | null;
type ClienteRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: ErroRpc }>;
};
const cliente = supabase as unknown as ClienteRpc;

/** Front publicado antes da migração: a função ainda não existe no banco. */
const SEM_A_MIGRACAO =
  "O banco ainda não tem as permissões por pessoa (falta aplicar a migração de 06/10/2026). Avise o administrador do sistema.";

function falha(error: NonNullable<ErroRpc>): Error {
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
    return new Error(SEM_A_MIGRACAO);
  }
  return new Error(mensagemErro(error));
}

/**
 * A matriz papel × permissão inteira, em páginas.
 *
 * O PostgREST corta toda leitura em 1.000 linhas sem avisar. Hoje são 308,
 * mas 10 papéis × 117 chaves dão 1.170: lida de uma vez, a matriz perderia
 * linhas em silêncio e as contagens por papel mentiriam. Ordem estável
 * (papel, chave) para nenhuma linha repetir ou sumir entre páginas.
 */
export async function lerMatrizDosPapeis(): Promise<Record<string, string[]>> {
  const PAGINA = 1000;
  const matriz: Record<string, string[]> = {};
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("role_permission_matrix" as never)
      .select("role, permission")
      .order("role" as never)
      .order("permission" as never)
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const linhas = (data ?? []) as unknown as { role: string; permission: string }[];
    for (const l of linhas) (matriz[l.role] ??= []).push(l.permission);
    if (linhas.length < PAGINA) return matriz;
  }
}

/** Chaves que valem para quem está logado (papéis + exceções ativas). */
export async function buscarMinhasPermissoes(): Promise<Set<string>> {
  const { data, error } = await cliente.rpc("minhas_permissoes");
  if (error) throw falha(error);
  if (!Array.isArray(data) || !data.every((k) => typeof k === "string")) {
    throw new Error("O banco devolveu as permissões num formato que esta tela não conhece.");
  }
  return new Set(data as string[]);
}

/** Painel de uma pessoa (só administrador). */
export async function buscarPermissoesDaPessoa(usuarioId: string): Promise<PermissoesDaPessoa> {
  const { data, error } = await cliente.rpc("permissoes_da_pessoa", { p_usuario_id: usuarioId });
  if (error) throw falha(error);
  return lerPermissoesDaPessoa(data);
}

/** Quantas policies, funções e views citam cada chave (só administrador). */
export async function buscarUsoNoBanco(): Promise<UsoNoBanco> {
  const { data, error } = await cliente.rpc("permissoes_uso_no_banco");
  if (error) throw falha(error);
  return lerUsoNoBanco(data);
}

export type NovaExcecao = {
  usuarioId: string;
  permissao: string;
  /** true = dar só para esta pessoa; false = tirar só desta pessoa. */
  concede: boolean;
  /** Instante em que deixa de valer (ISO) ou null para "até desfazer". */
  expiraEm: string | null;
  motivo: string;
};

/** Dá ou tira uma permissão de uma pessoa. Devolve se ela vale agora. */
export async function definirExcecao(e: NovaExcecao): Promise<{ efetiva: boolean }> {
  const { data, error } = await cliente.rpc("definir_excecao_permissao", {
    p_usuario_id: e.usuarioId,
    p_permissao: e.permissao,
    p_concede: e.concede,
    p_expira_em: e.expiraEm,
    p_motivo: e.motivo,
  });
  if (error) throw falha(error);
  return { efetiva: Boolean((data as { efetiva?: unknown } | null)?.efetiva) };
}

/** Desfaz a exceção: a pessoa volta ao que o papel dá. */
export async function removerExcecao(e: {
  usuarioId: string;
  permissao: string;
  motivo: string;
}): Promise<{ efetiva: boolean }> {
  const { data, error } = await cliente.rpc("remover_excecao_permissao", {
    p_usuario_id: e.usuarioId,
    p_permissao: e.permissao,
    p_motivo: e.motivo,
  });
  if (error) throw falha(error);
  return { efetiva: Boolean((data as { efetiva?: unknown } | null)?.efetiva) };
}
