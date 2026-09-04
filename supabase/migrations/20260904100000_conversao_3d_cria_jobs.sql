-- A conversão do orçamento 3D nunca criou a fila de impressão.
--
-- Falha minha, e do tipo que só aparece rodando: em 20260901130000 eu criei
-- `criar_jobs_3d_da_os` e escrevi no comentário que era "o elo que faltava entre
-- o orçamento 3D e a fila de impressão". A função ficou pronta, correta — e
-- ninguém a chamava. O elo continuou faltando.
--
-- Medido agora: orçamento 3D de 3 peças convertido em OS gerou OS, item, conta a
-- receber e evento, e ZERO jobs. Como o gatilho `tg_consumo_filamento` pendura
-- no apontamento, e o apontamento pendura no job, a cadeia inteira ficava sem
-- começo: a fila nascia vazia e o filamento nunca saía do estoque.

create or replace function public.converter_orcamento_3d_em_os(p_orcamento_3d_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_uid uuid;
  v_orc public.orcamentos_3d%ROWTYPE;
  v_calc public.orcamento_3d_calculos%ROWTYPE;
  v_os_id uuid;
  v_item_id uuid;
  v_conta_id uuid;
  v_qtd numeric;
  v_custo numeric;
  v_jobs int;
BEGIN
  v_uid := require_permission('impressao3d.quote.approve');
  SELECT * INTO v_orc FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento 3D não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_3d_id', p_orcamento_3d_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;
  IF v_orc.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Orçamento 3D sem cliente — associe um cliente antes de converter';
  END IF;

  SELECT * INTO v_calc FROM public.orcamento_3d_calculos
   WHERE orcamento_3d_id = p_orcamento_3d_id ORDER BY versao DESC LIMIT 1;

  v_qtd := GREATEST(COALESCE(v_orc.quantidade, 1), 1);
  v_custo := COALESCE(v_calc.custo_operacional, 0);

  -- Sem cálculo salvo, o custo previsto caía em ZERO e a OS relatava margem de
  -- 100% — o mesmo defeito que a vw_resultado_os já corrige no 2D. Aqui o
  -- filamento das placas é um custo previsto de verdade, e o orçamento 3D o
  -- conhece grama a grama. É material apenas, não custo completo, mas é
  -- infinitamente melhor que fingir zero.
  IF v_custo <= 0 THEN
    SELECT COALESCE(sum(c.custo_total * GREATEST(COALESCE(pl.repeticoes, 1), 1)), 0)
      INTO v_custo
      FROM public.orcamento_3d_placas pl
      JOIN public.orcamento_3d_consumos c ON c.placa_id = pl.id
     WHERE pl.orcamento_3d_id = p_orcamento_3d_id;
  END IF;

  INSERT INTO public.ordens_servico (cliente_id, titulo, observacoes, valor_total, custo_previsto, created_by, status_geral)
  VALUES (v_orc.cliente_id, v_orc.titulo, 'Origem: orçamento 3D '||p_orcamento_3d_id::text,
          v_orc.preco_comercial, v_custo, v_uid, 'entrada')
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os (os_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem)
  VALUES (v_os_id, v_orc.titulo, v_qtd, 'un',
          round(COALESCE(v_orc.preco_comercial, 0) / v_qtd, 2),
          round(v_custo / v_qtd, 2), COALESCE(v_orc.preco_comercial, 0), 1)
  RETURNING id INTO v_item_id;

  UPDATE public.orcamentos_3d SET os_id = v_os_id, status = 'convertido' WHERE id = p_orcamento_3d_id;

  -- O ELO QUE FALTAVA: um job por placa × repetição.
  v_jobs := public.criar_jobs_3d_da_os(p_orcamento_3d_id, v_os_id);

  -- A OS 3D tem um item só; amarrar os jobs a ele fecha job -> item -> OS, que é
  -- o caminho que o custo realizado percorre de volta.
  UPDATE public.producao_3d_jobs SET os_item_id = v_item_id
   WHERE os_id = v_os_id AND os_item_id IS NULL;

  INSERT INTO public.contas_receber (cliente_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, v_os_id, COALESCE(v_orc.preco_comercial, 0))
  RETURNING id INTO v_conta_id;

  INSERT INTO public.parcelas_receber (conta_id, parcela, valor, vencimento)
  VALUES (v_conta_id, 1, COALESCE(v_orc.preco_comercial, 0), CURRENT_DATE);

  INSERT INTO public.eventos_negocio (entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id)
  VALUES ('orcamento', p_orcamento_3d_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
          'Orçamento 3D convertido em OS',
          jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'origem', '3d', 'jobs', v_jobs),
          v_uid);

  RETURN jsonb_build_object('orcamento_3d_id', p_orcamento_3d_id, 'os_id', v_os_id,
                            'conta_id', v_conta_id, 'jobs', v_jobs);
END
$function$;

comment on function public.converter_orcamento_3d_em_os is
  'Orçamento 3D vira OS, item, fila de impressão (um job por placa × repetição), conta e parcela. Sem a fila, o apontamento não tinha onde se pendurar e o filamento nunca saía do estoque.';
