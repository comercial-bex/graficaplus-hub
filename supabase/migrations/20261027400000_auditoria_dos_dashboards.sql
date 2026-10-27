-- 27/10/2026 — auditoria dos dashboards: números que não batiam com o banco.
--
-- 1) ponto_de_equilibrio contava os dias do mês pelo CURRENT_DATE do banco, que é UTC. A partir das
--    21h de Macapá o banco já está no dia seguinte: o painel dizia "26 de 31 dias fecharam" no dia 26
--    (eram 25) e o ritmo esperado subia de 80,6% para 83,9% de um minuto para o outro. Tudo passa a
--    ser contado no relógio de Macapá, inclusive as viradas de mês dos timestamps.
-- 2) baixa_de_estoque_pendente dizia "14 de 14 OS concluídas sem baixa de material": 13 delas são OS de
--    uso interno (auditorias do RIP, valor zero, sem material previsto) — não há o que baixar. Só conta
--    OS de venda ou OS que tenha material previsto.
-- 3) vw_dashboard_financeiro contava as 13 OS de uso interno e a cancelada no "lucro de 4 de 29 OS":
--    a cobertura do custo parecia 14% quando é 4 de 15. Passa a olhar só OS de venda não cancelada.
-- 4) vw_dashboard_comercial.ticket_medio era a média do valor_total de orcamento_custos de TODO
--    orçamento (rascunho, recusado, duplicado pelo LEFT JOIN): R$ 473,05. O ticket é o valor médio do
--    que o cliente aprovou no mês.

