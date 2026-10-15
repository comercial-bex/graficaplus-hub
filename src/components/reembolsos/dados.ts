import { supabase } from "@/integrations/supabase/client";
import { nomesDaEquipe } from "@/lib/api/equipe";
import {
  BUCKET_DO_COMPROVANTE,
  type CategoriaDoReembolso,
  type CorDoReembolso,
  type DestinoDoReembolso,
  type Semaforo,
  type SituacaoDoReembolso,
} from "@/domain/financeiro/reembolsos";

/**
 * Leitura dos reembolsos para as telas. A tabela só se lê (o banco não deixa
 * gravar por fora das funções reembolso_*), e a regra de leitura é a mesma do
 * banco: quem pediu vê os seus; quem decide (reembolsos.pay/approve) vê todos.
 *
 * A tabela é de 15/10/2026 e ainda não está nos tipos gerados — daí o `as any`.
 */

export type Reembolso = {
  id: string;
  numero: number;
  solicitante_id: string;
  valor: number;
  descricao: string;
  fornecedor: string | null;
  data_compra: string;
  categoria: CategoriaDoReembolso;
  destino: DestinoDoReembolso;
  os_id: string | null;
  os_item_id: string | null;
  comprovante_path: string;
  status: SituacaoDoReembolso;
  cor: CorDoReembolso;
  depois_do_fechamento: boolean;
  decidido_por: string | null;
  decidido_em: string | null;
  motivo_decisao: string | null;
  conta_pagar_id: string | null;
  pago_em: string | null;
  created_at: string;
  os: { numero: number; titulo: string | null } | null;
  /** Primeiro nome de quem pediu e de quem decidiu (nomes_da_equipe). */
  solicitante: string;
  decisor: string | null;
};

const CAMPOS =
  "id, numero, solicitante_id, valor, descricao, fornecedor, data_compra, categoria, destino, os_id, os_item_id, " +
  "comprovante_path, status, cor, depois_do_fechamento, decidido_por, decidido_em, motivo_decisao, conta_pagar_id, " +
  "pago_em, created_at, os:ordens_servico(numero, titulo)";

/** Prefixo de todas as chaves: pedir, decidir e cancelar invalidam ["reembolsos"]. */
export const CHAVE_DOS_REEMBOLSOS = "reembolsos";

export type FiltroDosReembolsos = {
  solicitanteId?: string;
  osId?: string;
  status?: readonly SituacaoDoReembolso[];
  limite?: number;
};

export async function buscarReembolsos(filtro: FiltroDosReembolsos = {}): Promise<Reembolso[]> {
  let q = (supabase as any).from("reembolsos").select(CAMPOS);
  if (filtro.solicitanteId) q = q.eq("solicitante_id", filtro.solicitanteId);
  if (filtro.osId) q = q.eq("os_id", filtro.osId);
  if (filtro.status?.length) q = q.in("status", filtro.status as string[]);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(filtro.limite ?? 500);
  if (error) throw error;
  const linhas = (data ?? []) as Omit<Reembolso, "solicitante" | "decisor">[];
  const nomes = await nomesDaEquipe(linhas.flatMap((r) => [r.solicitante_id, r.decidido_por]));
  const primeiro = (id: string | null) => {
    if (!id) return null;
    return (nomes.get(id) ?? "").trim().split(/\s+/)[0] || "Equipe";
  };
  return linhas.map((r) => ({
    ...r,
    valor: Number(r.valor),
    solicitante: primeiro(r.solicitante_id) ?? "Equipe",
    decisor: primeiro(r.decidido_por),
  }));
}

/** O semáforo de agora (o banco recalcula na decisão: o custo da OS pode ter mudado). */
export async function consultarSemaforo(osId: string, valor: number, ignorar?: string | null): Promise<Semaforo> {
  const { data, error } = await (supabase as any).rpc("reembolso_semaforo", {
    p_os_id: osId,
    p_valor: valor,
    p_ignorar: ignorar ?? null,
  });
  if (error) throw error;
  return data as Semaforo;
}

/** Link de 10 minutos para a foto do cupom (o Storage confere quem pode ver). */
export async function linkDoComprovante(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_DO_COMPROVANTE).createSignedUrl(caminho, 600);
  if (error) throw error;
  return data.signedUrl;
}

export function ehPdf(caminho: string): boolean {
  return /\.pdf$/i.test(caminho);
}
