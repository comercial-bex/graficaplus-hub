-- O painel e os relatórios param de transformar "sem custo" em número.
--
-- Continuação de 20260910120000. Aquela migração fez `vw_resultado_os`
-- devolver NULL em margem e lucro realizados quando nenhum custo foi lançado.
-- Correto na origem — mas três consumidores embrulhavam o resultado de novo
-- num COALESCE(…, 0), e a mentira mudou de lugar em vez de sumir:
--
--   vw_dashboard_financeiro   margem ia de 100% (antes) para 0% (depois)
--   rel_previsto_realizado    variacao_margem = 0 − 50 = −50 pontos
--   rel_lucro_por_os          margem 100% — por um caminho próprio
--
-- O terceiro merece explicação. `rel_lucro_por_os` calculava o custo como
-- COALESCE(NULLIF(custos_lancados, 0), os.custo_real, os.custo_previsto, 0).
-- Alguém tentou separar zero de ausência com o NULLIF — mas
-- `ordens_servico.custo_real` é NOT NULL DEFAULT 0, então para toda OS aberta
-- ele vale 0 e o COALESCE para ali, sem nunca chegar ao previsto. Resultado:
-- custo 0, lucro = receita, margem 100%. E este relatório NÃO estava morto: a
-- tela /relatorios lê os dez `rel_*` por dentro de `get_relatorios_prioritarios`.
--
-- A regra, a mesma de antes: custo real é o que está em custos_operacionais_os.
-- Não existe linha lá? Então não existe custo real — e margem e lucro
-- realizados não existem. Não é zero, não é o previsto, é ausência.

-- ─── Painel ────────────────────────────────────────────────────────────────
-- Colunas antigas mantêm nome, ordem e tipo (CREATE OR REPLACE VIEW só
-- acrescenta no fim). As três novas deixam a tela dizer DE QUANTAS OS vem a
-- margem, em vez de apresentar a média de um subconjunto como se fosse o todo.
CREATE OR REPLACE VIEW public.vw_dashboard_financeiro
WITH (security_invoker = true) AS
SELECT
  COALESCE(sum(receita_liquida), 0) AS faturamento,
  sum(custo_realizado) FILTER (WHERE custo_lancado) AS custo,
  sum(lucro_realizado) AS lucro,
  -- avg ignora NULL: é a média das OS que TÊM custo, que é a única média que
  -- existe. Sem nenhuma, fica NULL — antes o COALESCE a transformava em 0%.
  avg(margem_realizada) AS margem,
  count(*) FILTER (WHERE custo_lancado) AS os_com_custo,
  count(*) AS os_total,
  COALESCE(sum(receita_liquida) FILTER (WHERE custo_lancado), 0) AS faturamento_com_custo
FROM public.vw_resultado_os;

COMMENT ON VIEW public.vw_dashboard_financeiro IS
  'Números do painel. custo, lucro e margem são NULL quando nenhuma OS tem custo lançado; os_com_custo/os_total dizem de quantas OS a margem vem.';

-- ─── Previsto × realizado ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.rel_previsto_realizado
WITH (security_invoker = true) AS
SELECT
  r.os_id,
  o.numero,
  o.titulo,
  COALESCE(c.nome, 'Sem cliente') AS cliente,
  o.created_at::date AS criada_em,
  o.status::text AS status,
  r.receita_liquida,
  r.custo_previsto,
  r.custo_realizado,
  -- Comparar custo ausente com o previsto dá o previsto inteiro com sinal
  -- trocado: −60,58, que parece economia e é falta de dado.
  CASE WHEN r.custo_lancado THEN r.divergencia_custo END AS divergencia_custo,
  CASE WHEN r.custo_lancado AND COALESCE(r.custo_previsto, 0) > 0
       THEN round((r.divergencia_custo / r.custo_previsto) * 100, 1)
  END AS divergencia_pct,
  r.margem_prevista,
  r.margem_realizada,
  CASE WHEN r.margem_realizada IS NOT NULL AND r.margem_prevista IS NOT NULL
       THEN round(r.margem_realizada - r.margem_prevista, 2)
  END AS variacao_margem,
  r.retrabalho,
  r.atraso,
  r.custo_lancado
FROM public.vw_resultado_os r
JOIN public.ordens_servico o ON o.id = r.os_id
LEFT JOIN public.clientes c ON c.id = o.cliente_id;

-- ─── Lucro por OS ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.rel_lucro_por_os
WITH (security_invoker = true) AS
SELECT
  os.id AS os_id,
  os.numero,
  os.titulo,
  c.nome AS cliente,
  os.created_at::date AS criada_em,
  os.status,
  COALESCE(pg.receita, os.valor_total, 0)::numeric(12,2) AS receita,
  -- Só o que foi LANÇADO. Nem `custo_real` (default 0 em toda OS aberta) nem
  -- o previsto (que é estimativa, e este relatório se chama lucro).
  co.custos_lancados::numeric(12,2) AS custo,
  -- O cast vai em volta do CASE inteiro: sem ELSE, o CASE resolve para
  -- `numeric` puro, e a view recusa trocar o tipo de numeric(12,2).
  (CASE WHEN co.custos_lancados IS NOT NULL
        THEN COALESCE(pg.receita, os.valor_total, 0) - co.custos_lancados
   END)::numeric(12,2) AS lucro,
  CASE WHEN co.custos_lancados IS NOT NULL AND COALESCE(pg.receita, os.valor_total, 0) > 0
       THEN round(((COALESCE(pg.receita, os.valor_total, 0) - co.custos_lancados)
             / COALESCE(pg.receita, os.valor_total, 0)) * 100, 2)
  END AS margem_percentual,
  -- Novas: o previsto continua disponível, mas com o nome certo.
  os.custo_previsto::numeric(12,2) AS custo_previsto,
  (co.custos_lancados IS NOT NULL) AS custo_lancado
FROM public.ordens_servico os
JOIN public.clientes c ON c.id = os.cliente_id
LEFT JOIN LATERAL (
  SELECT sum(p.valor) AS receita FROM public.pagamentos p
  WHERE p.os_id = os.id AND p.status = 'pago'::status_pagamento
) pg ON true
LEFT JOIN LATERAL (
  SELECT sum(co1.total) AS custos_lancados FROM public.custos_operacionais_os co1
  WHERE co1.os_id = os.id
) co ON true;

-- ─── A ordenação dos relatórios ────────────────────────────────────────────
-- `ORDER BY lucro DESC` no Postgres coloca NULL PRIMEIRO. Com o lucro agora
-- vazio para OS sem custo, elas subiriam para o topo do ranking de lucro.
-- NULLS LAST — como `previstoRealizado` já fazia. O resto da função não muda.
CREATE OR REPLACE FUNCTION public.get_relatorios_prioritarios(
  p_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date,
  p_fim date DEFAULT CURRENT_DATE
)
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
      'retrabalhoPorSetor', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.retrabalhos DESC) FROM (
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
