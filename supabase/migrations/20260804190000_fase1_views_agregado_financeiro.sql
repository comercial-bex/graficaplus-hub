-- Fase 1 (parte 2) — views de agregado financeiro liam a tabela base protegida.
--
-- vw_resultado_os lia valor_total / desconto / custo_previsto / status_financeiro
-- direto de ordens_servico, e vw_dashboard_comercial lia orcamentos.valor_total +
-- orcamento_itens.margem_prevista. Essas colunas têm o SELECT deliberadamente
-- revogado para `authenticated` (proteção de custo), e como as views são
-- security_invoker=true elas falhavam inteiras com "permission denied".
--
-- Consequência: Dashboard sem faturamento/custo/lucro/margem/atrasadas, porque
-- vw_dashboard_financeiro e vw_dashboard_prazos derivam de vw_resultado_os.
--
-- Conceder o grant dessas colunas resolveria o sintoma e abriria o custo para
-- qualquer usuário autenticado. A correção certa é usar as tabelas-espelho que
-- o sistema já mantém para isso — os_resultados_financeiros (trigger
-- tg_sync_os_resultados_financeiros) e orcamento_custos (tg_sync_orcamento_custos).
-- Ambas têm SELECT liberado mas RLS `can_see_financials(auth.uid())`: quem não
-- pode ver custo simplesmente não enxerga as linhas, e os agregados vêm zerados
-- em vez de estourar erro.
--
-- Os campos puramente operacionais (prazo_entrega, status) continuam vindo de
-- ordens_servico, então "atrasadas" segue visível para quem não tem permissão
-- financeira — que é o comportamento correto para um indicador de prazo.

-- 0) Higiene: havia 1 linha órfã em os_resultados_financeiros e 1 em
--    item_os_custos apontando para OS/itens inexistentes, apesar de as FKs
--    existirem com ON DELETE CASCADE e validadas — resquício de restore feito
--    com as triggers desabilitadas. Como são valores financeiros, inflariam os
--    agregados assim que a operação começasse. Removidos e FKs revalidadas.
DELETE FROM public.os_resultados_financeiros f
WHERE NOT EXISTS (SELECT 1 FROM public.ordens_servico o WHERE o.id = f.os_id);

DELETE FROM public.item_os_custos c
WHERE NOT EXISTS (SELECT 1 FROM public.itens_os i WHERE i.id = c.item_os_id);

-- 1) A tabela-espelho ainda não guardava desconto nem status_financeiro.
ALTER TABLE public.os_resultados_financeiros
  ADD COLUMN IF NOT EXISTS desconto numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_financeiro public.status_pagamento NOT NULL DEFAULT 'pendente';

-- 2) Trigger passa a sincronizar as duas colunas novas.
CREATE OR REPLACE FUNCTION public.tg_sync_os_resultados_financeiros()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.os_resultados_financeiros (
    os_id, valor_total, custo_previsto, custo_real, margem_real,
    desconto, status_financeiro, updated_at
  )
  VALUES (
    NEW.id, NEW.valor_total, NEW.custo_previsto, NEW.custo_real, NEW.margem_real,
    COALESCE(NEW.desconto, 0), COALESCE(NEW.status_financeiro, 'pendente'), now()
  )
  ON CONFLICT (os_id) DO UPDATE SET
    valor_total       = EXCLUDED.valor_total,
    custo_previsto    = EXCLUDED.custo_previsto,
    custo_real        = EXCLUDED.custo_real,
    margem_real       = EXCLUDED.margem_real,
    desconto          = EXCLUDED.desconto,
    status_financeiro = EXCLUDED.status_financeiro,
    updated_at        = now();
  RETURN NEW;
END $function$;

-- 3) Backfill das OS já existentes.
INSERT INTO public.os_resultados_financeiros (
  os_id, valor_total, custo_previsto, custo_real, margem_real,
  desconto, status_financeiro, updated_at
)
SELECT os.id, os.valor_total, os.custo_previsto, os.custo_real, os.margem_real,
       COALESCE(os.desconto, 0), COALESCE(os.status_financeiro, 'pendente'), now()
