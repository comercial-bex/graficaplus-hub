import { supabase } from "@/integrations/supabase/client";
import { colunaTipoAusente, normalizarTipo, type TipoDoLead } from "@/domain/crm/tipo-do-lead";

/**
 * Projeção estreita e RLS normal; só coluna ainda ausente recebe fallback.
 * Só entra no mapa o lead com tipo conhecido: ausência quer dizer "tipo a
 * confirmar", e quem lê com ehLeadParceiro trata como "não é parceiro" sem inferir.
 */
export async function lerTiposDosLeads(ids: string[]): Promise<Map<string, TipoDoLead>> {
  const unicos = [...new Set(ids)];
  const tipos = new Map<string, TipoDoLead>();
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await supabase.from("leads").select("id, tipo").in("id", unicos.slice(i, i + 100));
    if (colunaTipoAusente(error)) return new Map();
    if (error) throw error;
    for (const lead of (data ?? []) as unknown as { id: string; tipo?: unknown }[]) {
      const tipo = normalizarTipo(lead.tipo);
      if (tipo) tipos.set(lead.id, tipo);
    }
  }
  return tipos;
}
