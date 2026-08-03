GRANT EXECUTE ON FUNCTION public.require_permission(text) TO authenticated;

ALTER TABLE public.orcamentos ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS contato_nome text;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS contato_telefone text;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS contato_email text;

ALTER TABLE public.orcamentos_3d ADD COLUMN IF NOT EXISTS contato_nome text;
ALTER TABLE public.orcamentos_3d ADD COLUMN IF NOT EXISTS contato_telefone text;
ALTER TABLE public.orcamentos_3d ADD COLUMN IF NOT EXISTS contato_email text;

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(p_orcamento_id uuid, p_opcoes jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID; v_orc public.orcamentos%ROWTYPE; v_os_id UUID; v_conta_id UUID; v_parcelas INT; v_i INT;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL THEN RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true); END IF;
  IF v_orc.cliente_id IS NULL THEN RAISE EXCEPTION 'Vincule um cliente cadastrado antes de converter este orçamento em OS'; END IF;
  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN RAISE EXCEPTION 'Orçamento sem versão aprovada'; END IF;
  INSERT INTO public.ordens_servico(cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes, prazo_entrega, valor_total, custo_previsto, created_by, status_geral)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing, v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado, v_uid, 'entrada') RETURNING id INTO v_os_id;
  INSERT INTO public.itens_os(os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem, produto_snapshot, parametros)
  SELECT v_os_id, id, produto_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem, produto_snapshot, parametros FROM public.orcamento_itens WHERE orcamento_id=p_orcamento_id ORDER BY ordem;
  UPDATE public.orcamentos SET os_id=v_os_id WHERE id=p_orcamento_id;
  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total) VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total) RETURNING id INTO v_conta_id;
  v_parcelas := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  FOR v_i IN 1..v_parcelas LOOP INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento) VALUES (v_conta_id, v_i, round(v_orc.valor_total / v_parcelas, 2), CURRENT_DATE + ((v_i-1) * 30)); END LOOP;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id) VALUES ('orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os', 'Orçamento convertido em OS', jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id), v_uid);
  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.converter_orcamento_3d_em_os_guard() RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;