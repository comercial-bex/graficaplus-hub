-- O dashboard não mostrava dinheiro que ENTROU (24/10/2026).
-- "Faturamento" do painel é a soma do valor das OS (vw_resultado_os.receita_liquida):
-- é o que foi vendido, não o que foi recebido. Dar baixa numa parcela
-- (confirmar_pagamento → pagamentos) nunca mexia em nenhum número do painel;
-- por isso o dono via a baixa feita e o dashboard "parado".
-- `dashboard_caixa()` entrega o que entrou (hoje, 7 dias, mês, mês anterior) e o
-- que ainda falta receber, direto de `pagamentos` e `parcelas_receber`. Só quem
-- vê financeiro (financeiro.read). "Hoje" e "mês" no fuso de Belém.
-- Desfazer: DROP FUNCTION public.dashboard_caixa();
CREATE OR REPLACE FUNCTION public.dashboard_caixa()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/Belem'))::date;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'Seu perfil não vê o financeiro.' USING ERRCODE = '42501';
  END IF;
  WITH pg AS (
    SELECT valor, data_pagamento, created_at FROM public.pagamentos
     WHERE status = 'pago' AND pagamento_estornado_id IS NULL
  ), abertas AS (
    SELECT p.id, p.valor - COALESCE((SELECT sum(x.valor) FROM public.pagamentos x
             WHERE x.parcela_id = p.id AND x.status = 'pago' AND x.pagamento_estornado_id IS NULL), 0) AS falta,
           p.vencimento
      FROM public.parcelas_receber p WHERE p.status <> 'paga'
  )
  SELECT jsonb_build_object(
    'recebido_hoje',          COALESCE((SELECT sum(valor) FROM pg WHERE data_pagamento = v_hoje), 0),
    'recebido_7_dias',        COALESCE((SELECT sum(valor) FROM pg WHERE data_pagamento > v_hoje - 7), 0),
    'recebido_mes',           COALESCE((SELECT sum(valor) FROM pg WHERE data_pagamento >= v_mes), 0),
    'recebido_mes_anterior',  COALESCE((SELECT sum(valor) FROM pg WHERE data_pagamento >= (v_mes - interval '1 month') AND data_pagamento < v_mes), 0),
    'recebimentos_mes',       (SELECT count(*) FROM pg WHERE data_pagamento >= v_mes),
    'ultimo_recebimento_em',  (SELECT max(created_at) FROM pg),
    'em_aberto',              COALESCE((SELECT sum(falta) FROM abertas WHERE falta > 0), 0),
    'parcelas_em_aberto',     (SELECT count(*) FROM abertas WHERE falta > 0),
    'atrasado',               COALESCE((SELECT sum(falta) FROM abertas WHERE falta > 0 AND vencimento < v_hoje), 0),
    'parcelas_sem_vencimento',(SELECT count(*) FROM abertas WHERE falta > 0 AND vencimento IS NULL)
  ) INTO r;
  RETURN r;
END
$function$;
REVOKE ALL ON FUNCTION public.dashboard_caixa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_caixa() TO authenticated;