-- 1) ponto_de_equilibrio no relógio de Macapá ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ponto_de_equilibrio(p_mes date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_ini date := date_trunc('month', COALESCE(p_mes, (now() AT TIME ZONE 'America/Belem')::date))::date;
  v_fim date := (date_trunc('month', COALESCE(p_mes, (now() AT TIME ZONE 'America/Belem')::date)) + INTERVAL '1 month')::date;
  v_ini_ts timestamptz := v_ini::timestamp AT TIME ZONE 'America/Belem';
  v_fim_ts timestamptz := v_fim::timestamp AT TIME ZONE 'America/Belem';
  v_custo_fixo numeric; v_material_pct numeric;
  v_perda numeric; v_falha numeric; v_imposto numeric; v_cartao numeric;
  v_cv numeric; v_mc numeric;
  v_meta numeric; v_realizado numeric; v_em_aberto numeric; v_backlog numeric;
BEGIN
  IF NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'Este número é do financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO v_custo_fixo
  FROM public.contas_pagar WHERE vencimento >= v_ini AND vencimento < v_fim;

  SELECT COALESCE(avg(pp.custo_medio / NULLIF(pp.preco_base, 0)), 0.40) INTO v_material_pct
  FROM public.produto_precos pp JOIN public.produtos p ON p.id = pp.produto_id
  WHERE p.ativo AND pp.preco_base > 0 AND pp.custo_medio > 0;

  SELECT COALESCE(max(valor) FILTER (WHERE codigo = 'pct_perda_material'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'pct_falha_producao'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'impostos_venda'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'taxa_cartao'), 0) / 100
    INTO v_perda, v_falha, v_imposto, v_cartao
  FROM public.custos_tabela WHERE ativo;

  v_cv := v_material_pct * (1 + v_perda + v_falha) + v_imposto + (v_cartao / 2);
  v_mc := 1 - v_cv;
  v_meta := CASE WHEN v_mc > 0 THEN v_custo_fixo / v_mc ELSE NULL END;

  -- Quando a OS fechou. `updated_at` NÃO serve: é carimbo de última alteração. Usa data_fechamento e,
  -- quando ela falta, o momento em que a OS entrou no status final pelo histórico (no relógio de Macapá).
  SELECT COALESCE(sum(f.valor_total), 0) INTO v_realizado
  FROM public.ordens_servico os
  JOIN public.os_resultados_financeiros f ON f.os_id = os.id
  WHERE os.status IN ('faturado', 'concluido')
    AND COALESCE(
          os.data_fechamento,
          (SELECT (max(h.mudou_em) AT TIME ZONE 'America/Belem')::date FROM public.os_status_historico h
            WHERE h.os_id = os.id AND h.status_novo IN ('faturado', 'concluido')),
          (os.updated_at AT TIME ZONE 'America/Belem')::date
        ) >= v_ini
    AND COALESCE(
          os.data_fechamento,
          (SELECT (max(h.mudou_em) AT TIME ZONE 'America/Belem')::date FROM public.os_status_historico h
            WHERE h.os_id = os.id AND h.status_novo IN ('faturado', 'concluido')),
          (os.updated_at AT TIME ZONE 'America/Belem')::date
        ) < v_fim;

  -- Vendido e ainda não faturado: o que nasceu DENTRO do mês e o backlog inteiro.
  SELECT COALESCE(sum(f.valor_total) FILTER (WHERE os.created_at >= v_ini_ts AND os.created_at < v_fim_ts), 0),
         COALESCE(sum(f.valor_total), 0)
    INTO v_em_aberto, v_backlog
  FROM public.ordens_servico os
  JOIN public.os_resultados_financeiros f ON f.os_id = os.id
  WHERE os.status NOT IN ('faturado', 'concluido', 'cancelado');

  RETURN jsonb_build_object(
    'mes', v_ini, 'custo_fixo', round(v_custo_fixo, 2),
    'material_pct', round(v_material_pct * 100, 1), 'perda_pct', round(v_perda * 100, 1),
    'falha_pct', round(v_falha * 100, 1), 'imposto_pct', round(v_imposto * 100, 1),
    'cartao_pct', round(v_cartao * 100, 1), 'custo_variavel_pct', round(v_cv * 100, 1),
    'margem_contribuicao_pct', round(v_mc * 100, 1), 'meta_faturamento', round(v_meta, 2),
    'realizado', round(v_realizado, 2),
    'em_producao', round(v_em_aberto, 2),
    'backlog_total', round(v_backlog, 2),
    'falta', round(GREATEST(v_meta - v_realizado, 0), 2),
    'atingido_pct', CASE WHEN v_meta > 0 THEN round(100 * v_realizado / v_meta, 1) ELSE 0 END,
    'dias_no_mes', (v_fim - v_ini),
    'dias_corridos', LEAST(GREATEST(v_hoje - v_ini, 0), (v_fim - v_ini)),
    'hoje', v_hoje,
    'vendido', round(
      COALESCE((SELECT sum(o.valor_total) FROM public.orcamentos o
                 WHERE o.status::text IN ('aprovado', 'convertido')
                   AND COALESCE(o.aprovado_em, o.updated_at) >= v_ini_ts AND COALESCE(o.aprovado_em, o.updated_at) < v_fim_ts), 0)
      + COALESCE((SELECT sum(f.valor_total) FROM public.ordens_servico os
                   JOIN public.os_resultados_financeiros f ON f.os_id = os.id
                  WHERE os.finalidade = 'venda' AND os.status <> 'cancelado' AND os.orcamento_id IS NULL
                    AND os.created_at >= v_ini_ts AND os.created_at < v_fim_ts), 0), 2),
    'orcamentos_aprovados_n', (SELECT count(*) FROM public.orcamentos o
                 WHERE o.status::text IN ('aprovado', 'convertido')
                   AND COALESCE(o.aprovado_em, o.updated_at) >= v_ini_ts AND COALESCE(o.aprovado_em, o.updated_at) < v_fim_ts),
    'recebido', round(COALESCE((SELECT sum(p.valor) FROM public.pagamentos p
                 WHERE p.status = 'pago' AND p.pagamento_estornado_id IS NULL
                   AND p.data_pagamento >= v_ini AND p.data_pagamento < v_fim), 0), 2),
    'os_concluidas_n', (SELECT count(*) FROM public.ordens_servico os
                 WHERE os.finalidade = 'venda' AND os.status IN ('faturado', 'concluido')),
    'os_abertas_n', (SELECT count(*) FROM public.ordens_servico os
                 WHERE os.finalidade = 'venda' AND os.status NOT IN ('faturado', 'concluido', 'cancelado'))
  );
END $function$;

-- 2) baixa_de_estoque_pendente: só o que tem material a baixar ------------------------------------------
-- A função tem 400 linhas e já foi reescrita várias vezes: em vez de colar outra cópia, troca só o
-- trecho da regra (e para se o trecho não for encontrado, para não aplicar em silêncio uma regra velha).
DO $migracao$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$FROM public.ordens_servico WHERE status IN ('concluido','faturado') AND coalesce(estoque_baixado,false)=false HAVING count(*)>0;$a$,
    $b$FROM public.ordens_servico os WHERE os.status IN ('concluido','faturado') AND coalesce(os.estoque_baixado,false)=false
    AND (os.finalidade::text = 'venda' OR EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = os.id))
  HAVING count(*)>0;$b$);
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'pendencias_do_sistema mudou: o trecho de baixa_de_estoque_pendente não foi encontrado';
  END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$(SELECT count(*)::int FROM public.ordens_servico WHERE status IN ('concluido','faturado')),'critico','gestao',$a$,
    $b$(SELECT count(*)::int FROM public.ordens_servico os2 WHERE os2.status IN ('concluido','faturado')
        AND (os2.finalidade::text = 'venda' OR EXISTS (SELECT 1 FROM public.os_materiais_previstos m2 WHERE m2.os_id = os2.id))),'critico','gestao',$b$);
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'pendencias_do_sistema mudou: o total de baixa_de_estoque_pendente não foi encontrado';
  END IF;
  EXECUTE v_novo;
