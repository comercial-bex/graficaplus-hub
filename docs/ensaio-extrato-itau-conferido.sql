-- =====================================================================================================
-- ENSAIO da migração 20261116230000 (extrato do Itaú conferido com o OFX do banco) NO BANCO VIVO.
-- Roda numa transação e termina com RAISE EXCEPTION: NADA fica gravado. Lista OK/FALHOU no fim.
-- Gerado a partir do arquivo da migração (do BEGIN ao COMMIT, sem alteração) e do OFX do Itaú.
-- =====================================================================================================
BEGIN;
CREATE FUNCTION pg_temp.anota(t text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('ensaio.r', current_setting('ensaio.r', true) || chr(10) || t, true) $f$;
CREATE FUNCTION pg_temp.espera(ok boolean, t text) RETURNS void LANGUAGE sql AS
  $f$ SELECT pg_temp.anota(CASE WHEN coalesce(ok, false) THEN 'OK      ' ELSE 'FALHOU  ' END || t) $f$;
CREATE FUNCTION pg_temp.como(uid text) RETURNS void LANGUAGE sql AS
  $f$ SELECT set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true) $f$;
CREATE FUNCTION pg_temp.g(k text) RETURNS text LANGUAGE sql AS $f$ SELECT current_setting('ensaio.' || k) $f$;
SELECT set_config('ensaio.r', '', true);
SELECT set_config('ensaio.admin', (SELECT ur.user_id::text FROM user_roles ur WHERE ur.role = 'admin' LIMIT 1), true),
       set_config('ensaio.fin', (SELECT ur.user_id::text FROM user_roles ur
                                  WHERE ur.role = 'financeiro' AND NOT has_role(ur.user_id, 'admin') LIMIT 1), true),
       set_config('ensaio.vend', (SELECT ur.user_id::text FROM user_roles ur
                                   WHERE ur.role = 'vendedor' AND NOT can_see_financials(ur.user_id) LIMIT 1), true),
       set_config('ensaio.sem_chave', (SELECT ur.user_id::text FROM user_roles ur
                                        WHERE NOT has_permission(ur.user_id, 'pagamentos.confirm')
                                          AND NOT has_role(ur.user_id, 'admin') LIMIT 1), true),
       set_config('ensaio.fp_contas_pagar', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar x), true),
       set_config('ensaio.fp_contas_pagar_anexos', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar_anexos x), true),
       set_config('ensaio.fp_contas_pagar_historico', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar_historico x), true),
       set_config('ensaio.fp_pagamentos', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.pagamentos x), true),
       set_config('ensaio.fp_reembolsos', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.reembolsos x), true),
       set_config('ensaio.fp_compromissos_financeiros', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.compromissos_financeiros x), true),
       set_config('ensaio.fp_faturas_consumo', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.faturas_consumo x), true),
       set_config('ensaio.fp_unidades_consumo', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.unidades_consumo x), true),
       set_config('ensaio.fp_caixa_fora', (SELECT md5(coalesce(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id), '')) FROM public.caixa_movimentos m WHERE m.origem <> 'extrato'), true),
       set_config('ensaio.logs', (SELECT count(*)::text FROM logs_auditoria), true);

-- ===================== a migração, do BEGIN ao COMMIT ===================================================
SET LOCAL lock_timeout = '5s';

DO $guarda$
DECLARE
  v_itau constant uuid := 'd91b5d74-e754-48aa-8444-2f30ceb86eb2';
  v_n int;
  v_digital text;
  v_md5 text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.importar_extrato(uuid, jsonb)'::regprocedure);
BEGIN
  IF v_md5 IS DISTINCT FROM 'aad0d901efe9b8f15312c8d62bdcc9fe' THEN
    RAISE EXCEPTION 'importar_extrato mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_md5;
  END IF;
  SELECT count(*),
         md5(string_agg(t.id::text || '|' || t.data || '|' || t.valor || '|' || t.tipo || '|' || coalesce(t.fitid, '')
                        || '|' || coalesce(t.caixa_movimento_id::text, ''), ',' ORDER BY t.id))
    INTO v_n, v_digital
    FROM public.banco_transacoes t WHERE t.conta_id = v_itau;
  IF v_n <> 91 OR v_digital IS DISTINCT FROM '15127cc5e571c5a2fb4159531e57691b' THEN
    RAISE EXCEPTION 'O extrato do Itaú mudou desde a conferência (% linhas, digital %). Refaça a conferência.', v_n, v_digital;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contas_bancarias
                  WHERE id = v_itau AND saldo_inicial = 225 AND saldo_inicial_data = DATE '2026-09-10') THEN
    RAISE EXCEPTION 'O saldo inicial do Itaú não é mais R$ 225,00 em 10/09/2026.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.banco_transacoes WHERE conta_id <> v_itau) THEN
    RAISE EXCEPTION 'Apareceu extrato em outra conta. Esta correção é só do Itaú.';
  END IF;
  -- A saída da CEA (conta a pagar paga pelo sistema) existe e nenhuma linha do extrato liga nela ainda.
  IF NOT EXISTS (SELECT 1 FROM public.caixa_movimentos
                  WHERE id = '0e84eeb0-3cad-4c60-ada2-13bcd9cf3fcf' AND tipo = 'saida' AND valor = 731.46
                    AND data = DATE '2026-11-16' AND conta_id = v_itau
                    AND conta_pagar_id = '0e5a297c-e0db-4b0c-ae11-076377930d39')
     OR EXISTS (SELECT 1 FROM public.banco_transacoes WHERE caixa_movimento_id = '0e84eeb0-3cad-4c60-ada2-13bcd9cf3fcf') THEN
    RAISE EXCEPTION 'A saída da conta da CEA de 16/11 não está como na conferência.';
  END IF;
  -- O Pix da OS 212 ainda está na cópia de 28/10 e o de 27/10 ainda está sem par.
  IF NOT EXISTS (SELECT 1 FROM public.caixa_movimentos
                  WHERE id = '3968c7d8-3993-458a-9368-e0ea46dfe687' AND pagamento_id = 'f6241d64-585e-442c-bc34-aa1f3891ddb8')
     OR NOT EXISTS (SELECT 1 FROM public.caixa_movimentos
                     WHERE id = '70ae837e-f896-429b-803c-a92d8acc281c' AND pagamento_id IS NULL
                       AND tipo = 'entrada' AND valor = 18.75 AND data = DATE '2026-10-27')
     OR EXISTS (SELECT 1 FROM public.caixa_movimentos x
                 WHERE x.pagamento_id = 'f6241d64-585e-442c-bc34-aa1f3891ddb8' AND x.id <> '3968c7d8-3993-458a-9368-e0ea46dfe687') THEN
    RAISE EXCEPTION 'Os Pix de R$ 18,75 de 27 e 28/10 não estão como na conferência.';
  END IF;
  IF to_regclass('public.correcoes_de_extrato') IS NOT NULL THEN
    RAISE EXCEPTION 'correcoes_de_extrato já existe: esta migração já rodou?';
  END IF;
END $guarda$;

-- 1. Cópia de tudo o que muda --------------------------------------------------------------------------
CREATE TABLE public.correcoes_de_extrato (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote text NOT NULL,
  acao text NOT NULL CHECK (acao IN ('apagada', 'alterada', 'inserida')),
  tabela text NOT NULL CHECK (tabela IN ('banco_transacoes', 'caixa_movimentos', 'contas_bancarias')),
  registro_id uuid NOT NULL,
  antes jsonb,
  depois jsonb,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((acao = 'apagada' AND antes IS NOT NULL AND depois IS NULL)
      OR (acao = 'alterada' AND antes IS NOT NULL AND depois IS NOT NULL)
      OR (acao = 'inserida' AND antes IS NULL AND depois IS NOT NULL))
);
COMMENT ON TABLE public.correcoes_de_extrato IS
  'Cópia de cada linha do extrato, do caixa ou da conta bancária que uma correção apagou, alterou ou inseriu '
  '(antes e depois). Desfazer = reinserir o antes e apagar o depois. Primeira: Itaú x OFX do banco, 16/11/2026.';
