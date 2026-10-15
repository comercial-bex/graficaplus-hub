import { supabase } from "@/integrations/supabase/client";

/**
 * Id → nome de quem é da equipe, para o "quem fez" das telas.
 *
 * Não leia `usuarios` direto para isso: a regra de leitura da tabela só deixa
 * ver a própria linha (o admin e o gestor veem todas). Lendo de lá, o Quadro
 * dizia "movida por Equipe" para o Leonardo e a Cibele. `nomes_da_equipe`
 * devolve só id e nome, de toda a equipe (inclusive quem saiu), para quem é
 * da equipe — migração 20261015150000.
 *
 * Sem `ids`, a equipe inteira (são poucas pessoas).
 */
export async function nomesDaEquipe(ids?: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = ids ? [...new Set(ids.filter((id): id is string => !!id))] : null;
  if (unicos && unicos.length === 0) return new Map();
  const { data, error } = await (supabase as any).rpc("nomes_da_equipe", { p_ids: unicos });
  if (error) throw error;
  return new Map(
    ((data ?? []) as { id: string; nome: string | null }[]).map((p) => [p.id, p.nome ?? ""]),
  );
}
