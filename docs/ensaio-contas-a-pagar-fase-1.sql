-- =====================================================================================================
-- ENSAIO: contas a pagar, fase 1 (migração 20261116160000)
--
-- Rodar DEPOIS de aplicar a migração, no editor SQL do Supabase, inteiro. Nada fica gravado: o bloco
-- termina com RAISE EXCEPTION e a transação inteira volta. A mensagem final diz "ENSAIO OK" e os números;
-- qualquer outra mensagem é o critério que falhou.
--
-- Simula quatro pessoas reais pelo papel (claims + SET LOCAL ROLE): um admin, um financeiro que não é
-- admin, um gestor que não é admin nem financeiro, e alguém ativo sem financeiro.read. E o anon.
--
-- Critérios de aceite conferidos:
--   1. pagar sem confirmar é impossível no banco: só a função paga, e só com a chave de dar baixa;
--   2. pagamento com data retroativa lança o movimento na data informada, com a conta bancária;
--   3. o estorno devolve saldo e saídas realizadas (vw_fluxo_caixa, como a tela soma) ao valor anterior;
--   4. quem não tem financeiro.read não vê arquivo, linha de anexo nem histórico.
-- E também: só admin estorna e remove anexo; motivo obrigatório; data futura e pagamento duplo recusados;
-- histórico com quem criou, pagou, estornou, anexou e removeu.
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

