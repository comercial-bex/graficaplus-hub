/* eslint-disable @typescript-eslint/no-explicit-any -- `from` fora dos tipos gerados: a tabela nasce na migração B1, aplicada à mão */
import { compilarTermosDoBanco, type RegraDoBanco } from "@/domain/whatsapp/triagem/verificador";

/**
 * Os termos que o dono acrescentou na tabela `whatsapp_triagem_termos_proibidos` (C1), SÓ LEITURA.
 *
 * Servem de acréscimo à lista do código (`verificador.ts`), que é o piso. Se a leitura falhar (tabela ainda não
 * aplicada, erro de rede, linha inválida), devolve lista vazia ou só as linhas que compilam: o verificador roda com a
 * lista do código e nunca fica mais frouxo por causa disto.
 *
 * Vale para qualquer cliente do Supabase (o do servidor com a chave de serviço, ou o de quem está logado na tela de
 * ensaio, que a política de leitura da equipe já deixa ler).
 */
export async function lerTermosExtras(db: any): Promise<RegraDoBanco[]> {
  try {
    const { data, error } = await db
      .from("whatsapp_triagem_termos_proibidos")
      .select("regra, termo, tipo, sobre, ramo, ativo")
      .eq("ativo", true);
    if (error) return [];
    return compilarTermosDoBanco(data).regras;
  } catch {
    return [];
  }
}
