-- View agregada de custos por categoria para o dashboard.
-- Antes o dashboard trazia TODAS as linhas de custos_operacionais_os para o
-- cliente e agregava em JS. Como essa tabela recebe também uma linha por baixa
-- de estoque/material (origem='baixa_estoque'), o volume cresce sem limite.
-- Esta view move a agregação para o banco (uma linha por categoria).
-- Segue o mesmo padrão das demais vw_dashboard_* (roda como owner; GRANT a authenticated).

CREATE OR REPLACE VIEW public.vw_dashboard_custos_categoria AS
  SELECT COALESCE(categoria, 'Outros') AS categoria,
         COALESCE(sum(total), 0)::numeric(14,2) AS total
    FROM public.custos_operacionais_os
   GROUP BY COALESCE(categoria, 'Outros');

GRANT SELECT ON public.vw_dashboard_custos_categoria TO authenticated;