-- Roda o comando e devolve a mensagem de erro (ou NULL, se passou).
CREATE FUNCTION pg_temp.erro(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN SQLERRM;
END $f$;

CREATE FUNCTION pg_temp.confere(p_ok boolean, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', p_msg; END IF;
END $f$;

-- Os totais exatamente como a tela de fluxo de caixa soma (kpis em fluxo-caixa.tsx).
CREATE FUNCTION pg_temp.totais() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'entrada_real', coalesce(sum(valor) FILTER (WHERE tipo = 'entrada' AND realizado), 0),
    'saida_real',   coalesce(sum(valor) FILTER (WHERE tipo <> 'entrada' AND realizado), 0),
    'saldo_real',   coalesce(sum(valor) FILTER (WHERE tipo = 'entrada' AND realizado), 0)
                  - coalesce(sum(valor) FILTER (WHERE tipo <> 'entrada' AND realizado), 0),
    'saida_prev',   coalesce(sum(valor) FILTER (WHERE tipo <> 'entrada'), 0),
    'saldo_prev',   coalesce(sum(valor) FILTER (WHERE tipo = 'entrada'), 0)
                  - coalesce(sum(valor) FILTER (WHERE tipo <> 'entrada'), 0))
  FROM public.vw_fluxo_caixa
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.ser(uuid), pg_temp.erro(text), pg_temp.confere(boolean, text), pg_temp.totais()
  TO anon, authenticated;

DO $ensaio$
DECLARE
  v_adm uuid; v_fin uuid; v_ges uuid; v_sem uuid; v_banco uuid;
  v_conta uuid; v_anexo uuid; v_obj text; v_obj2 text;
  v_mov public.caixa_movimentos%ROWTYPE;
  v_antes jsonb; v_pago jsonb; v_depois jsonb;
  v_data date := public.hoje_br() - 45;
  v_err text; v_r jsonb; v_n integer;
BEGIN
  SELECT ur.user_id INTO v_adm FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'admin' AND u.ativo IS NOT false ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id INTO v_fin FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'financeiro' AND u.ativo IS NOT false
     AND NOT public.has_role(ur.user_id, 'admin') ORDER BY ur.user_id LIMIT 1;
  SELECT ur.user_id INTO v_ges FROM public.user_roles ur JOIN public.usuarios u ON u.id = ur.user_id
   WHERE ur.role = 'gestor' AND u.ativo IS NOT false
     AND NOT public.has_role(ur.user_id, 'admin') AND NOT public.has_role(ur.user_id, 'financeiro')
   ORDER BY ur.user_id LIMIT 1;
  SELECT u.id INTO v_sem FROM public.usuarios u
   WHERE u.ativo IS NOT false AND NOT public.has_role(u.id, 'admin')
     AND NOT public.has_permission(u.id, 'financeiro.read') ORDER BY u.id LIMIT 1;
  SELECT b.id INTO v_banco FROM public.contas_bancarias b WHERE b.ativo ORDER BY b.nome LIMIT 1;
  PERFORM pg_temp.confere(v_adm IS NOT NULL AND v_fin IS NOT NULL AND v_ges IS NOT NULL AND v_sem IS NOT NULL,
                          'faltou admin, financeiro, gestor ou alguém sem financeiro.read para simular');
  PERFORM pg_temp.confere(NOT public.has_permission(v_ges, 'pagamentos.confirm'), 'o gestor do ensaio tem pagamentos.confirm');

  -- 1. O financeiro lança a conta como a tela lança (INSERT direto).
  PERFORM pg_temp.ser(v_fin);
  v_antes := pg_temp.totais();
  INSERT INTO public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento)
  VALUES ('ENSAIO fase 1', 'Fornecedor do ensaio', 'geral', 1234.56, public.hoje_br() - 30)
  RETURNING id INTO v_conta;
  PERFORM pg_temp.confere((SELECT created_by FROM public.contas_pagar WHERE id = v_conta) = v_fin,
                          'created_by não ficou com quem lançou');
  PERFORM pg_temp.confere(EXISTS (SELECT 1 FROM public.contas_pagar_historico
                                   WHERE conta_pagar_id = v_conta AND evento = 'criada' AND usuario_id = v_fin),
                          'histórico sem a criação');
  v_antes := pg_temp.totais();

  -- 2. Pagar só pela função, e só com a chave de dar baixa.
  PERFORM pg_temp.ser(v_ges);
  v_err := pg_temp.erro(format('SELECT public.pagar_conta_pagar(%L, %L)', v_conta, public.hoje_br()));
  PERFORM pg_temp.confere(v_err ILIKE '%permissão%', 'gestor pagou: ' || coalesce(v_err, 'sem erro'));
  v_err := pg_temp.erro(format('UPDATE public.contas_pagar SET status = ''paga'' WHERE id = %L', v_conta));
  PERFORM pg_temp.confere((SELECT status FROM public.contas_pagar WHERE id = v_conta) = 'aberta',
                          'gestor deu baixa por UPDATE direto');
  PERFORM pg_temp.ser(v_sem);
  v_err := pg_temp.erro(format('SELECT public.pagar_conta_pagar(%L, %L)', v_conta, public.hoje_br()));
  PERFORM pg_temp.confere(v_err ILIKE '%permissão%', 'sem financeiro pagou: ' || coalesce(v_err, 'sem erro'));
  PERFORM pg_temp.ser(NULL);
  v_err := pg_temp.erro(format('SELECT public.pagar_conta_pagar(%L, %L)', v_conta, public.hoje_br()));
  PERFORM pg_temp.confere(v_err ILIKE '%permission denied%', 'anon executou pagar: ' || coalesce(v_err, 'sem erro'));

  PERFORM pg_temp.ser(v_fin);
  v_err := pg_temp.erro(format('SELECT public.pagar_conta_pagar(%L, %L)', v_conta, public.hoje_br() + 1));
  PERFORM pg_temp.confere(v_err ILIKE '%futura%', 'data futura aceita: ' || coalesce(v_err, 'sem erro'));

  -- 3. Data retroativa: o movimento nasce na data informada, com a conta bancária.
  v_r := public.pagar_conta_pagar(v_conta, v_data, v_banco, 'Pix');
  SELECT * INTO v_mov FROM public.caixa_movimentos WHERE conta_pagar_id = v_conta;
  PERFORM pg_temp.confere(v_mov.data = v_data, format('movimento em %s, informado %s', v_mov.data, v_data));
  PERFORM pg_temp.confere(v_mov.conta_id IS NOT DISTINCT FROM v_banco, 'conta bancária não foi para o movimento');
  PERFORM pg_temp.confere(v_mov.valor = 1234.56 AND v_mov.tipo = 'saida' AND v_mov.created_by = v_fin,
                          'movimento com valor, tipo ou autor errado');
  PERFORM pg_temp.confere((SELECT status = 'paga' AND data_pagamento = v_data FROM public.contas_pagar WHERE id = v_conta),
                          'conta não ficou paga na data informada');
  PERFORM pg_temp.confere(EXISTS (SELECT 1 FROM public.contas_pagar_historico
                                   WHERE conta_pagar_id = v_conta AND evento = 'paga' AND usuario_id = v_fin
                                     AND data_pagamento = v_data AND detalhes->>'movimento_id' = v_mov.id::text),
                          'histórico sem quem pagou');
  v_err := pg_temp.erro(format('SELECT public.pagar_conta_pagar(%L, %L)', v_conta, public.hoje_br()));
  PERFORM pg_temp.confere(v_err ILIKE '%já está paga%', 'pagou duas vezes: ' || coalesce(v_err, 'sem erro'));
  v_pago := pg_temp.totais();
  PERFORM pg_temp.confere((v_pago->>'saida_real')::numeric = (v_antes->>'saida_real')::numeric + 1234.56,
                          format('saída realizada não subiu o valor da conta: %s -> %s', v_antes, v_pago));

  -- 4. Estorno: só admin, com motivo.
  v_err := pg_temp.erro(format('SELECT public.estornar_conta_pagar(%L, %L)', v_conta, 'motivo do financeiro'));
  PERFORM pg_temp.confere(v_err ILIKE '%administrador%', 'financeiro estornou: ' || coalesce(v_err, 'sem erro'));
  PERFORM pg_temp.ser(v_ges);
  v_err := pg_temp.erro(format('SELECT public.estornar_conta_pagar(%L, %L)', v_conta, 'motivo do gestor'));
  PERFORM pg_temp.confere(v_err ILIKE '%administrador%', 'gestor estornou: ' || coalesce(v_err, 'sem erro'));
  PERFORM pg_temp.ser(v_adm);
  v_err := pg_temp.erro(format('SELECT public.estornar_conta_pagar(%L, %L)', v_conta, '   '));
  PERFORM pg_temp.confere(v_err ILIKE '%motivo%', 'estorno sem motivo: ' || coalesce(v_err, 'sem erro'));

  v_r := public.estornar_conta_pagar(v_conta, 'Pagamento lançado na conta errada (ensaio)');
  PERFORM pg_temp.confere((SELECT status = 'aberta' AND data_pagamento IS NULL FROM public.contas_pagar WHERE id = v_conta),
                          'conta não reabriu');
  PERFORM pg_temp.confere(NOT EXISTS (SELECT 1 FROM public.caixa_movimentos WHERE conta_pagar_id = v_conta),
                          'a saída do pagamento ficou no caixa');
  PERFORM pg_temp.confere(EXISTS (SELECT 1 FROM public.contas_pagar_historico
                                   WHERE conta_pagar_id = v_conta AND evento = 'estornada' AND usuario_id = v_adm
                                     AND motivo = 'Pagamento lançado na conta errada (ensaio)'
                                     AND data_pagamento = v_data),
                          'histórico sem quem estornou e o motivo');
  PERFORM pg_temp.ser(v_fin);
  v_depois := pg_temp.totais();
  PERFORM pg_temp.confere(v_depois = v_antes, format('estorno não devolveu os totais: antes %s, depois %s', v_antes, v_depois));

  -- 5. Anexos: o financeiro envia; o arquivo vale pelo que o Storage gravou.
  v_obj := v_conta || '/' || gen_random_uuid() || '.pdf';
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('contas-pagar-anexos', v_obj, '{"size": 2048, "mimetype": "application/pdf"}');
  v_r := public.anexar_arquivo_conta_pagar(v_conta, 'fatura', v_obj, 'boleto de novembro.pdf');
  v_anexo := (v_r->>'anexo_id')::uuid;
  PERFORM pg_temp.confere(EXISTS (SELECT 1 FROM public.contas_pagar_historico
                                   WHERE conta_pagar_id = v_conta AND evento = 'anexo_enviado' AND usuario_id = v_fin),
                          'histórico sem o anexo enviado');
  v_obj2 := v_conta || '/' || gen_random_uuid() || '.pdf';
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('contas-pagar-anexos', v_obj2, '{"size": 10485761, "mimetype": "application/pdf"}');
  v_err := pg_temp.erro(format('SELECT public.anexar_arquivo_conta_pagar(%L, %L, %L, %L)', v_conta, 'fatura', v_obj2, 'grande.pdf'));
  PERFORM pg_temp.confere(v_err ILIKE '%10 MB%', 'arquivo de mais de 10 MB aceito: ' || coalesce(v_err, 'sem erro'));
  v_err := pg_temp.erro(format('INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L)',
                               'contas-pagar-anexos', 'outra-pasta/x.pdf', '{"size": 1, "mimetype": "application/pdf"}'));
  PERFORM pg_temp.confere(v_err ILIKE '%row-level security%', 'arquivo fora da pasta da conta aceito: ' || coalesce(v_err, 'sem erro'));

  -- 6. Gestor vê e baixa, não envia.
  PERFORM pg_temp.ser(v_ges);
  PERFORM pg_temp.confere((SELECT count(*) FROM public.contas_pagar_anexos WHERE conta_pagar_id = v_conta) = 1,
                          'gestor não vê o anexo');
  PERFORM pg_temp.confere((SELECT count(*) FROM storage.objects WHERE bucket_id = 'contas-pagar-anexos' AND name = v_obj) = 1,
                          'gestor não lê o arquivo');
  v_err := pg_temp.erro(format('INSERT INTO storage.objects (bucket_id, name, metadata) VALUES (%L, %L, %L)',
                               'contas-pagar-anexos', v_conta || '/' || gen_random_uuid() || '.pdf',
                               '{"size": 1, "mimetype": "application/pdf"}'));
  PERFORM pg_temp.confere(v_err ILIKE '%row-level security%', 'gestor enviou arquivo: ' || coalesce(v_err, 'sem erro'));

  -- 7. Sem financeiro.read: nada.
  PERFORM pg_temp.ser(v_sem);
  PERFORM pg_temp.confere((SELECT count(*) FROM public.contas_pagar_anexos) = 0, 'sem financeiro vê anexo');
  PERFORM pg_temp.confere((SELECT count(*) FROM public.contas_pagar_historico) = 0, 'sem financeiro vê histórico');
  PERFORM pg_temp.confere((SELECT count(*) FROM storage.objects WHERE bucket_id = 'contas-pagar-anexos') = 0,
                          'sem financeiro lê arquivo');
  PERFORM pg_temp.ser(NULL);
  v_err := pg_temp.erro('SELECT count(*) FROM public.contas_pagar_anexos');
  PERFORM pg_temp.confere(v_err ILIKE '%permission denied%', 'anon lê anexos: ' || coalesce(v_err, 'sem erro'));

  -- 8. Remover: só admin.
  PERFORM pg_temp.ser(v_fin);
  v_err := pg_temp.erro(format('SELECT public.remover_anexo_conta_pagar(%L)', v_anexo));
  PERFORM pg_temp.confere(v_err ILIKE '%administrador%', 'financeiro removeu anexo: ' || coalesce(v_err, 'sem erro'));
  PERFORM pg_temp.ser(v_adm);
  v_r := public.remover_anexo_conta_pagar(v_anexo, 'boleto errado (ensaio)');
  PERFORM pg_temp.confere(v_r->>'caminho' = v_obj, 'remover não devolveu o caminho do arquivo');
  PERFORM pg_temp.confere(NOT EXISTS (SELECT 1 FROM public.contas_pagar_anexos WHERE id = v_anexo), 'anexo não saiu');
  PERFORM pg_temp.confere(EXISTS (SELECT 1 FROM public.contas_pagar_historico
                                   WHERE conta_pagar_id = v_conta AND evento = 'anexo_removido' AND usuario_id = v_adm
                                     AND motivo = 'boleto errado (ensaio)'),
                          'histórico sem quem removeu');

  SELECT count(*) INTO v_n FROM public.contas_pagar_historico WHERE conta_pagar_id = v_conta;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'ENSAIO OK (nada foi gravado). Totais antes %, com a conta paga %, depois do estorno %. Movimento em % (informado %). % linhas de histórico.',
    v_antes, v_pago, v_depois, v_mov.data, v_data, v_n;
END
$ensaio$;

ROLLBACK;
