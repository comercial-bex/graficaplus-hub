import { supabase } from "@/integrations/supabase/client";

const viewByAccess = {
  orcamentos: ["orcamentos_operacional", "orcamentos_financeiro"],
  orcamento_itens: ["orcamento_itens_operacional", "orcamento_itens_financeiro"],
  ordens_servico: ["ordens_servico_operacional", "ordens_servico_financeiro"],
  itens_os: ["itens_os_operacional", "itens_os_financeiro"],
  materiais: ["materiais_operacional", "materiais_financeiro"],
  // `produtos` foi removido: produtos_financeiro nunca existiu no banco, então
  // fromFinancialView("produtos", true) apontaria para uma view inexistente e
  // falharia só para quem tem permissão financeira. Ninguém usava a entrada.
  // Para reintroduzir é preciso antes uma tabela-espelho de preço/custo de
  // produto (como os_resultados_financeiros faz para OS) — conceder SELECT nas
  // colunas de custo da tabela base furaria a proteção, porque as views são
  // security_invoker e o grant vale para todo `authenticated`.
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
