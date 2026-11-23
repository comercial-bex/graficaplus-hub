import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fromFinancialView, type NivelDeVisao } from "@/lib/supabase-financial-views";
import { lerContasAReceber } from "@/lib/contas-a-receber-leitura";
import {
  comoLeitura,
  contasDaOs,
  contasDoCliente,
  type ContaLida,
  type EntregaLida,
  type EnvioLido,
  type Leitura,
  type OrcamentoResumo,
  type OsResumo,
  type ParceiroResumo,
  type ProdutosDaOs,
} from "@/domain/relacionados/elos";

/**
 * As leituras da faixa "Relacionados" (23/11/2026). Cada hook devolve uma `Leitura` (carregando, erro, sem acesso ou ok),
 * para a faixa nunca confundir "não consegui ler" nem "não posso ler" com "não tem". Só leitura: nenhuma escrita aqui.
 *
 * As visões por nível (`fromFinancialView`) entregam só as colunas que o nível da pessoa pode ver; aqui só se pedem
 * colunas sem valor nenhum (número, status, nome, id), que existem nos três níveis.
 */

const UM_MINUTO = 60_000;

/** As contas a receber de todo mundo, lidas uma vez; o cliente e a OS filtram. Sem `financeiro.read`, nem consulta. */
function useContasAReceber(temAcesso: boolean) {
  return useQuery({
    // O prefixo "contas-a-receber" é o que a tela "A receber" invalida ao dar baixa numa parcela: a faixa acompanha.
    queryKey: ["contas-a-receber", "relacionados"],
    queryFn: lerContasAReceber,
    enabled: temAcesso,
    staleTime: UM_MINUTO,
  });
}

export function useContasDoClienteLidas(clienteId: string, temAcesso: boolean): Leitura<ContaLida[]> {
  const q = useContasAReceber(temAcesso);
  return comoLeitura(
    { isPending: q.isPending, isError: q.isError, data: q.data ? contasDoCliente(q.data, clienteId) : undefined },
    temAcesso,
  );
}

export function useContasDaOsLidas(osId: string, temAcesso: boolean): Leitura<ContaLida[]> {
  const q = useContasAReceber(temAcesso);
  return comoLeitura(
    { isPending: q.isPending, isError: q.isError, data: q.data ? contasDaOs(q.data, osId) : undefined },
    temAcesso,
  );
}

/** O número e o status do orçamento de origem de uma OS (o id já vem da própria OS). */
export function useOrcamentoDeOrigem(orcamentoId: string | null, nivel: NivelDeVisao): Leitura<OrcamentoResumo | null> {
  const q = useQuery({
    queryKey: ["relacionados", "orcamento", orcamentoId, nivel],
    enabled: !!orcamentoId,
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<OrcamentoResumo | null> => {
      const { data, error } = await fromFinancialView("orcamentos", nivel)
        .select("numero, status")
        .eq("id", orcamentoId)
        .maybeSingle();
      if (error) throw error;
      return data ? { numero: data.numero ?? null, status: data.status ?? null } : null;
    },
  });
  return comoLeitura(q, !!orcamentoId);
}

/** O número e o status da OS gerada por um orçamento. */
export function useOsGerada(osId: string | null, nivel: NivelDeVisao): Leitura<OsResumo | null> {
  const q = useQuery({
    queryKey: ["relacionados", "os", osId, nivel],
    enabled: !!osId,
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<OsResumo | null> => {
      const { data, error } = await fromFinancialView("ordens_servico", nivel)
        .select("numero, status")
        .eq("id", osId)
        .maybeSingle();
      if (error) throw error;
      return data ? { numero: data.numero ?? null, status: data.status ?? null } : null;
    },
  });
  return comoLeitura(q, !!osId);
}

/**
 * Os produtos da OS, lidos dos ITENS: `ordens_servico.produto_id` não é preenchido (0 de 54 em 23/11/2026); o produto vive
 * em `itens_os.produto_id`. Item sem produto é texto livre e é contado à parte.
 */