ALTER TABLE public.correcoes_de_extrato ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.correcoes_de_extrato FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.correcoes_de_extrato TO authenticated;
GRANT ALL ON TABLE public.correcoes_de_extrato TO service_role;
CREATE POLICY "correcoes de extrato: so o admin le" ON public.correcoes_de_extrato
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

ALTER TABLE public.contas_bancarias ADD COLUMN extrato_conferido_ate date;
COMMENT ON COLUMN public.contas_bancarias.extrato_conferido_ate IS
  'Último dia em que o extrato desta conta foi conferido linha a linha com o arquivo do banco. '
  'importar_extrato ignora linha com data até este dia. Vazio = sem trava.';

-- 2. O que sai: 27 linhas de saldo e 10 cópias, com os espelhos no caixa --------------------------------
CREATE TEMP TABLE _apagar ON COMMIT DROP AS
SELECT t.id, t.caixa_movimento_id,
       CASE WHEN t.descricao ILIKE 'SALDO TOTAL DISPON%'
            THEN 'Linha de saldo do banco gravada como crédito: não é dinheiro entrando.'
            ELSE 'Cópia repetida: o banco tem um lançamento só (OFX do Itaú de 16/11/2026).' END AS motivo
  FROM public.banco_transacoes t
 WHERE t.conta_id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2'
   AND (t.descricao ILIKE 'SALDO TOTAL DISPON%'
        OR t.fitid IN ('20260916002', '20261008002', '20261013007', '20261013008', '20261014002',
                       '20261019006', '20261023004', '20261026002', '20261028003', '20261029005'));

DO $confere_o_que_sai$
DECLARE
  v_saldos int; v_soma_saldos numeric; v_copias int; v_soma_copias numeric; v_sem_par int; v_espelhos int;
BEGIN
  SELECT count(*) FILTER (WHERE t.descricao ILIKE 'SALDO TOTAL DISPON%'),
         sum(t.valor) FILTER (WHERE t.descricao ILIKE 'SALDO TOTAL DISPON%'),
         count(*) FILTER (WHERE t.descricao NOT ILIKE 'SALDO TOTAL DISPON%'),
         sum(t.valor) FILTER (WHERE t.descricao NOT ILIKE 'SALDO TOTAL DISPON%')
    INTO v_saldos, v_soma_saldos, v_copias, v_soma_copias
    FROM public.banco_transacoes t JOIN _apagar a USING (id);
  IF v_saldos <> 27 OR v_soma_saldos <> 23043.30 OR v_copias <> 10 OR v_soma_copias <> 543.03 THEN
    RAISE EXCEPTION 'O que sai não é o conferido: % saldos (R$ %), % cópias (R$ %).',
      v_saldos, v_soma_saldos, v_copias, v_soma_copias;
  END IF;
  -- Toda cópia tem a gêmea que fica (mesmo dia, valor, tipo e descrição).
  SELECT count(*) INTO v_sem_par
    FROM public.banco_transacoes c JOIN _apagar a USING (id)
   WHERE c.descricao NOT ILIKE 'SALDO TOTAL DISPON%'
     AND NOT EXISTS (SELECT 1 FROM public.banco_transacoes g
                      WHERE g.conta_id = c.conta_id AND g.id NOT IN (SELECT id FROM _apagar)
                        AND g.data = c.data AND g.valor = c.valor AND g.tipo = c.tipo
                        AND lower(g.descricao) = lower(c.descricao));
  IF v_sem_par <> 0 THEN
    RAISE EXCEPTION '% cópia(s) sem a gêmea que fica.', v_sem_par;
  END IF;
  -- Os 37 espelhos do caixa são entradas do extrato, sem OS e sem conta a pagar; só o da OS 212 tem Pix.
  SELECT count(DISTINCT m.id) INTO v_espelhos
    FROM public.caixa_movimentos m JOIN _apagar a ON a.caixa_movimento_id = m.id
   WHERE m.origem = 'extrato' AND m.tipo = 'entrada' AND m.os_id IS NULL AND m.conta_pagar_id IS NULL
     AND (m.pagamento_id IS NULL OR m.id = '3968c7d8-3993-458a-9368-e0ea46dfe687');
  IF v_espelhos <> 37 THEN
    RAISE EXCEPTION 'Os espelhos no caixa não são as 37 entradas do extrato esperadas (%).', v_espelhos;
  END IF;
END $confere_o_que_sai$;

INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, antes, motivo)
SELECT 'itau-ofx-2026-11-16', 'apagada', 'banco_transacoes', t.id, to_jsonb(t), a.motivo
  FROM public.banco_transacoes t JOIN _apagar a USING (id);
INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, antes, motivo)
SELECT 'itau-ofx-2026-11-16', 'apagada', 'caixa_movimentos', m.id, to_jsonb(m), a.motivo
  FROM public.caixa_movimentos m JOIN _apagar a ON a.caixa_movimento_id = m.id;

DELETE FROM public.banco_transacoes WHERE id IN (SELECT id FROM _apagar);
DELETE FROM public.caixa_movimentos WHERE id IN (SELECT caixa_movimento_id FROM _apagar);

-- 3. O Pix da OS 212 vai para o R$ 18,75 de 27/10 (o pagamento é de 29/10: 2 dias, dentro da regra) ----
WITH antes AS (
  SELECT to_jsonb(m) AS j FROM public.caixa_movimentos m WHERE m.id = '70ae837e-f896-429b-803c-a92d8acc281c'
), feito AS (
  UPDATE public.caixa_movimentos m SET pagamento_id = 'f6241d64-585e-442c-bc34-aa1f3891ddb8'
   WHERE m.id = '70ae837e-f896-429b-803c-a92d8acc281c' AND m.pagamento_id IS NULL
  RETURNING to_jsonb(m) AS j
)
INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, antes, depois, motivo)
SELECT 'itau-ofx-2026-11-16', 'alterada', 'caixa_movimentos', '70ae837e-f896-429b-803c-a92d8acc281c',
       (SELECT j FROM antes), feito.j,
       'O Pix da OS 212 estava ligado à cópia de 28/10, que saiu; o banco tem R$ 18,75 em 27/10 e em 28/10.'
  FROM feito;

