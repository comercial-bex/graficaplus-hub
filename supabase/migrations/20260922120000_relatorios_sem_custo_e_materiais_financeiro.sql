-- Duas correções de custo que a verificação do nível comercial encontrou.
--
-- 1. get_relatorios_prioritarios mandava `custo_total` do retrabalho por setor
--    para TODO staff, inclusive quem não vê custo: a RPC é SECURITY DEFINER,
--    então a RLS de `ocorrencias` não segura nada e o custo chegava no JSON do
--    vendedor e do operador. Agora a chave só vai para quem passa em
--    can_see_financials; o front tolera a ausência.
--
-- 2. materiais_financeiro só tinha 6 colunas (id, nome, unidade, estoque,
--    custo_unitario, created_at). A planilha de custos pedia também
--    custo_medio e fornecedor — coluna que a view não tem derruba a consulta
--    inteira (armadilha nº 1), e a aba Materiais da planilha ficava vazia para
--    todo mundo, sem mensagem. A view era security_invoker, e a tabela base
--    não dá SELECT de custo_medio/fornecedor ao papel authenticated — por isso
--    não bastava acrescentar as colunas: ela passa a DEFINER (dona postgres)
--    com o próprio guarda, como as views *_comercial.
--
-- COMO DESFAZER: reaplicar a versão anterior da função (migração
-- 20260911130000_painel_e_relatorios_nao_mentem.sql) e da view
-- (20260531203000).

-- --------------------------------------------------------------- 1. a RPC
CREATE OR REPLACE FUNCTION public.get_relatorios_prioritarios(p_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_fim date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inicio DATE := COALESCE(p_inicio, (CURRENT_DATE - INTERVAL '30 days')::date);
  v_fim DATE := COALESCE(p_fim, CURRENT_DATE);
  v_can_fin BOOLEAN := public.can_see_financials(auth.uid());
  v_result JSONB;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado aos relatórios';
  END IF;

  SELECT jsonb_build_object(
    'canSeeFinancials', v_can_fin,
    'periodo', jsonb_build_object('inicio', v_inicio, 'fim', v_fim),
    'financeiro', CASE WHEN v_can_fin THEN jsonb_build_object(
      'faturamentoPorPeriodo', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.periodo) FROM (
        SELECT * FROM public.rel_faturamento_por_periodo WHERE periodo BETWEEN v_inicio AND v_fim) x), '[]'::jsonb),
      'lucroPorOs', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lucro DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_lucro_por_os WHERE criada_em BETWEEN v_inicio AND v_fim LIMIT 100) x), '[]'::jsonb),
      'margemPorProduto', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.margem_valor DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_margem_por_produto WHERE ultima_venda BETWEEN v_inicio AND v_fim LIMIT 100) x), '[]'::jsonb),
      'previstoRealizado', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.divergencia_custo DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_previsto_realizado WHERE criada_em BETWEEN v_inicio AND v_fim LIMIT 100) x), '[]'::jsonb)
    ) ELSE NULL END,
    'operacional', jsonb_build_object(
      'osAtrasadas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.dias_atraso DESC) FROM (
        SELECT * FROM public.rel_os_atrasadas LIMIT 100) x), '[]'::jsonb),
      -- custo do retrabalho só para quem vê custo; os demais recebem a linha sem a chave
      'retrabalhoPorSetor', COALESCE((SELECT jsonb_agg(CASE WHEN v_can_fin THEN to_jsonb(x) ELSE to_jsonb(x) - 'custo_total' END ORDER BY x.retrabalhos DESC) FROM (
        SELECT * FROM public.rel_retrabalho_por_setor WHERE ultima_ocorrencia BETWEEN v_inicio AND v_fim) x), '[]'::jsonb),
      'producaoPorMaquina', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade_produzida DESC) FROM (
        SELECT * FROM public.rel_producao_por_maquina WHERE ultimo_apontamento IS NULL OR ultimo_apontamento BETWEEN v_inicio AND v_fim) x), '[]'::jsonb),
      'tempoMedioPorEtapa', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.horas_media DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_tempo_medio_por_etapa) x), '[]'::jsonb)
    ),
    'whatsapp', jsonb_build_object(
      'conversasAbertas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ultima_mensagem_em DESC) FROM (
        SELECT * FROM public.rel_whatsapp_conversas_abertas WHERE aberta_em::date <= v_fim LIMIT 100) x), '[]'::jsonb),
      'tempoMedioResposta', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.minutos_media_resposta DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_whatsapp_tempo_medio_resposta LIMIT 100) x), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- -------------------------------------------------------------- 2. a view
CREATE OR REPLACE VIEW public.materiais_financeiro
WITH (security_invoker = false, security_barrier = true) AS
  SELECT m.id, m.nome, m.unidade, m.estoque, mc.custo_unitario, m.created_at,
         m.custo_medio, m.fornecedor, m.estoque_minimo, m.estoque_maximo,
         m.localizacao, m.status, m.updated_at, m.largura_bobina_m, m.comprimento_bobina_m
  FROM public.materiais m
  LEFT JOIN public.material_custos mc ON mc.material_id = m.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_financials(auth.uid());
ALTER VIEW public.materiais_financeiro SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.materiais_financeiro FROM PUBLIC, anon;
GRANT SELECT ON public.materiais_financeiro TO authenticated;