END
$migracao$;

-- 2b) estoque_nunca_carregado levava para Materiais, que não tem entrada em lote. A folha de contagem
--     mora em Movimentações (e o painel agora a abre num pop-up com só estes materiais).
DO $migracao$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$Faça a entrada inicial do que já está na prateleira.','/materiais'$a$,
    $b$Faça a entrada inicial do que já está na prateleira.','/movimentacoes'$b$);
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'pendencias_do_sistema mudou: o link de estoque_nunca_carregado não foi encontrado';
  END IF;
  EXECUTE v_novo;
END
$migracao$;

-- 3) vw_dashboard_financeiro: só OS de venda que não foi cancelada ----------------------------------------
CREATE OR REPLACE VIEW public.vw_dashboard_financeiro AS
 SELECT COALESCE(sum(r.receita_liquida), (0)::numeric) AS faturamento,
    sum(r.custo_realizado) FILTER (WHERE r.custo_lancado) AS custo,
    sum(r.lucro_realizado) AS lucro,
    avg(r.margem_realizada) AS margem,
    count(*) FILTER (WHERE r.custo_lancado) AS os_com_custo,
    count(*) AS os_total,
    COALESCE(sum(r.receita_liquida) FILTER (WHERE r.custo_lancado), (0)::numeric) AS faturamento_com_custo
   FROM public.vw_resultado_os r
   JOIN public.ordens_servico o ON o.id = r.os_id
  WHERE o.finalidade::text = 'venda' AND o.status::text <> 'cancelado';
-- CREATE OR REPLACE VIEW descarta as opções da view: repor.
ALTER VIEW public.vw_dashboard_financeiro SET (security_invoker = true);

-- 4) vw_dashboard_comercial: ticket médio do que foi APROVADO no mês ----------------------------------------
CREATE OR REPLACE VIEW public.vw_dashboard_comercial AS
 SELECT (SELECT count(*) FROM public.orcamentos o
          WHERE o.created_at >= (date_trunc('month', now() AT TIME ZONE 'America/Belem')) AT TIME ZONE 'America/Belem') AS orcamentos_mes,
    COALESCE((SELECT avg(o.valor_total) FROM public.orcamentos o
               WHERE o.status::text IN ('aprovado', 'convertido')
                 AND COALESCE(o.aprovado_em, o.updated_at) >= (date_trunc('month', now() AT TIME ZONE 'America/Belem')) AT TIME ZONE 'America/Belem'),
             (0)::numeric) AS ticket_medio,
    COALESCE((SELECT avg(oc.margem_estimada) FROM public.orcamento_custos oc
               JOIN public.orcamentos o ON o.id = oc.orcamento_id
              WHERE o.status::text IN ('aprovado', 'convertido')
                AND COALESCE(o.aprovado_em, o.updated_at) >= (date_trunc('month', now() AT TIME ZONE 'America/Belem')) AT TIME ZONE 'America/Belem'),
             (0)::numeric) AS margem_prevista;
ALTER VIEW public.vw_dashboard_comercial SET (security_invoker = true);

-- Conferência: a função nova responde no relógio de Macapá e traz o dia que usou.
DO $conferir$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ponto_de_equilibrio' AND prosrc LIKE '%America/Belem%') THEN
    RAISE EXCEPTION 'ponto_de_equilibrio não ficou no relógio de Macapá';
  END IF;
  IF (SELECT count(*) FROM pg_views WHERE viewname IN ('vw_dashboard_financeiro','vw_dashboard_comercial')) <> 2 THEN
    RAISE EXCEPTION 'views do dashboard sumiram';
  END IF;
END
$conferir$;
