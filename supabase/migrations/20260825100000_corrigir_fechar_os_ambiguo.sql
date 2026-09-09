-- fechar_os: corrigir o `os_id` ambíguo que quebrava TODAS as chamadas.
--
-- Diagnóstico: o parâmetro da função se chama `os_id` e as tabelas verificadas
-- também têm uma coluna `os_id`. Em `WHERE os_id = fechar_os.os_id`, o lado
-- esquerdo é ambíguo — o PL/pgSQL não sabe se é a coluna ou o parâmetro — e
-- levanta "column reference os_id is ambiguous" na primeira verificação.
--
-- O efeito: a função NUNCA fechou uma OS. Falhava com ou sem tarefa pendente,
-- com ou sem material baixado. Só apareceu agora porque foi a primeira vez que
-- alguém chamou a função depois de existir tarefa — mas o erro é anterior a isso
-- e vale para qualquer chamada.
--
-- A correção é dar apelido a cada tabela e qualificar a coluna. O NOME DO
-- PARÂMETRO É MANTIDO: a tela chama rpc("fechar_os", { os_id }), e trocar para
-- p_os_id quebraria a chamada do front sem necessidade.

create or replace function public.fechar_os(os_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_uid uuid;
  v_result jsonb;
  v_cliente uuid;
  v_bloqueios jsonb := '[]'::jsonb;
  v_receita numeric;
  v_pago numeric;
BEGIN
  v_uid := public.require_permission('os.close');

  SELECT o.cliente_id, COALESCE(o.valor_total,0) - COALESCE(o.desconto,0)
    INTO v_cliente, v_receita
  FROM public.ordens_servico o
  WHERE o.id = fechar_os.os_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.os_tarefas t
    WHERE t.os_id = fechar_os.os_id AND t.obrigatoria
      AND t.status NOT IN ('concluida','cancelada')
  ) THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = fechar_os.os_id AND i.requer_qualidade)
     AND NOT EXISTS (
       SELECT 1 FROM public.qualidade_inspecoes q
       WHERE q.os_id = fechar_os.os_id AND q.resultado IN ('aprovado','aprovado_com_ressalva')
     )
  THEN v_bloqueios := v_bloqueios || '"qualidade_aprovada"'::jsonb; END IF;

  IF EXISTS (
    SELECT 1 FROM public.qualidade_inspecoes q
    WHERE q.os_id = fechar_os.os_id AND q.resultado IN ('reprovado','retrabalho')
  ) THEN v_bloqueios := v_bloqueios || '"qualidade_reprovada_ou_retrabalho"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.movimentacoes_estoque me
       WHERE me.os_id = fechar_os.os_id AND me.tipo = 'saida' AND me.origem = 'baixa_os'
     )
  THEN v_bloqueios := v_bloqueios || '"materiais_baixados"'::jsonb; END IF;

  IF EXISTS (
    SELECT 1 FROM public.ocorrencias oc
    WHERE oc.os_id = fechar_os.os_id
      AND COALESCE(oc.status,'aberta') NOT IN ('tratada','fechada','cancelada')
  ) THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;

  IF EXISTS (
    SELECT 1 FROM public.entregas_instalacoes ei
    WHERE ei.os_id = fechar_os.os_id
      AND ei.status NOT IN ('concluida','cancelada','nao_necessaria')
  ) THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.custos_operacionais_os co WHERE co.os_id = fechar_os.os_id
  ) THEN v_bloqueios := v_bloqueios || '"custos_operacionais"'::jsonb; END IF;

  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago
  FROM public.pagamentos pg
  WHERE pg.os_id = fechar_os.os_id AND pg.status = 'pago';

  IF v_receita > 0 AND v_pago < v_receita
     AND COALESCE((SELECT o2.status_financeiro::text FROM public.ordens_servico o2
                    WHERE o2.id = fechar_os.os_id), 'pendente') <> 'pago'
  THEN v_bloqueios := v_bloqueios || '"pagamentos_pendentes"'::jsonb; END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', v_bloqueios, 'resultado', v_result);
  END IF;

  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by)
  VALUES (fechar_os.os_id, v_result, v_uid);

  UPDATE public.ordens_servico o
     SET status = 'concluido',
         status_geral = 'fechada',
         data_fechamento = now(),
         custo_real = COALESCE((v_result->>'custo_realizado')::numeric, 0),
         margem_real = COALESCE((v_result->>'margem_realizada')::numeric, 0)
   WHERE o.id = fechar_os.os_id;

  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id)
  VALUES (fechar_os.os_id, v_cliente);

  PERFORM public.registrar_evento_os(fechar_os.os_id, 'os', fechar_os.os_id,
                                     'fechamento', 'OS fechada', NULL, v_result);

  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result);
END
$function$;

comment on function public.fechar_os is
  'Fecha a OS ou devolve a lista de bloqueios. Colunas qualificadas: o parâmetro os_id colide com a coluna os_id das tabelas verificadas.';
