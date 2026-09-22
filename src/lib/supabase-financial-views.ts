import { supabase } from "@/integrations/supabase/client";

/**
 * Três níveis de visão sobre as tabelas que carregam dinheiro.
 *
 *   operacional  sem nenhuma coluna de valor   — operador, designer, instalador
 *   comercial    preço de venda, sem custo      — vendedor (precos.read)
 *   financeiro   tudo, inclusive custo e margem — financeiro, gestor, admin
 *
 * Até 22/09/2026 só existiam os dois extremos, e o vendedor caía no
 * operacional: criava e enviava orçamento sem ver valor nenhum — todo
 * orçamento dele saía R$ 0,00. Dar `financeiro.read` a ele abriria custo,
 * margem e o módulo Financeiro. O nível comercial é o meio-termo que faltava.
 *
 * As views `_comercial` são DEFINER no banco e listam explicitamente as
 * colunas de preço; custo e margem simplesmente não existem nelas. É a
 * lista de colunas que protege, não a tela — a tela só escolhe a view.
 */
export type NivelDeVisao = "operacional" | "comercial" | "financeiro";

const viewByAccess = {
  orcamentos: ["orcamentos_operacional", "orcamentos_comercial", "orcamentos_financeiro"],
  orcamento_itens: ["orcamento_itens_operacional", "orcamento_itens_comercial", "orcamento_itens_financeiro"],
  ordens_servico: ["ordens_servico_operacional", "ordens_servico_comercial", "ordens_servico_financeiro"],
  itens_os: ["itens_os_operacional", "itens_os_comercial", "itens_os_financeiro"],
  // Material não tem preço de venda: o nível comercial cai no operacional.
  materiais: ["materiais_operacional", "materiais_operacional", "materiais_financeiro"],
  // produtos_financeiro existe sobre a tabela-espelho produto_precos (RLS
  // can_see_financials); produtos_comercial expõe só preco_base/publico/sugerido
  // — preco_minimo fica de fora porque é custo ÷ (1 − margem).
  produtos: ["produtos_operacional", "produtos_comercial", "produtos_financeiro"],
} as const;

type ProtectedEntity = keyof typeof viewByAccess;

const INDICE: Record<NivelDeVisao, 0 | 1 | 2> = { operacional: 0, comercial: 1, financeiro: 2 };

/**
 * Aceita o nível novo ou o boolean antigo (`canSeeFinancials`): `true` é
 * financeiro, `false` é operacional. Os chamadores que só sabem "vê dinheiro
 * ou não" continuam certos; os que mostram preço ao vendedor passam o nível.
 */
export function financialView(entity: ProtectedEntity, nivel: NivelDeVisao | boolean): string {
  const n: NivelDeVisao = typeof nivel === "boolean" ? (nivel ? "financeiro" : "operacional") : nivel;
  return viewByAccess[entity][INDICE[n]];
}

export function fromFinancialView<E extends ProtectedEntity>(entity: E, nivel: NivelDeVisao | boolean) {
  const view = financialView(entity, nivel);
  // Views mirror the base table shape but aren't in generated types;
  // use a dynamic builder so generated table typings don't reject view names.
  return (supabase as any).from(view);
}