-- 4. O que faltava: 41 lançamentos do arquivo do banco ------------------------------------------------
CREATE TEMP TABLE _novas (
  fitid text PRIMARY KEY,
  data date NOT NULL,
  valor numeric(12, 2) NOT NULL CHECK (valor <> 0),
  descricao text NOT NULL,
  movimento uuid
) ON COMMIT DROP;
INSERT INTO _novas (fitid, data, valor, descricao) VALUES
  ('20260916002', DATE '2026-09-16', -1000.00, 'PIX ENVIADO YVENS FRANCI'),
  ('20261008002', DATE '2026-10-08', -1000.00, 'PIX ENVIADO NORTE CONSTR'),
  ('OFX:20261013001:resto', DATE '2026-10-13', -939.00, 'SISPAG PIX QR-CODE (parte que faltava; no banco, R$ 1.282,87 no dia)'),
  ('20261014002', DATE '2026-10-14', -76.99, 'PIX ENVIADO JOSUE SILVA'),
  ('OFX:20261019001', DATE '2026-10-19', -80.21, 'SISPAG PIX QR-CODE'),
  ('OFX:20261023003:resto', DATE '2026-10-23', -50.00, 'PIX ENVIADO (parte que faltava; no banco, R$ 134,00 no dia)'),
  ('OFX:20261026001', DATE '2026-10-26', -16.62, 'SISPAG PIX QR-CODE'),
  ('OFX:20261028001', DATE '2026-10-28', -300.00, 'SISPAG PIX QR-CODE'),
  ('OFX:20261029002', DATE '2026-10-29', 0.01, 'REND PAGO APLIC AUT MAIS'),
  ('OFX:20261029004', DATE '2026-10-29', -767.00, 'PIX ENVIADO'),
  ('20261103001', DATE '2026-11-03', 21.20, 'REDE ELO DB0108719065'),
  ('20261103002', DATE '2026-11-03', 70.10, 'PIX QRS'),
  ('20261104001', DATE '2026-11-04', -396.91, 'SISPAG PIX QR-CODE'),
  ('20261104002', DATE '2026-11-04', 60.00, 'PIX QRS CLEITON COU04/11'),
  ('20261104003', DATE '2026-11-04', 3318.00, 'PIX TRANSF DISTRIB04/11'),
  ('20261104004', DATE '2026-11-04', -17.88, 'TAR PIX QR LIQ ESTATICO'),
  ('20261105001', DATE '2026-11-05', -370.70, 'SISPAG PIX QR-CODE'),
  ('20261105002', DATE '2026-11-05', 0.01, 'REND PAGO APLIC AUT MAIS'),
  ('20261105003', DATE '2026-11-05', -500.00, 'PIX ENVIADO CIBELE LARIS'),
  ('20261106001', DATE '2026-11-06', 1239.17, 'PIX QRS'),
  ('20261106002', DATE '2026-11-06', 86.23, 'DEV PIX MERCADO PAG06/11'),
  ('20261106003', DATE '2026-11-06', -100.00, 'PIX ENVIADO FERNANDO AUG'),
  ('20261109001', DATE '2026-11-09', -177.50, 'SISPAG PIX QR-CODE'),
  ('20261109002', DATE '2026-11-09', 0.02, 'REND PAGO APLIC AUT MAIS'),
  ('20261109003', DATE '2026-11-09', 375.00, 'PIX QRS CAROLINE FE07/11'),
  ('20261109004', DATE '2026-11-09', -2600.00, 'PIX ENVIADO'),
  ('20261110001', DATE '2026-11-10', -100.00, 'SISPAG PIX QR-CODE'),
  ('20261110002', DATE '2026-11-10', 0.01, 'REDE MAST DB0108719065'),
  ('20261110003', DATE '2026-11-10', 0.01, 'REND PAGO APLIC AUT MAIS'),
  ('20261110004', DATE '2026-11-10', 233.44, 'PIX QRS'),
  ('20261110005', DATE '2026-11-10', -649.80, 'PIX ENVIADO'),
  ('20261111001', DATE '2026-11-11', 28.09, 'REDE MAST AT0108719065'),
  ('20261111002', DATE '2026-11-11', 11.55, 'PIX QRS AMAURI RAMO11/11'),
  ('20261112001', DATE '2026-11-12', 249.80, 'PIX QRS'),
  ('20261112002', DATE '2026-11-12', 130.00, 'PIX TRANSF ALICIA 12/11'),
  ('20261113001', DATE '2026-11-13', -70.00, 'SISPAG PIX QR-CODE'),
  ('20261113002', DATE '2026-11-13', 208.87, 'PIX QRS CAROLINE FE13/11'),
  ('20261116001', DATE '2026-11-16', -731.46, 'SISPAG PIX QR-CODE'),
  ('20261116002', DATE '2026-11-16', 87.80, 'PIX QRS'),
  ('20261116003', DATE '2026-11-16', 236.94, 'PIX TRANSF'),
  ('20261116004', DATE '2026-11-16', -738.09, 'PIX ENVIADO');
-- A saída da CEA já está no caixa (conta a pagar paga em 16/11): a linha do extrato liga nela.
UPDATE _novas SET movimento = CASE WHEN fitid = '20261116001' THEN '0e84eeb0-3cad-4c60-ada2-13bcd9cf3fcf'::uuid
                                   ELSE gen_random_uuid() END;

DO $confere_o_que_entra$
DECLARE v_n int; v_soma numeric; v_cea numeric;
BEGIN
  SELECT count(*), sum(valor), sum(valor) FILTER (WHERE fitid = '20261116001') INTO v_n, v_soma, v_cea FROM _novas;
  IF v_n <> 41 OR v_soma <> -4325.91 OR v_cea <> -731.46 THEN
    RAISE EXCEPTION 'O que entra não é o conferido: % linhas, R$ %, CEA R$ %.', v_n, v_soma, v_cea;
  END IF;
  IF EXISTS (SELECT 1 FROM public.banco_transacoes t JOIN _novas n ON n.fitid = t.fitid
              WHERE t.conta_id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2') THEN
    RAISE EXCEPTION 'Algum FITID novo já existe no extrato do Itaú.';
  END IF;
END $confere_o_que_entra$;

INSERT INTO public.caixa_movimentos
  (id, tipo, origem, descricao, categoria, valor, data, realizado, conta_id, created_by, observacoes)
SELECT n.movimento, CASE WHEN n.valor > 0 THEN 'entrada' ELSE 'saida' END, 'extrato', n.descricao, 'banco',
       abs(n.valor), n.data, true, 'd91b5d74-e754-48aa-8444-2f30ceb86eb2', NULL,
       'Extrato OFX do Itaú, conferido com o banco em 16/11/2026'
  FROM _novas n
 WHERE n.fitid <> '20261116001';

-- Mesmo hash da importação: conta | data | valor | tipo | descrição em minúsculas | fitid.
INSERT INTO public.banco_transacoes
  (conta_id, data, descricao, valor, tipo, documento, fitid, origem, conciliado, caixa_movimento_id, hash_dedup, created_by)
SELECT 'd91b5d74-e754-48aa-8444-2f30ceb86eb2', n.data, n.descricao, abs(n.valor), x.tipo, NULL, n.fitid, 'extrato',
       true, n.movimento,
       md5('d91b5d74-e754-48aa-8444-2f30ceb86eb2' || '|' || n.data::text || '|' || abs(n.valor)::text || '|'
           || x.tipo || '|' || lower(n.descricao) || '|' || n.fitid),
       NULL
  FROM _novas n
 CROSS JOIN LATERAL (SELECT CASE WHEN n.valor > 0 THEN 'credito' ELSE 'debito' END AS tipo) x;

INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, depois, motivo)
SELECT 'itau-ofx-2026-11-16', 'inserida', 'banco_transacoes', t.id, to_jsonb(t),
       'Lançamento do OFX do Itaú (16/11/2026) que faltava no sistema.'
  FROM public.banco_transacoes t JOIN _novas n ON n.fitid = t.fitid
 WHERE t.conta_id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2';
INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, depois, motivo)
SELECT 'itau-ofx-2026-11-16', 'inserida', 'caixa_movimentos', m.id, to_jsonb(m),
       'Espelho no caixa do lançamento do OFX do Itaú que faltava (como a importação faz).'
  FROM public.caixa_movimentos m JOIN _novas n ON n.movimento = m.id
 WHERE n.fitid <> '20261116001';

-- A mesma conciliação que a tela roda depois de cada importação (valor exato, até 3 dias, um para um).
CREATE TEMP TABLE _sem_par ON COMMIT DROP AS
SELECT m.id, to_jsonb(m) AS j FROM public.caixa_movimentos m WHERE m.origem = 'extrato' AND m.pagamento_id IS NULL;
DO $concilia$
DECLARE r jsonb;
BEGIN
  r := public.conciliar_extrato_com_pagamentos(true);
  IF (r->>'ligados')::int <> 4 OR (r->>'soma')::numeric <> 725.42 THEN
    RAISE EXCEPTION 'A conciliação dos Pix de novembro não é a conferida (4, R$ 725,42): %', r;
  END IF;