FROM public.ordens_servico os
ON CONFLICT (os_id) DO UPDATE SET
  desconto          = EXCLUDED.desconto,
  status_financeiro = EXCLUDED.status_financeiro,
  updated_at        = now();

-- 4) vw_resultado_os passa a ler o financeiro da tabela-espelho.
--    Colunas e ordem preservadas (CREATE OR REPLACE exige assinatura idêntica).
CREATE OR REPLACE VIEW public.vw_resultado_os
WITH (security_invoker = true) AS
SELECT
  os.id AS os_id,
  COALESCE(f.valor_total, 0::numeric) AS receita_bruta,
  COALESCE(f.desconto, 0::numeric) AS descontos,
  COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric) AS receita_liquida,
  COALESCE(f.custo_previsto, 0::numeric) AS custo_previsto,
  COALESCE((SELECT sum(r.quantidade * l.custo_unitario_snapshot)
            FROM estoque_reservas r
            LEFT JOIN material_lotes l ON l.id = r.lote_id
            WHERE r.os_id = os.id), 0::numeric) AS custo_reservado,
  COALESCE((SELECT sum(co.total) FROM custos_operacionais_os co
            WHERE co.os_id = os.id), 0::numeric) AS custo_realizado,
  COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)
    - COALESCE(f.custo_previsto, 0::numeric) AS lucro_previsto,
  COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)
    - COALESCE((SELECT sum(co.total) FROM custos_operacionais_os co
                WHERE co.os_id = os.id), 0::numeric) AS lucro_realizado,
  CASE WHEN (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)) > 0::numeric
       THEN (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)
             - COALESCE(f.custo_previsto, 0::numeric))
            / (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric))
       ELSE NULL::numeric END AS margem_prevista,
  CASE WHEN (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)) > 0::numeric
       THEN (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric)
             - COALESCE((SELECT sum(co.total) FROM custos_operacionais_os co
                         WHERE co.os_id = os.id), 0::numeric))
            / (COALESCE(f.valor_total, 0::numeric) - COALESCE(f.desconto, 0::numeric))
       ELSE NULL::numeric END AS margem_realizada,
  COALESCE((SELECT sum(co.total) FROM custos_operacionais_os co
            WHERE co.os_id = os.id), 0::numeric)
    - COALESCE(f.custo_previsto, 0::numeric) AS divergencia_custo,
  COALESCE((SELECT sum(co.total) FROM custos_operacionais_os co
            WHERE co.os_id = os.id AND co.categoria = 'retrabalho'::text), 0::numeric) AS retrabalho,
  CASE WHEN os.prazo_entrega IS NOT NULL
        AND os.prazo_entrega < now()
        AND (os.status::text <> ALL (ARRAY['concluido'::text, 'faturado'::text, 'cancelado'::text]))
       THEN true ELSE false END AS atraso,
  COALESCE(f.status_financeiro, 'pendente'::status_pagamento) AS status_financeiro
FROM public.ordens_servico os
LEFT JOIN public.os_resultados_financeiros f ON f.os_id = os.id;

-- 5) vw_dashboard_comercial passa a ler de orcamento_custos.
--    margem vem de orcamento_custos.margem_estimada (orcamento_itens também é protegida).
CREATE OR REPLACE VIEW public.vw_dashboard_comercial
WITH (security_invoker = true) AS
SELECT
  count(*) FILTER (WHERE o.created_at >= date_trunc('month'::text, now())) AS orcamentos_mes,
  COALESCE(avg(oc.valor_total), 0::numeric) AS ticket_medio,
  COALESCE(avg(oc.margem_estimada), 0::numeric) AS margem_prevista
FROM public.orcamentos o
LEFT JOIN public.orcamento_custos oc ON oc.orcamento_id = o.id;
