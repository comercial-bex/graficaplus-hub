-- =====================================================================================================
-- ENSAIO DAS CONTAS DE CONSUMO (16/11/2026) — roda depois de 20261116220000 e NÃO GRAVA NADA
--
-- Transação que termina em RAISE EXCEPTION: o resultado vem na mensagem ("ENSAIO CONSUMO OK" ou
-- "ENSAIO CONSUMO FALHOU") e o banco volta ao que era. Pessoas escolhidas pelo papel.
--
-- Prova os critérios de aceite:
--   lançar a fatura de 10/2026 da unidade da CEA funciona (conta em aberto, fatura ligada, caixa igual);
--   lançar 09/2026 de novo avisa a duplicidade, dizendo qual fatura já existe;
--   pagar a de 10/2026 muda o caixa só no valor lançado;
--   financeiro e vendedor não criam unidade pelo banco; gestor e admin criam;
--   a conta de 09/2026 segue igual (valor, status, datas, anexos, saída no caixa).
-- =====================================================================================================
BEGIN;

CREATE FUNCTION pg_temp.anota(t text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('ensaio.r', current_setting('ensaio.r', true) || chr(10) || t, true) $f$;
CREATE FUNCTION pg_temp.espera(ok boolean, t text) RETURNS void LANGUAGE sql AS
  $f$ SELECT pg_temp.anota(CASE WHEN coalesce(ok, false) THEN 'OK      ' ELSE 'FALHOU  ' END || t) $f$;
CREATE FUNCTION pg_temp.como(uid text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true) $f$;
CREATE FUNCTION pg_temp.g(k text) RETURNS text LANGUAGE sql AS $f$ SELECT current_setting('ensaio.' || k) $f$;
-- O que a conta de 09/2026 é hoje, para comparar no fim.
CREATE FUNCTION pg_temp.retrato_0926() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(c.valor::text || c.status::text || c.vencimento::text || coalesce(c.data_pagamento::text, '')
             || coalesce(c.forma_pagamento, '') || c.descricao
             || (SELECT count(*) FROM public.contas_pagar_anexos a WHERE a.conta_pagar_id = c.id)::text
             || (SELECT coalesce(string_agg(m.id::text || m.valor::text || m.data::text || coalesce(m.conta_id::text, ''), ','), '')
                   FROM public.caixa_movimentos m WHERE m.conta_pagar_id = c.id))
    FROM public.contas_pagar c WHERE c.id = '0e5a297c-e0db-4b0c-ae11-076377930d39' $f$;

SELECT set_config('ensaio.r', '', true);
SELECT set_config('ensaio.admin', (SELECT ur.user_id::text FROM user_roles ur WHERE ur.role = 'admin' LIMIT 1), true),
       set_config('ensaio.fin', (SELECT ur.user_id::text FROM user_roles ur
                                  WHERE ur.role = 'financeiro' AND NOT has_role(ur.user_id, 'admin') LIMIT 1), true),
       set_config('ensaio.vend', (SELECT ur.user_id::text FROM user_roles ur
                                   WHERE ur.role = 'vendedor' AND NOT can_see_financials(ur.user_id) LIMIT 1), true),
       set_config('ensaio.gestor', (SELECT ur.user_id::text FROM user_roles ur
                                     WHERE ur.role = 'gestor' AND NOT has_role(ur.user_id, 'admin') LIMIT 1), true),
       set_config('ensaio.unidade', (SELECT id::text FROM unidades_consumo WHERE identificador = '228.739.007-85'), true),
       set_config('ensaio.forn', (SELECT fornecedor_id::text FROM unidades_consumo WHERE identificador = '228.739.007-85'), true),
       set_config('ensaio.itau', 'd91b5d74-e754-48aa-8444-2f30ceb86eb2', true),
       set_config('ensaio.retrato', pg_temp.retrato_0926(), true),
       set_config('ensaio.caixa_n', (SELECT count(*)::text FROM caixa_movimentos), true),
       set_config('ensaio.caixa_s', (SELECT coalesce(sum(valor), 0)::text FROM caixa_movimentos), true),
       set_config('ensaio.comp_futura', to_char(date_trunc('month', hoje_br()) + interval '1 month', 'YYYY-MM-DD'), true);

SELECT pg_temp.espera(pg_temp.g('unidade') <> '' AND pg_temp.g('fin') <> '' AND pg_temp.g('vend') <> '',
                      'achou a unidade da CEA, financeiro e vendedor');
SELECT pg_temp.espera((SELECT count(*) FROM faturas_consumo WHERE unidade_id = pg_temp.g('unidade')::uuid
                        AND competencia = '2026-09-01' AND conta_pagar_id = '0e5a297c-e0db-4b0c-ae11-076377930d39') = 1,
                      'a conta de 09/2026 está ligada à unidade 228.739.007-85');

-- -----------------------------------------------------------------------------------------------------
-- Quem cria unidade (RLS)
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
DO $f$
DECLARE n int;
BEGIN
  BEGIN
    INSERT INTO unidades_consumo (tipo, fornecedor_id, identificador) VALUES ('agua', pg_temp.g('forn')::uuid, 'ENSAIO-FIN');
    PERFORM pg_temp.espera(false, 'financeiro criou unidade pelo banco');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLSTATE = '42501', 'financeiro não cria unidade pelo banco (' || SQLERRM || ')');
  END;
  UPDATE unidades_consumo SET observacoes = 'ensaio' WHERE id = pg_temp.g('unidade')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.espera(n = 0, 'financeiro não edita unidade pelo banco (0 linhas)');
  SELECT count(*) INTO n FROM unidades_consumo;
  PERFORM pg_temp.espera(n >= 1, 'financeiro vê as unidades');
