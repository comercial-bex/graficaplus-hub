import { supabase } from "@/integrations/supabase/client";

const viewByAccess = {
  orcamentos: ["orcamentos_operacional", "orcamentos_financeiro"],
  orcamento_itens: ["orcamento_itens_operacional", "orcamento_itens_financeiro"],
  ordens_servico: ["ordens_servico_operacional", "ordens_servico_financeiro"],
  itens_os: ["itens_os_operacional", "itens_os_financeiro"],
  materiais: ["materiais_operacional", "materiais_financeiro"],
  // produtos_financeiro passou a existir sobre a tabela-espelho produto_precos
  // (RLS can_see_financials), então preço e custo de produto saem por aqui sem
  // precisar de grant em coluna de custo na tabela base — que valeria para todo
  // `authenticated` e furaria a proteção.
  produtos: ["produtos_operacional", "produtos_financeiro"],
} as const;

type ProtectedEntity = keyof typeof viewByAccess;

export function financialView(entity: ProtectedEntity, canSeeFinancials: boolean) {
  const [operationalView, financialViewName] = viewByAccess[entity];
  return (canSeeFinancials ? financialViewName : operationalView) as string;
}

export function fromFinancialView<E extends ProtectedEntity>(
  entity: E,
  canSeeFinancials: boolean,
) {
  const view = financialView(entity, canSeeFinancials);
  // Views mirror the base table shape but aren't in generated types;
  // use a dynamic builder so generated table typings don't reject view names.
  return (supabase as any).from(view);
}
