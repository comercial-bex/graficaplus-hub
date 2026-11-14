import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TriagemDaConversa = { status: string };
export type TriagensDaCaixa = { porConversa: Map<string, TriagemDaConversa>; truncado: boolean };

/** Prefixo de todas as leituras de triagem da caixa: invalidar este prefixo atualiza lista e cabeçalho. */
export const CHAVE_TRIAGENS_DA_CAIXA = ["whatsapp", "triagens-da-caixa"] as const;
/** A tela de métricas da triagem (configurações). Muda quando a equipe assume ou responde. */
export const CHAVE_METRICAS_DA_TRIAGEM = ["triagem-metricas"] as const;

/** Chave de uma leitura: o prefixo mais as conversas pedidas, em ordem fixa, para quem pede as mesmas dividir o cache. */
export function chaveDasTriagens(conversaIds: readonly string[]) {
  return [...CHAVE_TRIAGENS_DA_CAIXA, [...new Set(conversaIds)].sort().join(",")] as const;
}

/** Quantas conversas por pedido: o filtro `in` vai na URL, e uns 80 ids (uns 3 mil caracteres) cabem com folga. */
const POR_PEDIDO = 80;
/** O corte de linhas do PostgREST. Uma conversa pode ter mais de uma triagem, por isso o teto é conferido. */
const LIMITE = 1000;

type Linha = { conversa_id: string; status: string };
type LeitorDeTriagens = (ids: string[]) => Promise<{ data: Linha[] | null; error: { message: string } | null }>;

/**
 * Junta as linhas lidas num mapa por conversa: vale a triagem MAIS RECENTE (as linhas chegam da mais nova para a mais
 * velha, então a primeira de cada conversa é a que fica). Separado do hook para ser testado sem rede.
 */
export function juntarTriagens(
  respostas: { data: Linha[] | null; error: { message: string } | null }[],
): TriagensDaCaixa {
  const porConversa = new Map<string, TriagemDaConversa>();
  let truncado = false;
  for (const r of respostas) {
    if (r.error) throw new Error(r.error.message);
    const linhas = r.data ?? [];
    if (linhas.length >= LIMITE) truncado = true;
    for (const l of linhas) if (!porConversa.has(l.conversa_id)) porConversa.set(l.conversa_id, { status: l.status });
  }
  return { porConversa, truncado };
}

export async function lerTriagens(conversaIds: readonly string[], ler: LeitorDeTriagens): Promise<TriagensDaCaixa> {
  const ids = [...new Set(conversaIds)];
  const pedidos: string[][] = [];
  for (let i = 0; i < ids.length; i += POR_PEDIDO) pedidos.push(ids.slice(i, i + POR_PEDIDO));
  return juntarTriagens(await Promise.all(pedidos.map((p) => ler(p))));
}

/**
 * O estado da triagem de boas-vindas das conversas pedidas, para o selo da lista e do cabeçalho. A lista pede as suas
 * conversas visíveis, de uma vez; o cabeçalho pede só a conversa aberta. Cliente do navegador e RLS normal: só quem tem
 * whatsapp.read recebe linhas. Pede só conversa e status; nome, CEP e telefone que a triagem guarda nunca saem daqui.
 * Simulação (modo ensaio) fica de fora.
 *
 * Erro de leitura NÃO vira "sem triagem" em silêncio: o selo some (a caixa não trava por causa de um enfeite), mas a
 * consulta fica em erro e a tela de métricas da triagem é onde isso aparece de forma explícita. Como a leitura é por
 * conversa pedida, o corte de mil linhas só aparece se uma conversa tiver centenas de triagens; `truncado` avisa.
 */
export function useTriagensDaCaixa(conversaIds: readonly string[]) {
  return useQuery({
    queryKey: chaveDasTriagens(conversaIds),
    enabled: conversaIds.length > 0,
    // a lista cresce com "carregar mais": a chave muda, e os selos já lidos não podem sumir enquanto a nova leitura chega
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: () =>
      lerTriagens(conversaIds, async (ids) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a tabela não está nos tipos gerados
        const r = await (supabase as any)
          .from("whatsapp_triagens")
          .select("conversa_id, status")
          .in("conversa_id", ids)
          .neq("modo", "ensaio")
          .order("atualizado_em", { ascending: false })
          .limit(LIMITE);
        return r as { data: Linha[] | null; error: { message: string } | null };
      }),
  });
}
