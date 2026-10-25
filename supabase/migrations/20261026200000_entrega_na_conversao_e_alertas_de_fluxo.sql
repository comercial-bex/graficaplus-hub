-- Fase 2 do diagnóstico ponta a ponta (25/10/2026): ligar os elos onde a mão humana some.
--
-- 1) A ENTREGA NASCE COM A OS. A conversão em OS não criava a entrega mesmo quando o orçamento dizia
--    "precisa entrega/instalação" (entregas_instalacoes tinha 0 linhas). Agora cria uma entrega
--    "agendada" (tipo instalação se precisa instalar, senão entrega) com o endereço do orçamento
--    (endereco_entrega->>'descricao'). É acessório: se falhar, avisa e a conversão segue. Gerente e
--    admin concluem em /entregas; fechar_os já espera por ela ("logistica_concluida").
--    Ensaiada com RAISE sobre os 8 aprovados: 7 converteram e criaram 1 entrega; o #54 parou na
--    trava de desconto, como deve.
-- 2) TRÊS ALERTAS DE FLUXO em pendencias_do_sistema():
--      os_paga_sem_producao — o cliente pagou e a OS está parada em "entrada" (3 hoje: #161, #166, #169);
--      os_sem_prazo         — OS de venda em andamento sem prazo, que nunca aparece como atrasada (12);
--      os_sem_agenda        — OS em andamento sem horário em nenhuma máquina (10).
-- Desfazer: recriar converter_orcamento_em_os sem o bloco "Entrega/instalação nasce com a OS" e
-- pendencias_do_sistema sem os três blocos.
DO $m$
DECLARE d text := pg_get_functiondef('public.converter_orcamento_em_os(uuid,jsonb)'::regprocedure);
  a text := E'  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;\n';
  n int; novo text;
BEGIN
  IF position('entregas_instalacoes' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora aparece % vezes', n; END IF;
  novo := a || E'\n  -- Entrega/instalação nasce com a OS quando o pedido pede (25/10/2026). Acessório: nunca derruba a conversão.\n'
    || E'  IF COALESCE(v_orc.precisa_instalacao, false) OR COALESCE(v_orc.precisa_entrega, false) THEN\n'
    || E'    BEGIN\n'
    || E'      INSERT INTO public.entregas_instalacoes(os_id, tipo, endereco, status)\n'
    || E'      VALUES (v_os_id, CASE WHEN COALESCE(v_orc.precisa_instalacao, false) THEN ''instalacao'' ELSE ''entrega'' END,\n'
    || E'              COALESCE(v_orc.endereco_entrega->>''descricao'', v_orc.endereco_entrega::text), ''agendada'');\n'
    || E'    EXCEPTION WHEN OTHERS THEN\n'
    || E'      RAISE WARNING ''Não deu para criar a entrega da OS %: %'', v_os_id, SQLERRM;\n'
    || E'    END;\n'
    || E'  END IF;\n';
  EXECUTE replace(d, a, novo);
END $m$;

DO $m$
DECLARE d text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  a text := E'\n  RETURN;\nEND;';
  n int; novo text;
BEGIN
  IF position('os_sem_prazo' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora aparece % vezes', n; END IF;
  novo := E'\n  -- Cliente já pagou (sinal ou tudo) e a OS continua em "entrada": o dinheiro entrou e a produção não sabe.\n'
    || E'  RETURN QUERY SELECT ''os_paga_sem_producao'', ''OS já paga que ainda não começou'', count(*)::int,\n'
    || E'    (SELECT count(*)::int FROM public.ordens_servico WHERE finalidade::text = ''venda'' AND status::text NOT IN (''concluido'',''cancelado'')), ''critico'', ''atendimento'',\n'
    || E'    ''O cliente já pagou e a OS está parada em entrada. Abra a OS, confira a arte e o material e avance a etapa, ou avise o cliente do prazo.'', ''/os''\n'
    || E'  FROM public.ordens_servico o WHERE o.finalidade::text = ''venda'' AND o.status::text = ''entrada''\n'
    || E'    AND EXISTS (SELECT 1 FROM public.pagamentos p WHERE p.os_id = o.id AND p.pagamento_estornado_id IS NULL) HAVING count(*) > 0;\n\n'
    || E'  -- Sem prazo a OS nunca entra em atraso, nem na TV, nem no aviso ao cliente.\n'
    || E'  RETURN QUERY SELECT ''os_sem_prazo'', ''OS de venda em andamento sem prazo de entrega'', count(*)::int,\n'
    || E'    (SELECT count(*)::int FROM public.ordens_servico WHERE finalidade::text = ''venda'' AND status::text NOT IN (''concluido'',''cancelado'')), ''atencao'', ''atendimento'',\n'
    || E'    ''Sem prazo a OS nunca aparece como atrasada. Abra a OS e defina a data de entrega combinada com o cliente.'', ''/os''\n'
    || E'  FROM public.ordens_servico o WHERE o.finalidade::text = ''venda'' AND o.status::text NOT IN (''concluido'',''cancelado'') AND o.prazo_entrega IS NULL HAVING count(*) > 0;\n\n'
    || E'  -- Sem horário na máquina a capacidade, a TV e o prazo prometido não enxergam a OS.\n'
    || E'  RETURN QUERY SELECT ''os_sem_agenda'', ''OS em andamento sem horário na máquina'', count(*)::int,\n'
    || E'    (SELECT count(*)::int FROM public.ordens_servico WHERE finalidade::text = ''venda'' AND status::text NOT IN (''concluido'',''cancelado'')), ''atencao'', ''gestao'',\n'
    || E'    ''Estas OS não ocupam nenhuma máquina na agenda: a capacidade parece livre e o prazo prometido não tem base. Abra a agenda de máquinas e agende, ou confira se a OS é só de arte.'', ''/maquinas-agenda''\n'
    || E'  FROM public.ordens_servico o WHERE o.finalidade::text = ''venda'' AND o.status::text NOT IN (''concluido'',''cancelado'')\n'
    || E'    AND NOT EXISTS (SELECT 1 FROM public.maquinas_agenda a WHERE a.os_id = o.id) HAVING count(*) > 0;\n' || a;
  d := replace(d, a, novo);
  EXECUTE d;
END $m$;
