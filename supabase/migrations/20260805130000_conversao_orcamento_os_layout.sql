-- Conversão orçamento -> OS: levar produção, layout e entrega.
--
-- Três perdas na conversão:
--
-- 1) O layout aprovado não chegava à produção. itens_os já tinha arquivo_id, mas
--    orcamento_itens não — agora tem, e a cópia passa a incluí-lo, junto das
--    dimensões, acabamento e preço/m². Sem isso a OS nascia sem vínculo com a
--    arte que o cliente aprovou.
--
-- 2) endereco_entrega, precisa_entrega e precisa_instalacao ficavam no orçamento.
--    A OS não tinha para onde levar o endereço ("Cliente retira na empresa" no
--    documento de referência), então quem produzia não sabia o destino.
--
-- 3) O vencimento das parcelas era CURRENT_DATE + (i-1) * 30, fixo. Ignorava a
--    condição de pagamento negociada e a data real do orçamento. Passa a ler
--    condicao_pagamento: {parcelas, intervalo_dias, primeiro_vencimento}. Os
--    defaults (1, 30, hoje) reproduzem o comportamento anterior, então orçamento
--    sem condição definida converte igual a antes.

ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS endereco_entrega   jsonb,
  ADD COLUMN IF NOT EXISTS condicao_pagamento jsonb;

-- Colunas de produção/logística: vão para as duas views (não são custo).
GRANT SELECT (endereco_entrega) ON public.ordens_servico TO authenticated;

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(
  p_orcamento_id uuid,
  p_opcoes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID;
  v_orc public.orcamentos%ROWTYPE;
  v_os_id UUID;
  v_conta_id UUID;
  v_parcelas INT;
  v_intervalo INT;
  v_primeiro DATE;
  v_valor_parcela NUMERIC;
  v_acumulado NUMERIC := 0;
  v_i INT;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;

  -- idempotente: já convertido devolve a mesma OS
  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;

  IF v_orc.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Vincule um cliente cadastrado antes de converter este orçamento em OS';
  END IF;
  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN
    RAISE EXCEPTION 'Orçamento sem versão aprovada';
  END IF;

  INSERT INTO public.ordens_servico(
    cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes,
    prazo_entrega, valor_total, custo_previsto, desconto, created_by, status_geral,
    endereco_entrega, condicao_pagamento, precisa_entrega, precisa_instalacao
  )
  VALUES (
    v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing,
    v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,
    COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0),
    v_uid, 'entrada',
    v_orc.endereco_entrega, v_orc.condicao_pagamento,
    COALESCE(v_orc.precisa_entrega, false), COALESCE(v_orc.precisa_instalacao, false)
  )
  RETURNING id INTO v_os_id;

  -- Itens: agora com dimensões, acabamento, preço/m² e o layout aprovado.
  INSERT INTO public.itens_os(
    os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  )
  SELECT
    v_os_id, id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  FROM public.orcamento_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem;
  -- valor_total não é copiado: tg_itens_os_precificar o recalcula a partir de
  -- valor_unitario/quantidade, evitando trazer um total já divergente.

  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total)
  RETURNING id INTO v_conta_id;

  v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  v_intervalo := GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'intervalo_dias')::int, 30));
  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>'primeiro_vencimento')::date, CURRENT_DATE);

  -- A última parcela absorve a diferença do arredondamento, para a soma das
  -- parcelas bater exatamente com o total da conta.
  v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);
  FOR v_i IN 1..v_parcelas LOOP
    INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
    VALUES (
      v_conta_id,
      v_i,
      CASE WHEN v_i < v_parcelas
           THEN v_valor_parcela
           ELSE COALESCE(v_orc.valor_total, 0) - v_acumulado
      END,
      v_primeiro + ((v_i - 1) * v_intervalo)
    );
    v_acumulado := v_acumulado + v_valor_parcela;
  END LOOP;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id
  )
  VALUES (
    'orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
    'Orçamento convertido em OS',
    jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas),
    v_uid
  );

  RETURN jsonb_build_object(
    'orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas
  );
END; $function$;