END $f$;
RESET ROLE;

SELECT pg_temp.como(pg_temp.g('vend'));
SET LOCAL ROLE authenticated;
DO $v$
DECLARE n int;
BEGIN
  BEGIN
    INSERT INTO unidades_consumo (tipo, fornecedor_id, identificador) VALUES ('agua', pg_temp.g('forn')::uuid, 'ENSAIO-VEND');
    PERFORM pg_temp.espera(false, 'vendedor criou unidade pelo banco');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLSTATE = '42501', 'vendedor não cria unidade pelo banco');
  END;
  SELECT count(*) INTO n FROM unidades_consumo;
  PERFORM pg_temp.espera(n = 0, 'vendedor (sem financeiro) não vê unidade');
  BEGIN
    PERFORM lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-10-01', DATE '2026-11-07', 10);
    PERFORM pg_temp.espera(false, 'vendedor lançou fatura');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLSTATE = '42501', 'vendedor não lança fatura');
  END;
END $v$;
RESET ROLE;

DO $g$
BEGIN
  IF pg_temp.g('gestor') = '' THEN
    PERFORM pg_temp.anota('--      sem gestor: caso não testado');
    RETURN;
  END IF;
  PERFORM pg_temp.como(pg_temp.g('gestor'));
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO unidades_consumo (tipo, fornecedor_id, identificador, dia_vencimento)
    VALUES ('agua', pg_temp.g('forn')::uuid, 'ENSAIO-GESTOR', 10);
    UPDATE unidades_consumo SET dia_vencimento = 12 WHERE identificador = 'ENSAIO-GESTOR';
    RAISE EXCEPTION 'GESTOR|%', (SELECT dia_vencimento FROM unidades_consumo WHERE identificador = 'ENSAIO-GESTOR');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'GESTOR|12', 'gestor cria e edita unidade (' || SQLERRM || ')');
  END;
  EXECUTE 'RESET ROLE';
END $g$;

SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
DO $a$
BEGIN
  BEGIN
    INSERT INTO unidades_consumo (tipo, fornecedor_id, identificador) VALUES ('internet', pg_temp.g('forn')::uuid, 'ENSAIO-ADMIN');
    RAISE EXCEPTION 'ADMIN|ok';
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'ADMIN|ok', 'admin cria unidade (' || SQLERRM || ')');
  END;
  BEGIN
    INSERT INTO unidades_consumo (tipo, fornecedor_id, identificador) VALUES ('energia', pg_temp.g('forn')::uuid, '22873900785');
    PERFORM pg_temp.espera(false, 'a mesma unidade entrou de novo com outra pontuação');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLSTATE = '23505', 'a mesma unidade não entra de novo, nem sem pontuação');
  END;
END $a$;
RESET ROLE;

-- -----------------------------------------------------------------------------------------------------
-- Lançar fatura (financeiro)
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
DO $l$
DECLARE r jsonb; c record; n int;
BEGIN
  r := lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-10-15', DATE '2026-11-07', 812.349, 1234.5, 10.2, 25.5, ' 000123 ');
  PERFORM set_config('ensaio.conta10', r->>'conta_id', true);
  SELECT * INTO c FROM contas_pagar WHERE id = (r->>'conta_id')::uuid;
  PERFORM pg_temp.espera(c.status = 'aberta' AND c.valor = 812.35 AND c.vencimento = DATE '2026-11-07'
                         AND c.categoria = 'energia' AND c.descricao = 'Energia CEA — UC 228.739.007-85 — competência 10/2026'
                         AND c.fornecedor = 'COMPANHIA DE ELETRICIDADE DO AMAPA CEA',
                         'lançar 10/2026 cria a conta em aberto, no padrão de descrição (' || c.descricao || ', R$ ' || c.valor || ')');
  SELECT count(*) INTO n FROM faturas_consumo WHERE conta_pagar_id = c.id AND competencia = DATE '2026-10-01'
     AND consumo = 1234.5 AND bandeira_taxas = 10.2 AND iluminacao_publica = 25.5 AND numero_nf = '000123';
  PERFORM pg_temp.espera(n = 1, 'a fatura de 10/2026 fica ligada à unidade, com competência no dia 1 e os dados');

  BEGIN
    PERFORM lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-09-01', DATE '2026-10-07', 731.46);
    PERFORM pg_temp.espera(false, 'lançou 09/2026 de novo');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'Já existe a fatura de 09/2026 desta unidade: R$ 731,46, vencimento 07/10/2026, paga em 16/11/2026.',
                           '09/2026 de novo avisa a duplicidade (' || SQLERRM || ')');
  END;
  BEGIN
    PERFORM lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-10-01', DATE '2026-11-07', 812.35);
    PERFORM pg_temp.espera(false, 'lançou 10/2026 duas vezes');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM LIKE 'Já existe a fatura de 10/2026 desta unidade: R$ 812,35, vencimento 07/11/2026, em aberto.',
                           '10/2026 duas vezes avisa a duplicidade (' || SQLERRM || ')');
  END;
  BEGIN
    PERFORM lancar_fatura_consumo(pg_temp.g('unidade')::uuid, pg_temp.g('comp_futura')::date, DATE '2026-12-07', 10);
    PERFORM pg_temp.espera(false, 'lançou competência que não começou');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM LIKE 'A competência % ainda não começou.', 'competência que não começou é recusada');
  END;
  BEGIN
    PERFORM lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-08-01', DATE '2026-09-07', 0);
    PERFORM pg_temp.espera(false, 'lançou fatura sem valor');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'Informe o valor da fatura.', 'fatura sem valor é recusada');
  END;

  SELECT count(*) INTO n FROM caixa_movimentos;
  PERFORM pg_temp.espera(n::text = pg_temp.g('caixa_n')
                         AND (SELECT coalesce(sum(valor), 0) FROM caixa_movimentos)::text = pg_temp.g('caixa_s'),
                         'lançar a fatura não mexe no caixa');

  -- Apagar a conta em aberto leva a fatura junto e libera a competência.
  BEGIN
    DELETE FROM contas_pagar WHERE id = pg_temp.g('conta10')::uuid;
    SELECT count(*) INTO n FROM faturas_consumo WHERE conta_pagar_id = pg_temp.g('conta10')::uuid;
    r := lancar_fatura_consumo(pg_temp.g('unidade')::uuid, DATE '2026-10-01', DATE '2026-11-07', 812.35);
    RAISE EXCEPTION 'APAGAR|%|%', n, r ? 'conta_id';
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'APAGAR|0|t', 'apagar a conta em aberto leva a fatura junto e libera a competência (' || SQLERRM || ')');
  END;
