-- Diagnóstico ponta a ponta de 25/10/2026 (docs/diagnostico-ponta-a-ponta-2026-10-25.md).
--
-- 1) DADO (R4): o orçamento #106 já virou a OS #174 mas continuava "aprovado". A função de
--    conversão atual já grava "convertido"; o #106 entrou antes ou por outro caminho. Corrige só ele,
--    e só se ainda estiver nesse estado.
-- 2) ALERTAS: o caixa soma pagamentos, mas dois buracos não apareciam em lugar nenhum:
--      pagamento_sem_parcela — dinheiro recebido que não baixa nenhuma parcela (2 hoje: OS #168, R$ 300);
--      pagamento_acima_da_conta — a soma recebida da OS passa do valor da conta (1 hoje: OS #168 recebeu
--        R$ 600 contra uma conta de R$ 300).
--    Entram em pendencias_do_sistema() para quem vê dinheiro. Não corrigem o lançamento: o extrato da
--    OS #168 precisa ser conferido por uma pessoa (pode ser pagamento em dobro).
-- Desfazer: UPDATE orcamentos SET status = 'aprovado' WHERE numero = 106; recriar a função sem os dois blocos.
UPDATE public.orcamentos SET status = 'convertido'
 WHERE numero = 106 AND status::text = 'aprovado' AND os_id IS NOT NULL;

DO $m$
DECLARE d text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  a text := E'    FROM public.parcelas_receber WHERE status <> ''paga'' AND vencimento IS NULL HAVING count(*) > 0;\n  END IF;';
  n int; novo text;
BEGIN
  IF position('pagamento_sem_parcela' IN d) > 0 THEN RETURN; END IF;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'âncora aparece % vezes', n; END IF;
  novo := E'    FROM public.parcelas_receber WHERE status <> ''paga'' AND vencimento IS NULL HAVING count(*) > 0;\n\n'
    || E'    -- Dinheiro recebido que não está amarrado a nenhuma parcela: o caixa soma, a conta a receber não.\n'
    || E'    RETURN QUERY SELECT ''pagamento_sem_parcela'', ''Pagamentos recebidos sem parcela da conta'', count(*)::int,\n'
    || E'      (SELECT count(*)::int FROM public.pagamentos), ''critico'', ''financeiro'',\n'
    || E'      ''Estes pagamentos entram no caixa mas não baixam nenhuma parcela: a conta da OS continua aberta ou fica menor que o recebido. Abra a OS, confira se não é lançamento duplicado e ligue o pagamento à parcela.'',\n'
    || E'      ''/a-receber''\n'
    || E'    FROM public.pagamentos WHERE parcela_id IS NULL AND pagamento_estornado_id IS NULL HAVING count(*) > 0;\n\n'
    || E'    -- A soma recebida de uma OS passou do valor da conta dela (lançamento em dobro ou conta defasada).\n'
    || E'    RETURN QUERY SELECT ''pagamento_acima_da_conta'', ''OS que recebeu mais do que a conta'', count(*)::int,\n'
    || E'      (SELECT count(*)::int FROM public.contas_receber), ''critico'', ''financeiro'',\n'
    || E'      ''A soma dos pagamentos da OS passa do valor da conta a receber. Pode ser pagamento lançado em dobro ou a conta que não acompanhou um reajuste. Confira o extrato da OS antes de fechar o caixa.'',\n'
    || E'      ''/a-receber''\n'
    || E'    FROM (SELECT cr.os_id FROM public.contas_receber cr JOIN public.pagamentos p ON p.os_id = cr.os_id AND p.pagamento_estornado_id IS NULL\n'
    || E'           GROUP BY cr.id, cr.os_id, cr.valor_total HAVING sum(p.valor) > cr.valor_total + 0.01) x HAVING count(*) > 0;\n  END IF;';
  d := replace(d, a, novo);
  EXECUTE d;
END $m$;