export function useProdutosDaOs(osId: string, nivel: NivelDeVisao): Leitura<ProdutosDaOs> {
  const q = useQuery({
    queryKey: ["relacionados", "produtos-da-os", osId, nivel],
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<ProdutosDaOs> => {
      const { data: itens, error } = await fromFinancialView("itens_os", nivel)
        .select("id, produto_id")
        .eq("os_id", osId)
        .order("ordem", { ascending: true });
      if (error) throw error;
      const lista = (itens ?? []) as { id: string; produto_id: string | null }[];
      const ids: string[] = [];
      for (const i of lista) if (i.produto_id && !ids.includes(i.produto_id)) ids.push(i.produto_id);
      const semProduto = lista.filter((i) => !i.produto_id).length;
      if (ids.length === 0) return { itens: lista.length, semProduto, produtos: [] };
      const { data: nomes, error: erroNomes } = await fromFinancialView("produtos", nivel)
        .select("id, nome")
        .in("id", ids);
      if (erroNomes) throw erroNomes;
      const porId = new Map<string, string>(((nomes ?? []) as { id: string; nome: string }[]).map((n) => [n.id, n.nome]));
      return {
        itens: lista.length,
        semProduto,
        // Produto que a leitura não devolveu (sem nome) não vira "sem nome" inventado: sai da lista.
        produtos: ids.filter((id) => porId.has(id)).map((id) => ({ id, nome: porId.get(id) as string })),
      };
    },
  });
  return comoLeitura(q);
}

/** As entregas e retiradas da OS. Quem lê a OS lê as entregas dela (a política do banco inclui `os.read`). */
export function useEntregasDaOs(osId: string): Leitura<EntregaLida[]> {
  const q = useQuery({
    queryKey: ["relacionados", "entregas-da-os", osId],
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<EntregaLida[]> => {
      const { data, error } = await supabase
        .from("entregas_instalacoes")
        .select("tipo, status, data_agendada, data_realizada")
        .eq("os_id", osId);
      if (error) throw error;
      return data ?? [];
    },
  });
  return comoLeitura(q);
}

/**
 * Os envios do PDF do orçamento registrados pelo sistema (`documentos_enviados`, que antes só era gravada). A política do
 * banco só deixa ler com `orcamentos.read`: sem ela a consulta devolveria vazio, e vazio diria "nunca enviado". Sem acesso,
 * o elo some.
 */
export function useEnviosDoOrcamento(orcamentoId: string, temAcesso: boolean): Leitura<EnvioLido[]> {
  const q = useQuery({
    queryKey: ["relacionados", "envios-do-orcamento", orcamentoId],
    enabled: temAcesso,
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<EnvioLido[]> => {
      const { data, error } = await supabase
        .from("documentos_enviados")
        .select("canal, enviado_em")
        .eq("tipo", "orcamento")
        .eq("referencia_id", orcamentoId);
      if (error) throw error;
      return data ?? [];
    },
  });
  return comoLeitura(q, temAcesso);
}

/** A conversa mais recente do cliente (só para quem lê o WhatsApp). */
export function useConversaDoCliente(clienteId: string | null, temAcesso: boolean): Leitura<{ id: string } | null> {
  const q = useQuery({
    queryKey: ["relacionados", "conversa-do-cliente", clienteId],
    enabled: !!clienteId && temAcesso,
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<{ id: string } | null> => {
      const { data, error } = await supabase
        .from("whatsapp_conversas")
        .select("id")
        .eq("cliente_id", clienteId as string)
        .order("ultima_mensagem_at", { ascending: false, nullsFirst: false })
        .limit(1);
      if (error) throw error;
      return data && data.length > 0 ? { id: data[0].id } : null;
    },
  });
  return comoLeitura(q, !!clienteId && temAcesso);
}

/** O cadastro de parceiro deste cliente, se houver (só para quem lê parceiros). */
export function useParceiroDoCliente(clienteId: string, temAcesso: boolean): Leitura<ParceiroResumo | null> {
  const q = useQuery({
    queryKey: ["relacionados", "parceiro-do-cliente", clienteId],
    enabled: temAcesso,
    staleTime: UM_MINUTO,
    queryFn: async (): Promise<ParceiroResumo | null> => {
      const { data, error } = await supabase
        .from("parceiros")
        .select("id, marca_nome, status")
        .eq("cliente_id", clienteId)
        .limit(1);
      if (error) throw error;
      return data && data.length > 0 ? { id: data[0].id, marca_nome: data[0].marca_nome ?? null, status: data[0].status ?? null } : null;
    },
  });
  return comoLeitura(q, temAcesso);
}
