/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import { ehFuncaoAusente } from "./parceiro-api";
import { lerPainel, type Painel } from "@/domain/parceiros/creditos-painel";

/**
 * A tela de créditos dos parceiros lê UMA função do banco, `parceiros_creditos_painel` (migração 20261122700000). Ela confere
 * `parceiros.read` por dentro e devolve o saldo (a mesma conta do cartão e do aviso) e o livro de cada parceiro.
 * null = a função ainda não foi aplicada no banco (a tela diz isso, não mostra tudo zerado).
 */
export async function painelDeCreditos(): Promise<Painel | null> {
  const { data, error } = await (supabase.rpc as any)("parceiros_creditos_painel");
  if (error) {
    if (ehFuncaoAusente(error)) return null;
    throw error;
  }
  return lerPainel(data);
}
