-- =====================================================================================================
-- ENSAIO: trava do estorno (migração 20261116190000)
--
-- Rodar no editor SQL do Supabase, inteiro, DEPOIS de aplicar a migração. Nada fica gravado: termina com
-- RAISE EXCEPTION e a transação volta. A mensagem final diz "TRAVA OK" e a matriz; qualquer outra
-- mensagem é o critério que falhou.
--
-- Simula, pelo papel real de cada um (claims + SET LOCAL ROLE): admin, financeiro, o gestor ativo (que
-- também é vendedor), um vendedor sem financeiro e o anon. Cada tentativa roda numa subtransação desfeita
-- logo depois, para a próxima pessoa achar a conta paga do mesmo jeito.
-- =====================================================================================================
BEGIN;

CREATE FUNCTION pg_temp.ser(p_usuario uuid) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_usuario IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_usuario, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), true);
  EXECUTE CASE WHEN p_usuario IS NULL THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
END $f$;

-- 'n' = rodou e mexeu em n linhas (desfeito em seguida); 'x' = recusado (erro).
CREATE FUNCTION pg_temp.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'DESFAZ:%', n;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'DESFAZ:%' THEN RETURN substr(SQLERRM, 8); END IF;
    RETURN 'x';
  END;
END $f$;

CREATE FUNCTION pg_temp.confere(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', p_msg; END IF;
END $f$;

GRANT EXECUTE ON FUNCTION pg_temp.ser(uuid), pg_temp.tenta(text), pg_temp.confere(boolean, text) TO anon, authenticated;

DO $ensaio$
DECLARE
  v_adm uuid; v_fin uuid; v_ges uuid; v_ven uuid; v_conta uuid; v_aberta uuid; v_mov uuid; v_manual uuid;
  v_hoje date := public.hoje_br();
  v_res jsonb := '{}'::jsonb; v_l jsonb; p record;
BEGIN
  SELECT ur.user_id INTO v_adm FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'admin' AND u.ativo IS NOT false ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id INTO v_fin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'financeiro' AND u.ativo IS NOT false AND NOT public.has_role(ur.user_id, 'admin') ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id INTO v_ges FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'gestor' AND u.ativo IS NOT false AND NOT public.has_role(ur.user_id, 'admin')
     AND NOT public.has_role(ur.user_id, 'financeiro') ORDER BY ur.user_id LIMIT 1;
  SELECT u.id INTO v_ven FROM public.usuarios u
   WHERE u.ativo IS NOT false AND NOT public.has_role(u.id, 'admin') AND NOT public.has_permission(u.id, 'financeiro.read')
     AND public.has_permission(u.id, 'pagamentos.confirm') ORDER BY u.id LIMIT 1;
  PERFORM pg_temp.confere(v_adm IS NOT NULL AND v_fin IS NOT NULL AND v_ges IS NOT NULL AND v_ven IS NOT NULL,
                          'faltou admin, financeiro, gestor ou vendedor para simular');

  -- O financeiro lança e paga uma conta pela função; lança outra que fica em aberto; lança um movimento manual.
  PERFORM pg_temp.ser(v_fin);
  INSERT INTO public.contas_pagar (descricao, valor, vencimento) VALUES ('TRAVA ensaio paga', 100, v_hoje - 5) RETURNING id INTO v_conta;
  INSERT INTO public.contas_pagar (descricao, valor, vencimento) VALUES ('TRAVA ensaio aberta', 50, v_hoje + 5) RETURNING id INTO v_aberta;
  PERFORM public.pagar_conta_pagar(v_conta, v_hoje - 2, NULL, NULL);
  SELECT id INTO v_mov FROM public.caixa_movimentos WHERE conta_pagar_id = v_conta;
  INSERT INTO public.caixa_movimentos (tipo, origem, descricao, valor, data, realizado)
  VALUES ('saida', 'manual', 'TRAVA ensaio manual', 10, v_hoje, true) RETURNING id INTO v_manual;

  FOR p IN SELECT * FROM (VALUES ('admin', v_adm), ('financeiro', v_fin), ('gestor', v_ges), ('vendedor', v_ven),
                                 ('anon', NULL::uuid)) AS t(quem, uid) LOOP
    PERFORM pg_temp.ser(p.uid);
    v_l := jsonb_build_object(
      'estornar',        pg_temp.tenta(format('SELECT public.estornar_conta_pagar(%L, %L)', v_conta, 'ensaio da trava')),
      'reabrir',         pg_temp.tenta(format('UPDATE public.contas_pagar SET status = ''aberta'', data_pagamento = NULL WHERE id = %L', v_conta)),
      'cancelar_paga',   pg_temp.tenta(format('UPDATE public.contas_pagar SET status = ''cancelada'' WHERE id = %L', v_conta)),
      'apagar_paga',     pg_temp.tenta(format('DELETE FROM public.contas_pagar WHERE id = %L', v_conta)),
      'apagar_saida',    pg_temp.tenta(format('DELETE FROM public.caixa_movimentos WHERE id = %L', v_mov)),
      'desligar_saida',  pg_temp.tenta(format('UPDATE public.caixa_movimentos SET conta_pagar_id = NULL WHERE id = %L', v_mov)),
      'mudar_valor',     pg_temp.tenta(format('UPDATE public.caixa_movimentos SET valor = 1 WHERE id = %L', v_mov)),
      -- O que tem de continuar como era:
      'rebaixa_data',    pg_temp.tenta(format('UPDATE public.contas_pagar SET status = ''paga'', data_pagamento = %L WHERE id = %L', v_hoje - 3, v_conta)),
      'data_da_saida',   pg_temp.tenta(format('UPDATE public.caixa_movimentos SET data = %L WHERE id = %L', v_hoje - 3, v_mov)),
      'apagar_aberta',   pg_temp.tenta(format('DELETE FROM public.contas_pagar WHERE id = %L', v_aberta)),
      'apagar_manual',   pg_temp.tenta(format('DELETE FROM public.caixa_movimentos WHERE id = %L', v_manual)));
    v_res := v_res || jsonb_build_object(p.quem, v_l);
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- Admin: tudo passa (o estorno e as correções diretas continuam com ele).
  PERFORM pg_temp.confere((SELECT bool_and(v = '1') FROM jsonb_each_text(v_res->'admin') AS e(k, v)),
                          'admin perdeu algum caminho: ' || (v_res->'admin')::text);
  -- Financeiro: nada que desfaça o pagamento; o resto, como antes.
  PERFORM pg_temp.confere(
    v_res->'financeiro'->>'estornar' = 'x' AND v_res->'financeiro'->>'reabrir' = 'x'
    AND v_res->'financeiro'->>'cancelar_paga' = 'x' AND v_res->'financeiro'->>'apagar_paga' = 'x'
    AND v_res->'financeiro'->>'apagar_saida' = 'x' AND v_res->'financeiro'->>'desligar_saida' = 'x'
    AND v_res->'financeiro'->>'mudar_valor' = 'x',
    'financeiro ainda desfaz pagamento: ' || (v_res->'financeiro')::text);
  PERFORM pg_temp.confere(
    v_res->'financeiro'->>'rebaixa_data' = '1' AND v_res->'financeiro'->>'data_da_saida' = '1'
    AND v_res->'financeiro'->>'apagar_aberta' = '1' AND v_res->'financeiro'->>'apagar_manual' = '1',
    'a trava pegou caminho legítimo do financeiro: ' || (v_res->'financeiro')::text);
  -- Gestor (também vendedor): reabrir passava pela regra antiga; agora não.
  PERFORM pg_temp.confere(v_res->'gestor'->>'reabrir' = 'x' AND v_res->'gestor'->>'cancelar_paga' = 'x'
                          AND v_res->'gestor'->>'estornar' = 'x',
                          'gestor ainda reabre conta paga: ' || (v_res->'gestor')::text);
  -- Vendedor e anon: nada (0 linhas pela RLS ou recusado).
  PERFORM pg_temp.confere((SELECT bool_and(v IN ('0', 'x')) FROM jsonb_each_text(v_res->'vendedor') AS e(k, v))
                          AND (SELECT bool_and(v IN ('0', 'x')) FROM jsonb_each_text(v_res->'anon') AS e(k, v)),
                          'vendedor ou anon mexeu em algo: ' || (v_res->'vendedor')::text || ' ' || (v_res->'anon')::text);

  RAISE EXCEPTION 'TRAVA OK (nada foi gravado; n = linhas, x = recusado): %', v_res;
END
$ensaio$;

ROLLBACK;
