import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePendencias } from "@/hooks/usePendencias";
import type { ContagemDoMenu } from "@/lib/menu";

/**
 * As contagens ao lado dos itens do menu.
 *
 * Regra de entrada: só ganha número o item que já tinha uma fonte confiável no
 * banco — a mesma conta que a tela de destino faz, para o número do menu e o
 * da tela nunca discordarem. E a conta é SEMPRE feita no banco (`count:
 * "exact", head: true` ou função): listar e contar no navegador para em 1.000
 * linhas sem avisar, e o menu mostraria um número menor que o real para sempre.
 */
export const CONTAGENS_LIGADAS = ["avisosPendentes", "pediuAjuste", "parcelasVencidas"] as const;

type Ligada = (typeof CONTAGENS_LIGADAS)[number];

/**
 * As contagens que a árvore pede e que ficaram de fora, com o motivo. Ligar
 * uma delas é decidir a regra primeiro — não escolher uma das versões que já
 * discordam entre si.
 */
export const CONTAGENS_DE_FORA: Record<Exclude<ContagemDoMenu, Ligada>, string> = {
  osAtrasadas:
    "quatro regras de 'atrasada' discordam entre si: o chip do Quadro conta OS concluída à espera de faturar; a ficha da OS não conta; o cartão 'OS atrasadas' do Início usa a data em UTC (depois das 21h de Macapá já é amanhã); a vw_dashboard_prazos compara a data com now() e chama de atrasada a OS que vence hoje. Uma quinta, só para o menu, seria mais uma porta para o mesmo fato.",
  artesAguardando:
    "a tela Artes para produzir conta ARQUIVOS de arte aguardando (filtro no navegador sobre a lista inteira); o cartão do Início conta ORDENS DE SERVIÇO em aguardando_aprovacao_arte; a pendência arte_aguardando_cliente do banco conta OS paradas há mais de 2 dias. Nenhuma conta no banco o mesmo número que a tela mostra.",
};

export type ValorDaContagem = number | "erro";

/** De quanto em quanto tempo o menu reconfere os números. */
const A_CADA = 2 * 60 * 1000;

async function contarAvisosPendentes(): Promise<number> {
  // Mesma régua do cartão "Para avisar de verdade" da tela de Avisos: o órfão
  // (sem cliente, cliente apagado, OS ou orçamento apagado) não tem a quem
  // avisar, e quem decide o que é órfão é a coluna motivo_orfao da view.
  const { count, error } = await supabase
    .from("vw_avisos_pendentes")
    .select("id", { count: "exact", head: true })
    .is("motivo_orfao", null);
  if (error) throw error;
  if (count === null) throw new Error("o banco não devolveu a contagem de avisos");
  return count;
}

async function contarPedidosDeAjuste(): Promise<number> {
  // Mesma régua do cartão "Pediram ajuste" de Aprovações do cliente: pedido
  // aberto pelo portal OU arte devolvida com ajuste.
  const { count, error } = await supabase
    .from("vw_aprovacoes_orcamento")
    .select("id", { count: "exact", head: true })
    .or("ajustes_abertos.gt.0,artes_ajuste.gt.0");
  if (error) throw error;
  if (count === null) throw new Error("o banco não devolveu a contagem de ajustes");
  return count;
}

function valor(q: {
  isError: boolean;
  isSuccess: boolean;
  data: number | undefined;
}): ValorDaContagem | undefined {
  if (q.isError) return "erro";
  return q.isSuccess ? q.data : undefined;
}

/**
 * Lê as contagens que a pessoa tem como ver. Pergunta só pelo que foi pedido:
 * item que não aparece no menu não consulta nada.
 */
export function useContagensDoMenu(
  pedidas: ReadonlySet<ContagemDoMenu>,
): Partial<Record<ContagemDoMenu, ValorDaContagem>> {
  const avisos = useQuery({
    // Prefixo da chave da tela de Avisos: o "Já avisei" de lá invalida
    // ["avisos-pendentes"], e o número do menu cai junto.
    queryKey: ["avisos-pendentes", "contagem-do-menu"],
    enabled: pedidas.has("avisosPendentes"),
    refetchInterval: A_CADA,
    queryFn: contarAvisosPendentes,
  });

  const ajustes = useQuery({
    queryKey: ["vw-aprovacoes-orcamento", "contagem-do-menu"],
    enabled: pedidas.has("pediuAjuste"),
    refetchInterval: A_CADA,
    queryFn: contarPedidosDeAjuste,
  });

  // Parcelas vencidas: a função pendencias_do_sistema() já conta no banco
  // (status <> 'paga' e vencimento antes de hoje — a mesma régua de Contas a
  // receber). A linha só volta quando há alguma; sem linha é zero.
  const pendencias = usePendencias({
    enabled: pedidas.has("parcelasVencidas"),
    refetchInterval: A_CADA,
  });
  const parcelas = {
    isError: pendencias.isError,
    isSuccess: pendencias.isSuccess,
    data: pendencias.data
      ? (pendencias.data.find((p) => p.chave === "parcela_vencida_sem_baixa")?.quantidade ?? 0)
      : undefined,
  };

  const saida: Partial<Record<ContagemDoMenu, ValorDaContagem>> = {};
  if (pedidas.has("avisosPendentes")) saida.avisosPendentes = valor(avisos);
  if (pedidas.has("pediuAjuste")) saida.pediuAjuste = valor(ajustes);
  if (pedidas.has("parcelasVencidas")) saida.parcelasVencidas = valor(parcelas);
  return saida;
}