END $l$;
RESET ROLE;

-- Pagar a de 10/2026 pelo Itaú: o caixa muda só no valor lançado.
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((pagar_conta_pagar(pg_temp.g('conta10')::uuid, hoje_br(), pg_temp.g('itau')::uuid, NULL)->>'negado') IS NULL,
                      'financeiro paga a de 10/2026 pelo Itaú');
RESET ROLE;
SELECT pg_temp.espera((SELECT count(*) FROM caixa_movimentos)::text = (pg_temp.g('caixa_n')::int + 1)::text
                      AND (SELECT sum(valor) FROM caixa_movimentos) = pg_temp.g('caixa_s')::numeric + 812.35,
                      'o caixa ganha uma saída de R$ 812,35 e nada mais');

-- Corrigir os dados da fatura.
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((corrigir_dados_fatura_consumo('0e5a297c-e0db-4b0c-ae11-076377930d39', 600, NULL, 20, '999')->>'corrigida') = 'true',
                      'financeiro corrige kWh e nota da 09/2026');
RESET ROLE;
SELECT pg_temp.como(pg_temp.g('vend'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((corrigir_dados_fatura_consumo('0e5a297c-e0db-4b0c-ae11-076377930d39', 1, NULL, NULL, NULL)->>'negado') = 'true',
                      'vendedor não corrige dados da fatura (negado)');
RESET ROLE;
SELECT pg_temp.espera((SELECT consumo FROM faturas_consumo WHERE conta_pagar_id = '0e5a297c-e0db-4b0c-ae11-076377930d39') = 600
                      AND EXISTS (SELECT 1 FROM contas_pagar_historico WHERE conta_pagar_id = '0e5a297c-e0db-4b0c-ae11-076377930d39'
                                    AND evento = 'tentativa_negada' AND detalhes->>'acao' = 'corrigir dados da fatura de consumo'),
                      'a correção do vendedor não passou e ficou no histórico');

-- A conta de 09/2026 continua igual (valor, status, datas, forma, descrição, anexos, saída no caixa).
SELECT pg_temp.espera(pg_temp.retrato_0926() = pg_temp.g('retrato'), 'a conta de 09/2026 não mudou em nada');

SELECT pg_temp.espera(NOT has_table_privilege('anon', 'public.unidades_consumo', 'SELECT')
                      AND NOT has_table_privilege('anon', 'public.faturas_consumo', 'SELECT')
                      AND NOT has_function_privilege('anon', 'public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text)'::regprocedure, 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text)'::regprocedure, 'EXECUTE')
                      AND NOT has_table_privilege('authenticated', 'public.faturas_consumo', 'INSERT'),
                      'anon não lê nem executa nada; ninguém grava fatura por fora da função');

DO $fim$
DECLARE r text := current_setting('ensaio.r');
BEGIN
  IF r LIKE '%FALHOU%' THEN
    RAISE EXCEPTION 'ENSAIO CONSUMO FALHOU (nada gravado):%', r;
  END IF;
  RAISE EXCEPTION 'ENSAIO CONSUMO OK (nada gravado):%', r;
END $fim$;
