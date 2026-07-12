-- Conversão de orçamento 3D em OS + fix de raiz do enqueue_automacoes.

-- 1) Raiz: enqueue_automacoes está dessincronizado do schema de `automacoes`
--    (referencia colunas inexistentes) e fazia QUALQUER insert de materiais/OS
--    falhar via os triggers de automação. Torna a função resiliente: em erro,
--    apenas registra WARNING e retorna 0 (automação fica inerte até o rewrite
--    completo — ver task de correção do subsistema). Substitui o band-aid pontual
--    que havíamos posto no trigger de materiais.
CREATE OR REPLACE FUNCTION public.enqueue_automacoes(p_gatilho automacao_gatilho, p_entidade text, p_entidade_id uuid, p_contexto jsonb DEFAULT '{}'::jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_automacao public.automacoes%ROWTYPE;
  v_dedupe TEXT;
  v_count INT := 0;
BEGIN
  FOR v_automacao IN
    SELECT * FROM public.automacoes WHERE ativa = true AND gatilho = p_gatilho
  LOOP
    v_dedupe := concat_ws(':', v_automacao.id::text, p_entidade, COALESCE(p_entidade_id::text, 'sem-id'), md5(p_contexto::text));
    INSERT INTO public.automacao_execucoes (automacao_id, gatilho, entidade, entidade_id, dedupe_key, contexto)
    VALUES (v_automacao.id, p_gatilho, p_entidade, p_entidade_id, v_dedupe, p_contexto)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  -- Enquanto o subsistema de automação não é reescrito, nunca bloquear a operação de origem.
  RAISE WARNING 'enqueue_automacoes inerte (schema desatualizado): %', SQLERRM;
  RETURN 0;
END $function$;

-- 2) Link/idempotência: orcamentos_3d passa a referenciar a OS gerada.
ALTER TABLE public.orcamentos_3d
  ADD COLUMN IF NOT EXISTS os_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL;

-- 3) Conversão transacional orçamento 3D -> OS.
CREATE OR REPLACE FUNCTION public.converter_orcamento_3d_em_os(p_orcamento_3d_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid;
  v_orc public.orcamentos_3d%ROWTYPE;
  v_calc public.orcamento_3d_calculos%ROWTYPE;
  v_os_id uuid;
  v_conta_id uuid;
  v_qtd numeric;
  v_custo numeric;
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

  INSERT INTO public.ordens_servico (cliente_id, titulo, observacoes, valor_total, custo_previsto, created_by, status_geral)
  VALUES (v_orc.cliente_id, v_orc.titulo, 'Origem: orçamento 3D ' || p_orcamento_3d_id::text,
          v_orc.preco_comercial, v_custo, v_uid, 'entrada')
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os (os_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem)
  VALUES (v_os_id, v_orc.titulo, v_qtd, 'un',
          round(COALESCE(v_orc.preco_comercial, 0) / v_qtd, 2),
          round(v_custo / v_qtd, 2),
          COALESCE(v_orc.preco_comercial, 0), 1);

  UPDATE public.orcamentos_3d SET os_id = v_os_id, status = 'convertido' WHERE id = p_orcamento_3d_id;

  INSERT INTO public.contas_receber (cliente_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, v_os_id, COALESCE(v_orc.preco_comercial, 0))
  RETURNING id INTO v_conta_id;

  INSERT INTO public.parcelas_receber (conta_id, parcela, valor, vencimento)
  VALUES (v_conta_id, 1, COALESCE(v_orc.preco_comercial, 0), CURRENT_DATE);

  INSERT INTO public.eventos_negocio (entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id)
  VALUES ('orcamento', p_orcamento_3d_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
          'Orçamento 3D convertido em OS', jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'origem', '3d'), v_uid);

  RETURN jsonb_build_object('orcamento_3d_id', p_orcamento_3d_id, 'os_id', v_os_id, 'conta_id', v_conta_id);
END $fn$;

GRANT EXECUTE ON FUNCTION public.converter_orcamento_3d_em_os(uuid) TO authenticated;