END $concilia$;
INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, antes, depois, motivo)
SELECT 'itau-ofx-2026-11-16', 'alterada', 'caixa_movimentos', m.id, s.j, to_jsonb(m),
       'Pix de novembro ligado ao pagamento da OS já registrado (a conciliação que a importação faz).'
  FROM public.caixa_movimentos m JOIN _sem_par s ON s.id = m.id
 WHERE m.pagamento_id IS NOT NULL;

-- 5. Saldo inicial do arquivo do banco e a trava do período conferido --------------------------------
WITH antes AS (
  SELECT to_jsonb(c) AS j FROM public.contas_bancarias c WHERE c.id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2'
), feito AS (
  UPDATE public.contas_bancarias c
     SET saldo_inicial = 0, saldo_inicial_data = DATE '2026-08-17',
         extrato_conferido_ate = DATE '2026-11-16', updated_at = now()
   WHERE c.id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2'
     AND c.saldo_inicial = 225 AND c.saldo_inicial_data = DATE '2026-09-10'
  RETURNING to_jsonb(c) AS j
)
INSERT INTO public.correcoes_de_extrato (lote, acao, tabela, registro_id, antes, depois, motivo)
SELECT 'itau-ofx-2026-11-16', 'alterada', 'contas_bancarias', 'd91b5d74-e754-48aa-8444-2f30ceb86eb2',
       (SELECT j FROM antes), feito.j,
       'Saldo inicial do arquivo do banco (R$ 0,00 em 17/08/2026) e extrato conferido até 16/11/2026.'
  FROM feito;

-- 6. A importação ignora linha de saldo e o período já conferido ---------------------------------------
CREATE OR REPLACE FUNCTION public.importar_extrato(p_conta_id uuid, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  l jsonb;
  v_data date; v_valor numeric; v_tipo text; v_desc text; v_doc text; v_fitid text;
  v_hash text; v_tx uuid; v_mov uuid;
  v_importadas int := 0; v_duplicadas int := 0;
  v_dups jsonb := '[]'::jsonb;
  v_conferido date;
  v_saldos int := 0; v_ja_conferidas int := 0;
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');

  SELECT c.extrato_conferido_ate INTO v_conferido FROM public.contas_bancarias c WHERE c.id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancária não encontrada';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Nenhum lançamento para importar';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_data  := NULLIF(l->>'data','')::date;
    v_valor := round(COALESCE(NULLIF(l->>'valor','')::numeric, 0), 2);
    v_desc  := COALESCE(NULLIF(btrim(l->>'descricao'),''), 'Lançamento bancário');
    v_doc   := NULLIF(btrim(COALESCE(l->>'documento','')), '');
    v_fitid := NULLIF(btrim(COALESCE(l->>'fitid','')), '');
    v_tipo  := CASE WHEN COALESCE(l->>'tipo','') IN ('credito','debito')
                    THEN l->>'tipo'
                    WHEN v_valor < 0 THEN 'debito' ELSE 'credito' END;
    v_valor := abs(v_valor);

    IF v_data IS NULL OR v_valor = 0 THEN
      CONTINUE;
    END IF;

    -- "SALDO TOTAL DISPONÍVEL DIA", "SALDO ANTERIOR", "SDO CTA/APL...": é o banco dizendo quanto há na
    -- conta, não dinheiro entrando. Em 28/10/2026 entraram 27 dessas como crédito (R$ 23.043,30).
    IF v_desc ~* '^\s*(saldo|sdo)(\s|$)' THEN
      v_saldos := v_saldos + 1;
      CONTINUE;
    END IF;

    -- Período já conferido linha a linha com o banco: reimportar não pode duplicar.
    IF v_conferido IS NOT NULL AND v_data <= v_conferido THEN
      v_ja_conferidas := v_ja_conferidas + 1;
      CONTINUE;
    END IF;

    v_hash := md5(p_conta_id::text || '|' || v_data::text || '|' || v_valor::text || '|'
                  || v_tipo || '|' || lower(v_desc) || '|' || COALESCE(v_fitid,''));

    IF EXISTS (
      SELECT 1 FROM public.banco_transacoes t
       WHERE t.conta_id = p_conta_id
         AND (t.hash_dedup = v_hash OR (v_fitid IS NOT NULL AND t.fitid = v_fitid))
    ) THEN
      v_duplicadas := v_duplicadas + 1;
      v_dups := v_dups || jsonb_build_object('data', v_data, 'descricao', v_desc, 'valor', v_valor);
      CONTINUE;
    END IF;

    INSERT INTO public.caixa_movimentos
      (tipo, origem, descricao, categoria, valor, data, realizado, conta_id, created_by, observacoes)
    VALUES
      (CASE WHEN v_tipo = 'credito' THEN 'entrada' ELSE 'saida' END,
       'extrato', v_desc, 'banco', v_valor, v_data, true, p_conta_id, v_uid,
       'Importado do extrato bancário')
    RETURNING id INTO v_mov;

    INSERT INTO public.banco_transacoes
      (conta_id, data, descricao, valor, tipo, documento, fitid, origem,
       conciliado, caixa_movimento_id, hash_dedup, created_by)
    VALUES
      (p_conta_id, v_data, v_desc, v_valor, v_tipo, v_doc, v_fitid, 'extrato',
       true, v_mov, v_hash, v_uid)
    RETURNING id INTO v_tx;

    v_importadas := v_importadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'conta_id', p_conta_id,
    'importadas', v_importadas,
    'duplicadas', v_duplicadas,
    'ignoradas', v_dups,
    'saldos_ignorados', v_saldos,
    'ja_conferidas', v_ja_conferidas,
    'conferido_ate', v_conferido,
    'saldo_atual', (SELECT saldo_atual FROM public.vw_saldo_conta WHERE conta_id = p_conta_id)
  );
END $function$;

