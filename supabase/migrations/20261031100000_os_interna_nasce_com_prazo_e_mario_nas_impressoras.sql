-- A OS interna nasce com prazo, e as quatro OS do Mario saem da mesma impressora (31/10/2026).
--
-- 1. `criar_os_interna` inseria a OS sem `prazo_entrega`: a OS interna de teste de 30/10 (#216) apareceu com "Prazo —"
--    no quadro, nunca entra como atrasada e a agenda fica sem base. A conversão do orçamento já usava o prazo padrão da
--    casa (`custos_tabela.prazo_entrega_padrao_dias`, 5 dias úteis) desde 29/10; a OS interna passa a usar o mesmo,
--    contado do dia de Macapá (`hoje_local()`). Ensaio em transação desfeita: sábado 31/10 + 5 dias úteis = 06/11.
--
-- 2. OS 170 a 173 (impressão 3D, 4 dias paradas) tinham o job planejado na mesma impressora, a Bambu 3D 01. Cada uma
--    é repartida pela função de 30/10 (`redistribuir_jobs_3d_da_os`), restrita às três A1 de mesa igual (01, 02 e 03):
--    a Mini fica de fora porque a mesa dela é menor e o tamanho das peças não está registrado.
--    A função só mexe em job planejado e sem horário na agenda.
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.criar_os_interna(text,text,uuid,numeric,text,numeric,numeric,text,uuid)'::regprocedure);
  v_novo text;
  v_os record;
BEGIN
  v_novo := replace(v_def, 'precisa_entrega, precisa_instalacao)', 'precisa_entrega, precisa_instalacao, prazo_entrega)');
  IF v_novo = v_def THEN RAISE EXCEPTION 'lista de colunas não encontrada'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def, 'p_os_origem, v_uid, v_uid, false, false)',
    E'p_os_origem, v_uid, v_uid, false, false,\n          public.somar_dias_uteis(public.hoje_local(), COALESCE(NULLIF((SELECT max(c.valor) FROM public.custos_tabela c\n                                                                         WHERE c.ativo AND c.codigo = ''prazo_entrega_padrao_dias'')::int, 0), 5)))');
  IF v_novo = v_def THEN RAISE EXCEPTION 'valores não encontrados'; END IF;
  EXECUTE v_novo;

  FOR v_os IN select id from public.ordens_servico where numero in (170, 171, 172, 173) order by numero LOOP
    PERFORM public.redistribuir_jobs_3d_da_os(v_os.id, ARRAY[
      '39807c59-d6da-42f4-9072-9540978cd3d4'::uuid,
      '53d4ed68-2472-48e9-bacf-0adacf3bf193'::uuid,
      '4aa6444b-f4c5-4044-8105-08be9cda8d6d'::uuid]);
  END LOOP;
END $m$;