REVOKE ALL ON FUNCTION public.importar_extrato(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_extrato(uuid, jsonb) TO authenticated, service_role;

-- CONFERE: se qualquer coisa não bater, nada disto fica -------------------------------------------------
DO $confere$
DECLARE
  v_itau constant uuid := 'd91b5d74-e754-48aa-8444-2f30ceb86eb2';
  v_n int; v_saldo numeric; v_view numeric; v_dias_errados int; v_restos int; v_sem_espelho int;
  v_orfaos int; v_pix int; v_copias jsonb;
BEGIN
  SELECT count(*),
         c.saldo_inicial + coalesce(sum(CASE t.tipo WHEN 'debito' THEN -abs(t.valor) ELSE abs(t.valor) END), 0)
    INTO v_n, v_saldo
    FROM public.contas_bancarias c
    LEFT JOIN public.banco_transacoes t ON t.conta_id = c.id AND t.data >= c.saldo_inicial_data
   WHERE c.id = v_itau
   GROUP BY c.saldo_inicial;
  SELECT saldo_atual INTO v_view FROM public.vw_saldo_conta WHERE conta_id = v_itau;
  IF v_n <> 95 OR v_saldo <> 385.82 OR v_view <> 385.82 THEN
    RAISE EXCEPTION 'O Itaú não fechou: % linhas, saldo do card R$ %, saldo da tela R$ % (esperado 95 e R$ 385,82).',
      v_n, v_saldo, v_view;
  END IF;

  -- Crédito e débito de cada dia iguais aos do arquivo do banco (sem as linhas de saldo).
  WITH banco (data, creditos, debitos) AS (VALUES
  (DATE '2026-09-08', 148.00, 0.00),
  (DATE '2026-09-09', 35.00, 0.00),
  (DATE '2026-09-10', 482.00, 0.00),
  (DATE '2026-09-11', 70.00, 0.00),
  (DATE '2026-09-15', 990.30, 0.00),
  (DATE '2026-09-16', 0.01, 1000.00),
  (DATE '2026-09-17', 328.10, 0.00),
  (DATE '2026-09-18', 30.00, 0.00),
  (DATE '2026-09-21', 45.00, 0.00),
  (DATE '2026-09-22', 28.00, 0.00),
  (DATE '2026-09-24', 15.00, 0.00),
  (DATE '2026-09-25', 38.40, 0.00),
  (DATE '2026-09-29', 176.51, 0.00),
  (DATE '2026-10-01', 57.60, 0.00),
  (DATE '2026-10-06', 30.60, 0.00),
  (DATE '2026-10-08', 0.11, 1000.00),
  (DATE '2026-10-09', 1880.00, 0.00),
  (DATE '2026-10-13', 155.20, 1982.87),
  (DATE '2026-10-14', 372.50, 76.99),
  (DATE '2026-10-15', 0.00, 248.23),
  (DATE '2026-10-19', 0.01, 568.86),
  (DATE '2026-10-21', 0.10, 0.00),
  (DATE '2026-10-22', 438.80, 131.03),
  (DATE '2026-10-23', 32.64, 256.38),
  (DATE '2026-10-26', 0.01, 16.62),
  (DATE '2026-10-27', 1068.75, 300.00),
  (DATE '2026-10-28', 1131.25, 300.00),
  (DATE '2026-10-29', 210.01, 1401.00),
  (DATE '2026-11-03', 91.30, 0.00),
  (DATE '2026-11-04', 3378.00, 414.79),
  (DATE '2026-11-05', 0.01, 870.70),
  (DATE '2026-11-06', 1325.40, 100.00),
  (DATE '2026-11-09', 375.02, 2777.50),
  (DATE '2026-11-10', 233.46, 749.80),
  (DATE '2026-11-11', 39.64, 0.00),
  (DATE '2026-11-12', 379.80, 0.00),
  (DATE '2026-11-13', 208.87, 70.00),
  (DATE '2026-11-16', 324.74, 1469.55)
  ), sistema AS (
    SELECT data, sum(valor) FILTER (WHERE tipo = 'credito') AS creditos,
           sum(valor) FILTER (WHERE tipo = 'debito') AS debitos
      FROM public.banco_transacoes WHERE conta_id = v_itau GROUP BY data
  )
  SELECT count(*) INTO v_dias_errados
    FROM banco b FULL JOIN sistema s USING (data)
   WHERE coalesce(b.creditos, 0) <> coalesce(s.creditos, 0) OR coalesce(b.debitos, 0) <> coalesce(s.debitos, 0);
  IF v_dias_errados <> 0 THEN
    RAISE EXCEPTION '% dia(s) não batem crédito e débito com o arquivo do banco.', v_dias_errados;
  END IF;

  SELECT count(*) INTO v_restos FROM public.banco_transacoes
   WHERE conta_id = v_itau AND descricao ~* '^\s*(saldo|sdo)(\s|$)';
  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'Sobrou % linha(s) de saldo no extrato do Itaú.', v_restos;
  END IF;

  -- Toda linha do extrato tem o espelho no caixa com mesmo dia, valor e sentido.
  SELECT count(*) INTO v_sem_espelho
    FROM public.banco_transacoes t
    LEFT JOIN public.caixa_movimentos m ON m.id = t.caixa_movimento_id
   WHERE t.conta_id = v_itau
     AND (m.id IS NULL OR m.data <> t.data OR m.valor <> t.valor
          OR m.tipo <> CASE t.tipo WHEN 'credito' THEN 'entrada' ELSE 'saida' END);
  SELECT count(*) INTO v_orfaos
    FROM public.caixa_movimentos m
   WHERE m.origem = 'extrato'
     AND NOT EXISTS (SELECT 1 FROM public.banco_transacoes t WHERE t.caixa_movimento_id = m.id);
  IF v_sem_espelho <> 0 OR v_orfaos <> 0 THEN
    RAISE EXCEPTION 'Extrato e caixa desencontrados: % sem espelho, % espelho(s) sem extrato.', v_sem_espelho, v_orfaos;
  END IF;

  -- Os 9 Pix ligados a pagamentos continuam ligados, mais os 4 de novembro; cada pagamento uma vez só.
  SELECT count(*) INTO v_pix
    FROM public.banco_transacoes t JOIN public.caixa_movimentos m ON m.id = t.caixa_movimento_id
   WHERE t.conta_id = v_itau AND m.pagamento_id IS NOT NULL;
  IF v_pix <> 13
     OR NOT EXISTS (SELECT 1 FROM public.caixa_movimentos WHERE id = '70ae837e-f896-429b-803c-a92d8acc281c'
                       AND pagamento_id = 'f6241d64-585e-442c-bc34-aa1f3891ddb8')
     OR NOT EXISTS (SELECT 1 FROM public.caixa_movimentos WHERE id = '8febfe3d-7bff-4270-97d3-4d3764ad61d4'
                       AND pagamento_id = '9a691788-b5f8-45a0-b699-b377c5c3c0e2')
     OR EXISTS (SELECT pagamento_id FROM public.caixa_movimentos WHERE pagamento_id IS NOT NULL
                 GROUP BY pagamento_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Os Pix ligados a pagamentos mudaram (% no Itaú).', v_pix;
  END IF;

  -- O C6 não foi tocado.
  IF EXISTS (SELECT 1 FROM public.banco_transacoes WHERE conta_id <> v_itau)
     OR NOT EXISTS (SELECT 1 FROM public.contas_bancarias
                     WHERE id <> v_itau AND saldo_inicial = 0 AND saldo_inicial_data = DATE '2026-09-09'
                       AND extrato_conferido_ate IS NULL)
     OR (SELECT count(*) FROM public.contas_bancarias) <> 2 THEN
    RAISE EXCEPTION 'O C6 mudou: esta correção é só do Itaú.';
  END IF;

  SELECT jsonb_object_agg(acao || ':' || tabela, n) INTO v_copias
    FROM (SELECT acao, tabela, count(*) AS n FROM public.correcoes_de_extrato GROUP BY 1, 2) x;
  IF v_copias IS DISTINCT FROM '{"apagada:banco_transacoes": 37, "apagada:caixa_movimentos": 37,
                                 "alterada:caixa_movimentos": 5, "alterada:contas_bancarias": 1,
                                 "inserida:banco_transacoes": 41, "inserida:caixa_movimentos": 40}'::jsonb THEN
    RAISE EXCEPTION 'A cópia de segurança não tem tudo: %', v_copias;
  END IF;

  IF has_function_privilege('anon', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE')
     OR has_table_privilege('anon', 'public.correcoes_de_extrato', 'SELECT')
     OR has_table_privilege('authenticated', 'public.correcoes_de_extrato', 'INSERT')
     OR has_table_privilege('authenticated', 'public.correcoes_de_extrato', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.correcoes_de_extrato', 'DELETE') THEN
    RAISE EXCEPTION 'Permissão fora do esperado em importar_extrato ou correcoes_de_extrato.';
  END IF;
END $confere$;

-- ===================== o que a pessoa vê ===============================================================
SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((SELECT saldo_atual FROM saldo_contas_bancarias() WHERE conta_id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2') = 385.82,
                      'card Saldo em conta: Itaú R$ 385,82');
SELECT pg_temp.espera((SELECT sum(saldo_atual) FROM saldo_contas_bancarias()) = 385.82
                      AND (SELECT count(*) FROM saldo_contas_bancarias()) = 2,
                      'card Saldo em conta somando as duas contas: R$ 385,82 (C6 sem lançamento, R$ 0,00)');
SELECT pg_temp.espera((SELECT sum(saldo_atual) FROM vw_saldo_conta) = 385.82, 'tela Contas bancárias: R$ 385,82');
SELECT pg_temp.espera((SELECT max(ultimo_lancamento) FROM saldo_contas_bancarias()) = DATE '2026-11-16', 'último lançamento 16/11/2026');
SELECT pg_temp.espera((SELECT count(*) FROM correcoes_de_extrato) = 161, 'admin lê a cópia de segurança (161 linhas)');
RESET ROLE;
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((SELECT count(*) FROM correcoes_de_extrato) = 0, 'financeiro não lê a cópia de segurança');
SELECT pg_temp.espera((SELECT sum(saldo_atual) FROM saldo_contas_bancarias()) = 385.82, 'financeiro vê R$ 385,82');
RESET ROLE;
SELECT pg_temp.como(pg_temp.g('vend'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((SELECT count(*) FROM saldo_contas_bancarias()) = 0, 'vendedor não vê saldo');
RESET ROLE;

-- ===================== reimportar o MESMO arquivo, como a tela de hoje manda (saldo incluído) ==========
SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
SELECT set_config('ensaio.reimporta', importar_extrato('d91b5d74-e754-48aa-8444-2f30ceb86eb2', '[{"data": "2026-09-08", "descricao": "PIX TRANSF MAX WIL08/09", "valor": 148.0, "tipo": "credito", "documento": null, "fitid": "20260908001"}, {"data": "2026-09-08", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 148.0, "tipo": "credito", "documento": null, "fitid": "20260908002"}, {"data": "2026-09-09", "descricao": "PIX TRANSF RENAN D09/09", "valor": 35.0, "tipo": "credito", "documento": null, "fitid": "20260909001"}, {"data": "2026-09-09", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 183.0, "tipo": "credito", "documento": null, "fitid": "20260909002"}, {"data": "2026-09-10", "descricao": "PIX TRANSF MAX WIL10/09", "valor": 482.0, "tipo": "credito", "documento": null, "fitid": "20260910001"}, {"data": "2026-09-10", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 665.0, "tipo": "credito", "documento": null, "fitid": "20260910002"}, {"data": "2026-09-11", "descricao": "PIX TRANSF DENIS M11/09", "valor": 70.0, "tipo": "credito", "documento": null, "fitid": "20260911001"}, {"data": "2026-09-11", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 735.0, "tipo": "credito", "documento": null, "fitid": "20260911002"}, {"data": "2026-09-15", "descricao": "REDE VISA DB0108719065", "valor": 990.3, "tipo": "credito", "documento": null, "fitid": "20260915001"}, {"data": "2026-09-15", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1725.3, "tipo": "credito", "documento": null, "fitid": "20260915002"}, {"data": "2026-09-16", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20260916001"}, {"data": "2026-09-16", "descricao": "PIX ENVIADO YVENS FRANCI", "valor": 1000.0, "tipo": "debito", "documento": null, "fitid": "20260916002"}, {"data": "2026-09-16", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 725.31, "tipo": "credito", "documento": null, "fitid": "20260916003"}, {"data": "2026-09-17", "descricao": "PIX TRANSF LEONARD17/09", "valor": 328.1, "tipo": "credito", "documento": null, "fitid": "20260917001"}, {"data": "2026-09-17", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1053.41, "tipo": "credito", "documento": null, "fitid": "20260917002"}, {"data": "2026-09-18", "descricao": "PIX TRANSF SILSIE 18/09", "valor": 30.0, "tipo": "credito", "documento": null, "fitid": "20260918001"}, {"data": "2026-09-18", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1083.41, "tipo": "credito", "documento": null, "fitid": "20260918002"}, {"data": "2026-09-21", "descricao": "PIX TRANSF GRAFICA21/09", "valor": 45.0, "tipo": "credito", "documento": null, "fitid": "20260921001"}, {"data": "2026-09-21", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1128.41, "tipo": "credito", "documento": null, "fitid": "20260921002"}, {"data": "2026-09-22", "descricao": "PIX TRANSF MAX WIL22/09", "valor": 28.0, "tipo": "credito", "documento": null, "fitid": "20260922001"}, {"data": "2026-09-22", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1156.41, "tipo": "credito", "documento": null, "fitid": "20260922002"}, {"data": "2026-09-24", "descricao": "PIX TRANSF GRAFICA24/09", "valor": 15.0, "tipo": "credito", "documento": null, "fitid": "20260924001"}, {"data": "2026-09-24", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1171.41, "tipo": "credito", "documento": null, "fitid": "20260924002"}, {"data": "2026-09-25", "descricao": "PIX TRANSF MAX WIL25/09", "valor": 38.4, "tipo": "credito", "documento": null, "fitid": "20260925001"}, {"data": "2026-09-25", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1209.81, "tipo": "credito", "documento": null, "fitid": "20260925002"}, {"data": "2026-09-29", "descricao": "PIX TRANSF", "valor": 176.51, "tipo": "credito", "documento": null, "fitid": "20260929001"}, {"data": "2026-09-29", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1386.32, "tipo": "credito", "documento": null, "fitid": "20260929002"}, {"data": "2026-10-01", "descricao": "PIX TRANSF MAX WIL01/10", "valor": 57.6, "tipo": "credito", "documento": null, "fitid": "20261001001"}, {"data": "2026-10-01", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1443.92, "tipo": "credito", "documento": null, "fitid": "20261001002"}, {"data": "2026-10-06", "descricao": "PIX TRANSF MAX WIL06/10", "valor": 30.6, "tipo": "credito", "documento": null, "fitid": "20261006001"}, {"data": "2026-10-06", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1474.52, "tipo": "credito", "documento": null, "fitid": "20261006002"}, {"data": "2026-10-08", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.11, "tipo": "credito", "documento": null, "fitid": "20261008001"}, {"data": "2026-10-08", "descricao": "PIX ENVIADO NORTE CONSTR", "valor": 1000.0, "tipo": "debito", "documento": null, "fitid": "20261008002"}, {"data": "2026-10-08", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 474.63, "tipo": "credito", "documento": null, "fitid": "20261008003"}, {"data": "2026-10-09", "descricao": "PIX TRANSF", "valor": 1880.0, "tipo": "credito", "documento": null, "fitid": "20261009001"}, {"data": "2026-10-09", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 2354.63, "tipo": "credito", "documento": null, "fitid": "20261009002"}, {"data": "2026-10-13", "descricao": "SISPAG PIX QR-CODE", "valor": 1282.87, "tipo": "debito", "documento": null, "fitid": "20261013001"}, {"data": "2026-10-13", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261013002"}, {"data": "2026-10-13", "descricao": "PIX TRANSF", "valor": 155.19, "tipo": "credito", "documento": null, "fitid": "20261013003"}, {"data": "2026-10-13", "descricao": "PIX ENVIADO HERMERSON HA", "valor": 700.0, "tipo": "debito", "documento": null, "fitid": "20261013004"}, {"data": "2026-10-13", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 526.96, "tipo": "credito", "documento": null, "fitid": "20261013005"}, {"data": "2026-10-14", "descricao": "PIX TRANSF AMAPUER14/10", "valor": 372.5, "tipo": "credito", "documento": null, "fitid": "20261014001"}, {"data": "2026-10-14", "descricao": "PIX ENVIADO JOSUE SILVA", "valor": 76.99, "tipo": "debito", "documento": null, "fitid": "20261014002"}, {"data": "2026-10-14", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 822.47, "tipo": "credito", "documento": null, "fitid": "20261014003"}, {"data": "2026-10-15", "descricao": "SISPAG PIX QR-CODE", "valor": 248.23, "tipo": "debito", "documento": null, "fitid": "20261015001"}, {"data": "2026-10-15", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 574.24, "tipo": "credito", "documento": null, "fitid": "20261015002"}, {"data": "2026-10-19", "descricao": "SISPAG PIX QR-CODE", "valor": 80.21, "tipo": "debito", "documento": null, "fitid": "20261019001"}, {"data": "2026-10-19", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261019002"}, {"data": "2026-10-19", "descricao": "PIX ENVIADO", "valor": 488.65, "tipo": "debito", "documento": null, "fitid": "20261019003"}, {"data": "2026-10-19", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 5.39, "tipo": "credito", "documento": null, "fitid": "20261019004"}, {"data": "2026-10-21", "descricao": "REDE MAST DB0108719065", "valor": 0.1, "tipo": "credito", "documento": null, "fitid": "20261021001"}, {"data": "2026-10-21", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 5.49, "tipo": "credito", "documento": null, "fitid": "20261021002"}, {"data": "2026-10-22", "descricao": "SISDEB REDECARD S A", "valor": 31.03, "tipo": "debito", "documento": null, "fitid": "20261022001"}, {"data": "2026-10-22", "descricao": "PIX TRANSF", "valor": 438.8, "tipo": "credito", "documento": null, "fitid": "20261022002"}, {"data": "2026-10-22", "descricao": "PIX ENVIADO ADRIEL BASTO", "valor": 100.0, "tipo": "debito", "documento": null, "fitid": "20261022003"}, {"data": "2026-10-22", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 313.26, "tipo": "credito", "documento": null, "fitid": "20261022004"}, {"data": "2026-10-23", "descricao": "SISPAG PIX QR-CODE", "valor": 122.38, "tipo": "debito", "documento": null, "fitid": "20261023001"}, {"data": "2026-10-23", "descricao": "PIX TRANSF ALAN PA23/10", "valor": 32.64, "tipo": "credito", "documento": null, "fitid": "20261023002"}, {"data": "2026-10-23", "descricao": "PIX ENVIADO", "valor": 134.0, "tipo": "debito", "documento": null, "fitid": "20261023003"}, {"data": "2026-10-23", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 89.52, "tipo": "credito", "documento": null, "fitid": "20261023004"}, {"data": "2026-10-26", "descricao": "SISPAG PIX QR-CODE", "valor": 16.62, "tipo": "debito", "documento": null, "fitid": "20261026001"}, {"data": "2026-10-26", "descricao": "PIX QRS RAYMISON DO26/10", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261026002"}, {"data": "2026-10-26", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 72.91, "tipo": "credito", "documento": null, "fitid": "20261026003"}, {"data": "2026-10-27", "descricao": "PIX QRS MARCELA PAC27/10", "valor": 18.75, "tipo": "credito", "documento": null, "fitid": "20261027001"}, {"data": "2026-10-27", "descricao": "PIX TRANSF DISTRIB27/10", "valor": 1050.0, "tipo": "credito", "documento": null, "fitid": "20261027002"}, {"data": "2026-10-27", "descricao": "PIX ENVIADO THAYS VIEIRA", "valor": 300.0, "tipo": "debito", "documento": null, "fitid": "20261027003"}, {"data": "2026-10-27", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 841.66, "tipo": "credito", "documento": null, "fitid": "20261027004"}, {"data": "2026-10-28", "descricao": "SISPAG PIX QR-CODE", "valor": 300.0, "tipo": "debito", "documento": null, "fitid": "20261028001"}, {"data": "2026-10-28", "descricao": "PIX QRS RAIZES CONS28/10", "valor": 1112.5, "tipo": "credito", "documento": null, "fitid": "20261028002"}, {"data": "2026-10-28", "descricao": "PIX TRANSF MARCELA28/10", "valor": 18.75, "tipo": "credito", "documento": null, "fitid": "20261028003"}, {"data": "2026-10-28", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1672.91, "tipo": "credito", "documento": null, "fitid": "20261028004"}, {"data": "2026-10-29", "descricao": "SISPAG PIX QR-CODE", "valor": 634.0, "tipo": "debito", "documento": null, "fitid": "20261029001"}, {"data": "2026-10-29", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261029002"}, {"data": "2026-10-29", "descricao": "PIX QRS", "valor": 210.0, "tipo": "credito", "documento": null, "fitid": "20261029003"}, {"data": "2026-10-29", "descricao": "PIX ENVIADO", "valor": 767.0, "tipo": "debito", "documento": null, "fitid": "20261029004"}, {"data": "2026-10-29", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 481.92, "tipo": "credito", "documento": null, "fitid": "20261029005"}, {"data": "2026-11-03", "descricao": "REDE ELO DB0108719065", "valor": 21.2, "tipo": "credito", "documento": null, "fitid": "20261103001"}, {"data": "2026-11-03", "descricao": "PIX QRS", "valor": 70.1, "tipo": "credito", "documento": null, "fitid": "20261103002"}, {"data": "2026-11-03", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 573.22, "tipo": "credito", "documento": null, "fitid": "20261103003"}, {"data": "2026-11-04", "descricao": "SISPAG PIX QR-CODE", "valor": 396.91, "tipo": "debito", "documento": null, "fitid": "20261104001"}, {"data": "2026-11-04", "descricao": "PIX QRS CLEITON COU04/11", "valor": 60.0, "tipo": "credito", "documento": null, "fitid": "20261104002"}, {"data": "2026-11-04", "descricao": "PIX TRANSF DISTRIB04/11", "valor": 3318.0, "tipo": "credito", "documento": null, "fitid": "20261104003"}, {"data": "2026-11-04", "descricao": "TAR PIX QR LIQ ESTATICO", "valor": 17.88, "tipo": "debito", "documento": null, "fitid": "20261104004"}, {"data": "2026-11-04", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 3536.43, "tipo": "credito", "documento": null, "fitid": "20261104005"}, {"data": "2026-11-05", "descricao": "SISPAG PIX QR-CODE", "valor": 370.7, "tipo": "debito", "documento": null, "fitid": "20261105001"}, {"data": "2026-11-05", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261105002"}, {"data": "2026-11-05", "descricao": "PIX ENVIADO CIBELE LARIS", "valor": 500.0, "tipo": "debito", "documento": null, "fitid": "20261105003"}, {"data": "2026-11-05", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 2665.74, "tipo": "credito", "documento": null, "fitid": "20261105004"}, {"data": "2026-11-06", "descricao": "PIX QRS", "valor": 1239.17, "tipo": "credito", "documento": null, "fitid": "20261106001"}, {"data": "2026-11-06", "descricao": "DEV PIX MERCADO PAG06/11", "valor": 86.23, "tipo": "credito", "documento": null, "fitid": "20261106002"}, {"data": "2026-11-06", "descricao": "PIX ENVIADO FERNANDO AUG", "valor": 100.0, "tipo": "debito", "documento": null, "fitid": "20261106003"}, {"data": "2026-11-06", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 3891.14, "tipo": "credito", "documento": null, "fitid": "20261106004"}, {"data": "2026-11-09", "descricao": "SISPAG PIX QR-CODE", "valor": 177.5, "tipo": "debito", "documento": null, "fitid": "20261109001"}, {"data": "2026-11-09", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.02, "tipo": "credito", "documento": null, "fitid": "20261109002"}, {"data": "2026-11-09", "descricao": "PIX QRS CAROLINE FE07/11", "valor": 375.0, "tipo": "credito", "documento": null, "fitid": "20261109003"}, {"data": "2026-11-09", "descricao": "PIX ENVIADO", "valor": 2600.0, "tipo": "debito", "documento": null, "fitid": "20261109004"}, {"data": "2026-11-09", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1488.66, "tipo": "credito", "documento": null, "fitid": "20261109005"}, {"data": "2026-11-10", "descricao": "SISPAG PIX QR-CODE", "valor": 100.0, "tipo": "debito", "documento": null, "fitid": "20261110001"}, {"data": "2026-11-10", "descricao": "REDE MAST DB0108719065", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261110002"}, {"data": "2026-11-10", "descricao": "REND PAGO APLIC AUT MAIS", "valor": 0.01, "tipo": "credito", "documento": null, "fitid": "20261110003"}, {"data": "2026-11-10", "descricao": "PIX QRS", "valor": 233.44, "tipo": "credito", "documento": null, "fitid": "20261110004"}, {"data": "2026-11-10", "descricao": "PIX ENVIADO", "valor": 649.8, "tipo": "debito", "documento": null, "fitid": "20261110005"}, {"data": "2026-11-10", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 972.32, "tipo": "credito", "documento": null, "fitid": "20261110006"}, {"data": "2026-11-11", "descricao": "REDE MAST AT0108719065", "valor": 28.09, "tipo": "credito", "documento": null, "fitid": "20261111001"}, {"data": "2026-11-11", "descricao": "PIX QRS AMAURI RAMO11/11", "valor": 11.55, "tipo": "credito", "documento": null, "fitid": "20261111002"}, {"data": "2026-11-11", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1011.96, "tipo": "credito", "documento": null, "fitid": "20261111003"}, {"data": "2026-11-12", "descricao": "PIX QRS", "valor": 249.8, "tipo": "credito", "documento": null, "fitid": "20261112001"}, {"data": "2026-11-12", "descricao": "PIX TRANSF ALICIA 12/11", "valor": 130.0, "tipo": "credito", "documento": null, "fitid": "20261112002"}, {"data": "2026-11-12", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1391.76, "tipo": "credito", "documento": null, "fitid": "20261112003"}, {"data": "2026-11-13", "descricao": "SISPAG PIX QR-CODE", "valor": 70.0, "tipo": "debito", "documento": null, "fitid": "20261113001"}, {"data": "2026-11-13", "descricao": "PIX QRS CAROLINE FE13/11", "valor": 208.87, "tipo": "credito", "documento": null, "fitid": "20261113002"}, {"data": "2026-11-13", "descricao": "SALDO TOTAL DISPONÍVEL DIA", "valor": 1530.63, "tipo": "credito", "documento": null, "fitid": "20261113003"}, {"data": "2026-11-16", "descricao": "SISPAG PIX QR-CODE", "valor": 731.46, "tipo": "debito", "documento": null, "fitid": "20261116001"}, {"data": "2026-11-16", "descricao": "PIX QRS", "valor": 87.8, "tipo": "credito", "documento": null, "fitid": "20261116002"}, {"data": "2026-11-16", "descricao": "PIX TRANSF", "valor": 236.94, "tipo": "credito", "documento": null, "fitid": "20261116003"}, {"data": "2026-11-16", "descricao": "PIX ENVIADO", "valor": 738.09, "tipo": "debito", "documento": null, "fitid": "20261116004"}]'::jsonb)::text, true);
RESET ROLE;
SELECT pg_temp.anota('        reimportação: ' || pg_temp.g('reimporta'));
SELECT pg_temp.espera((pg_temp.g('reimporta')::jsonb->>'importadas')::int = 0
                      AND (pg_temp.g('reimporta')::jsonb->>'saldos_ignorados')::int = 37
                      AND (pg_temp.g('reimporta')::jsonb->>'ja_conferidas')::int = 79
                      AND (pg_temp.g('reimporta')::jsonb->>'saldo_atual')::numeric = 385.82,
                      'reimportar o OFX inteiro: 0 importadas, 37 saldos e 79 já conferidas ignoradas, saldo igual');
-- Depois do período conferido: lançamento entra, linha de saldo não.
SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
SELECT set_config('ensaio.novo', importar_extrato('d91b5d74-e754-48aa-8444-2f30ceb86eb2',
  '[{"data":"2026-11-17","descricao":"PIX ENSAIO","valor":10,"tipo":"credito","fitid":"ENSAIO-1"},
    {"data":"2026-11-17","descricao":"SALDO TOTAL DISPONÍVEL DIA","valor":395.82,"tipo":"credito","fitid":"ENSAIO-2"},
    {"data":"2026-11-17","descricao":"  sdo cta/apl automaticas","valor":395.82,"tipo":"credito"}]'::jsonb)::text, true);
SELECT pg_temp.espera((pg_temp.g('novo')::jsonb->>'importadas')::int = 1
                      AND (pg_temp.g('novo')::jsonb->>'saldos_ignorados')::int = 2
                      AND (SELECT sum(saldo_atual) FROM saldo_contas_bancarias()) = 395.82,
                      'depois de 16/11: o Pix entra (R$ 395,82), as 2 linhas de saldo não');
RESET ROLE;
-- A regra de quem importa não muda (pagamentos.confirm, como antes): quem não tem a chave não importa.
SELECT pg_temp.como(pg_temp.g('sem_chave'));
SET LOCAL ROLE authenticated;
DO $v$
BEGIN
  PERFORM importar_extrato('d91b5d74-e754-48aa-8444-2f30ceb86eb2', '[]'::jsonb);
  PERFORM pg_temp.anota('FALHOU  quem não tem pagamentos.confirm importou extrato');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.anota('OK      quem não tem pagamentos.confirm não importa extrato (' || SQLERRM || ')');
END $v$;
RESET ROLE;
SELECT pg_temp.espera(NOT has_function_privilege('anon', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE'),
                      'anon não executa importar_extrato');

-- ===================== nada fora do extrato do Itaú mudou =============================================
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar x) = pg_temp.g('fp_contas_pagar'), 'contas_pagar: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar_anexos x) = pg_temp.g('fp_contas_pagar_anexos'), 'contas_pagar_anexos: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.contas_pagar_historico x) = pg_temp.g('fp_contas_pagar_historico'), 'contas_pagar_historico: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.pagamentos x) = pg_temp.g('fp_pagamentos'), 'pagamentos: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.reembolsos x) = pg_temp.g('fp_reembolsos'), 'reembolsos: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.compromissos_financeiros x) = pg_temp.g('fp_compromissos_financeiros'), 'compromissos_financeiros: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.faturas_consumo x) = pg_temp.g('fp_faturas_consumo'), 'faturas_consumo: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(x)::text, ',' ORDER BY to_jsonb(x)::text), '')) FROM public.unidades_consumo x) = pg_temp.g('fp_unidades_consumo'), 'unidades_consumo: nada mudou');
SELECT pg_temp.espera((SELECT md5(coalesce(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id), '')) FROM public.caixa_movimentos m WHERE m.origem <> 'extrato') = pg_temp.g('fp_caixa_fora'), 'caixa fora do extrato (contas pagas, manuais): nada mudou');
SELECT pg_temp.anota('        logs_auditoria novos: ' || ((SELECT count(*) FROM logs_auditoria) - pg_temp.g('logs')::int));
SELECT pg_temp.como(pg_temp.g('admin'));
SELECT pg_temp.espera(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(conciliar_extrato_com_pagamentos(false)->'pares') p
                                   WHERE (p->>'data_extrato')::date <= DATE '2026-11-16'),
                      'nenhum Pix do extrato até 16/11 ficou com par pendente');
SELECT pg_temp.espera((SELECT count(*) FROM caixa_movimentos m JOIN banco_transacoes t ON t.caixa_movimento_id = m.id
                        WHERE m.pagamento_id IN ('5e7be048-ef93-42dd-baf9-56d327472f5a', '6536c2db-5203-4367-af92-b91a2246bc17',
                                                 'a016001e-fc0f-4d5c-b417-fdaf76d5e0e9', '5df4fa12-1822-4d01-9133-03227f9f7249')) = 4,
                      'os 4 Pix de novembro (Caroline 375,00 e 208,87, Alicia 130,00, Amauri 11,55) ligados aos pagamentos');
DO $fim$
DECLARE r text := current_setting('ensaio.r');
BEGIN
  IF r LIKE '%FALHOU%' THEN
    RAISE EXCEPTION 'ENSAIO EXTRATO FALHOU (nada gravado):%', r;
  END IF;
  RAISE EXCEPTION 'ENSAIO EXTRATO OK (nada gravado):%', r;
END $fim$;
