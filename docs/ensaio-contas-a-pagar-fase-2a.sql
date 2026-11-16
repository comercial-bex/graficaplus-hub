-- =====================================================================================================
-- ENSAIO DA FASE 2A DE CONTAS A PAGAR (16/11/2026) — roda no banco vivo e NÃO GRAVA NADA
--
-- Tudo acontece numa transação que termina em RAISE EXCEPTION: o resultado vem na mensagem do erro
-- ("ENSAIO 2A OK" ou "ENSAIO 2A FALHOU") e o banco volta ao que era. As contas usadas são criadas aqui
-- dentro ("ENSAIO 2A ..."); a única coisa real que se toca são as pessoas (escolhidas pelo papel) e, para
-- a parcela sintética, o id de um compromisso que já existe.
--
-- O que prova:
--   vendedor (confirm + create, sem financeiro.read): recusado em pagar, anexar arquivo, dar baixa em
--     parcela, quitar em lote e anexar comprovante de parcela; cada recusa vira tentativa_negada.
--   financeiro: recusado em estornar e remover anexo (com tentativa_negada); a trava segue recusando reabrir
--     pela API; pagar sem origem, dinheiro sem comprovante e conta + dinheiro são recusados; com conta
--     bancária e com dinheiro + comprovante, paga; comprovante de antes de um estorno não vale.
--   baixa de parcela: lançando no caixa exige origem; sem lançar, não.
--   gestor que também é vendedor e admin seguem podendo o que podiam.
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

-- Pessoas pelo papel, não pelo nome.
SELECT set_config('ensaio.admin', (SELECT ur.user_id::text FROM user_roles ur WHERE ur.role = 'admin' LIMIT 1), true),
       set_config('ensaio.fin', (SELECT ur.user_id::text FROM user_roles ur
                                  WHERE ur.role = 'financeiro' AND NOT has_role(ur.user_id, 'admin') LIMIT 1), true),
       set_config('ensaio.vend', (SELECT ur.user_id::text FROM user_roles ur
                                   WHERE ur.role = 'vendedor' AND NOT can_see_financials(ur.user_id)
                                     AND has_permission(ur.user_id, 'pagamentos.confirm') LIMIT 1), true),
       set_config('ensaio.gestor', (SELECT ur.user_id::text FROM user_roles ur
                                     WHERE ur.role = 'gestor' AND NOT has_role(ur.user_id, 'admin')
                                       AND can_see_financials(ur.user_id)
                                       AND has_permission(ur.user_id, 'pagamentos.confirm') LIMIT 1), true),
       set_config('ensaio.banco', (SELECT id::text FROM contas_bancarias WHERE ativo ORDER BY nome LIMIT 1), true),
       set_config('ensaio.compromisso', coalesce((SELECT compromisso_id::text FROM contas_pagar
                                                   WHERE compromisso_id IS NOT NULL LIMIT 1),
                                                  gen_random_uuid()::text), true);

-- Contas sintéticas (somem no fim).
WITH x AS (INSERT INTO contas_pagar (descricao, categoria, valor, vencimento)
           VALUES ('ENSAIO 2A aberta', 'geral', 10, hoje_br()) RETURNING id)
SELECT set_config('ensaio.aberta', (SELECT id::text FROM x), true);
WITH x AS (INSERT INTO contas_pagar (descricao, categoria, valor, vencimento)
           VALUES ('ENSAIO 2A paga', 'geral', 20, hoje_br()) RETURNING id)
SELECT set_config('ensaio.paga', (SELECT id::text FROM x), true);
WITH x AS (INSERT INTO contas_pagar (descricao, categoria, valor, vencimento, compromisso_id, parcela_numero)
           VALUES ('ENSAIO 2A parcela', 'geral', 30, hoje_br() - 1, pg_temp.g('compromisso')::uuid, 9901) RETURNING id)
SELECT set_config('ensaio.parcela', (SELECT id::text FROM x), true);
WITH x AS (INSERT INTO contas_pagar_anexos (conta_pagar_id, tipo, caminho, nome_arquivo, mime, tamanho_bytes)
           VALUES (pg_temp.g('paga')::uuid, 'comprovante', pg_temp.g('paga') || '/' || gen_random_uuid() || '.pdf',
                   'ensaio.pdf', 'application/pdf', 100) RETURNING id)
SELECT set_config('ensaio.anexo', (SELECT id::text FROM x), true);

SELECT pg_temp.espera(pg_temp.g('admin') <> '' AND pg_temp.g('fin') <> '' AND pg_temp.g('vend') <> ''
                      AND pg_temp.g('banco') <> '', 'achou admin, financeiro, vendedor e conta bancária');

-- O admin paga a conta "paga" pela função (com conta bancária), para o financeiro tentar estornar.
SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.espera((pagar_conta_pagar(pg_temp.g('paga')::uuid, hoje_br(), pg_temp.g('banco')::uuid, NULL)->>'negado') IS NULL,
                      'admin paga com conta bancária');
RESET ROLE;

-- -----------------------------------------------------------------------------------------------------
-- VENDEDOR
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp.como(pg_temp.g('vend'));
SET LOCAL ROLE authenticated;
DO $v$
DECLARE r jsonb;
BEGIN
  r := pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), pg_temp.g('banco')::uuid, NULL);
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'vendedor: pagar devolve negado');
  r := anexar_arquivo_conta_pagar(pg_temp.g('aberta')::uuid, 'comprovante', pg_temp.g('aberta') || '/x.pdf', 'x.pdf');
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'vendedor: anexar arquivo devolve negado');
  r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, NULL, true, pg_temp.g('banco')::uuid);
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'vendedor: dar baixa em parcela devolve negado');
  r := quitar_parcelas_ate(pg_temp.g('compromisso')::uuid, hoje_br());
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'vendedor: quitar em lote devolve negado');
  r := anexar_comprovante_parcela(pg_temp.g('parcela')::uuid, 'compromissos/x.pdf');
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'vendedor: anexar comprovante de parcela devolve negado');
END $v$;
RESET ROLE;

SELECT pg_temp.espera((SELECT count(*) FROM contas_pagar_historico WHERE conta_pagar_id = pg_temp.g('aberta')::uuid
                        AND evento = 'tentativa_negada') = 2, 'vendedor: 2 tentativas negadas na conta aberta');
SELECT pg_temp.espera((SELECT count(*) FROM contas_pagar_historico WHERE conta_pagar_id = pg_temp.g('parcela')::uuid
                        AND evento = 'tentativa_negada') = 3, 'vendedor: 3 tentativas negadas na parcela');
SELECT pg_temp.espera((SELECT usuario_id::text FROM contas_pagar_historico WHERE conta_pagar_id = pg_temp.g('aberta')::uuid
                        AND evento = 'tentativa_negada' LIMIT 1) = pg_temp.g('vend'), 'a tentativa guarda quem tentou');
SELECT pg_temp.espera((SELECT status::text FROM contas_pagar WHERE id = pg_temp.g('aberta')::uuid) = 'aberta'
                      AND (SELECT status::text FROM contas_pagar WHERE id = pg_temp.g('parcela')::uuid) = 'aberta'
                      AND (SELECT comprovante_url FROM contas_pagar WHERE id = pg_temp.g('parcela')::uuid) IS NULL
                      AND NOT EXISTS (SELECT 1 FROM caixa_movimentos WHERE conta_pagar_id IN (pg_temp.g('aberta')::uuid, pg_temp.g('parcela')::uuid)),
                      'vendedor: nada mudou nas contas nem no caixa');

-- -----------------------------------------------------------------------------------------------------
-- FINANCEIRO
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
DO $f$
DECLARE r jsonb; n int; c uuid; fp text;
BEGIN
  r := estornar_conta_pagar(pg_temp.g('paga')::uuid, 'ensaio de permissão');
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'financeiro: estornar devolve negado');
  r := remover_anexo_conta_pagar(pg_temp.g('anexo')::uuid, 'ensaio');
  PERFORM pg_temp.espera(r->>'negado' = 'true', 'financeiro: remover anexo devolve negado');

  BEGIN UPDATE contas_pagar SET status = 'aberta', data_pagamento = NULL WHERE id = pg_temp.g('paga')::uuid;
        PERFORM pg_temp.espera(false, 'financeiro: reabrir pela API foi aceito');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE '%só o administrador estorna%', 'financeiro: reabrir pela API segue recusado (trava)'); END;

  BEGIN PERFORM pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), NULL, NULL);
        PERFORM pg_temp.espera(false, 'financeiro: pagar sem origem foi aceito');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE 'Escolha de onde saiu o dinheiro%', 'financeiro: pagar sem origem é recusado'); END;

  BEGIN PERFORM pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), NULL, 'Dinheiro');
        PERFORM pg_temp.espera(false, 'financeiro: dinheiro sem comprovante foi aceito');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE '%exige o comprovante%', 'financeiro: dinheiro sem comprovante é recusado'); END;

  BEGIN PERFORM pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), pg_temp.g('banco')::uuid, 'dinheiro');
        PERFORM pg_temp.espera(false, 'financeiro: conta e dinheiro juntos foi aceito');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE '%não os dois%', 'financeiro: conta e dinheiro juntos é recusado'); END;

  BEGIN
    r := pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br() - 3, pg_temp.g('banco')::uuid, NULL);
    SELECT m.conta_id, m.data - hoje_br() INTO c, n FROM caixa_movimentos m WHERE m.conta_pagar_id = pg_temp.g('aberta')::uuid;
    RAISE EXCEPTION 'PAGO|%|%', c, n;
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'PAGO|' || pg_temp.g('banco') || '|-3', 'financeiro: paga com conta bancária, saída nessa conta e na data informada (' || SQLERRM || ')');
  END;

  BEGIN
    r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, NULL, true, NULL);
    PERFORM pg_temp.espera(false, 'financeiro: baixa lançando no caixa sem origem foi aceita');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE 'Escolha de onde saiu o dinheiro%', 'financeiro: baixa lançando no caixa sem origem é recusada'); END;

  BEGIN
    r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, 'Dinheiro', true, NULL);
    PERFORM pg_temp.espera(false, 'financeiro: baixa em dinheiro sem comprovante foi aceita');
  EXCEPTION WHEN others THEN PERFORM pg_temp.espera(SQLERRM LIKE '%exige o comprovante%', 'financeiro: baixa em dinheiro sem comprovante é recusada'); END;

  BEGIN
    r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, NULL, true, pg_temp.g('banco')::uuid);
    SELECT m.conta_id INTO c FROM caixa_movimentos m WHERE m.conta_pagar_id = pg_temp.g('parcela')::uuid;
    RAISE EXCEPTION 'BAIXA|%|%', c, r->>'lancado_no_caixa';
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'BAIXA|' || pg_temp.g('banco') || '|true', 'financeiro: baixa com conta lança a saída com a conta de origem (' || SQLERRM || ')');
  END;

  BEGIN
    r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, NULL, false, NULL);
    SELECT count(*) INTO n FROM caixa_movimentos m WHERE m.conta_pagar_id = pg_temp.g('parcela')::uuid;
    RAISE EXCEPTION 'SEMCAIXA|%|%', r->>'lancado_no_caixa', n;
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'SEMCAIXA|false|0', 'financeiro: baixa sem lançar no caixa não pede origem (' || SQLERRM || ')');
  END;
END $f$;
RESET ROLE;

SELECT pg_temp.espera((SELECT count(*) FROM contas_pagar_historico WHERE conta_pagar_id = pg_temp.g('paga')::uuid
                        AND evento = 'tentativa_negada') = 2, 'financeiro: 2 tentativas negadas na conta paga (estornar, remover)');
SELECT pg_temp.espera((SELECT status::text FROM contas_pagar WHERE id = pg_temp.g('paga')::uuid) = 'paga'
                      AND EXISTS (SELECT 1 FROM contas_pagar_anexos WHERE id = pg_temp.g('anexo')::uuid)
                      AND EXISTS (SELECT 1 FROM caixa_movimentos WHERE conta_pagar_id = pg_temp.g('paga')::uuid),
                      'financeiro: conta segue paga, com a saída e o anexo');

-- Dinheiro com comprovante anexado antes de pagar: paga, sem conta, forma Dinheiro.
INSERT INTO contas_pagar_anexos (conta_pagar_id, tipo, caminho, nome_arquivo, mime, tamanho_bytes)
VALUES (pg_temp.g('aberta')::uuid, 'comprovante', pg_temp.g('aberta') || '/' || gen_random_uuid() || '.jpg',
        'recibo.jpg', 'image/jpeg', 100);
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
DO $d$
DECLARE r jsonb; c text; fp text;
BEGIN
  r := pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), NULL, 'dinheiro');
  SELECT coalesce(m.conta_id::text, 'sem conta') INTO c FROM caixa_movimentos m WHERE m.conta_pagar_id = pg_temp.g('aberta')::uuid;
  SELECT forma_pagamento INTO fp FROM contas_pagar WHERE id = pg_temp.g('aberta')::uuid;
  RAISE EXCEPTION 'DINHEIRO|%|%', c, fp;
EXCEPTION WHEN others THEN
  PERFORM pg_temp.espera(SQLERRM = 'DINHEIRO|sem conta|Dinheiro', 'financeiro: dinheiro com comprovante paga, sem conta e forma Dinheiro (' || SQLERRM || ')');
END $d$;
RESET ROLE;

-- Comprovante enviado ANTES de um estorno não vale para pagar de novo em dinheiro.
UPDATE contas_pagar_anexos SET enviado_em = now() - interval '1 day' WHERE conta_pagar_id = pg_temp.g('aberta')::uuid;
INSERT INTO contas_pagar_historico (conta_pagar_id, evento, detalhes) VALUES (pg_temp.g('aberta')::uuid, 'estornada', '{}');
SELECT pg_temp.como(pg_temp.g('fin'));
SET LOCAL ROLE authenticated;
DO $e$
BEGIN
  PERFORM pagar_conta_pagar(pg_temp.g('aberta')::uuid, hoje_br(), NULL, 'Dinheiro');
  PERFORM pg_temp.espera(false, 'financeiro: comprovante de antes do estorno valeu');
EXCEPTION WHEN others THEN
  PERFORM pg_temp.espera(SQLERRM LIKE '%exige o comprovante%', 'financeiro: comprovante de antes do estorno não vale');
END $e$;
RESET ROLE;

-- -----------------------------------------------------------------------------------------------------
-- GESTOR (também vendedor) e ADMIN seguem podendo
-- -----------------------------------------------------------------------------------------------------
DO $g$
DECLARE r jsonb;
BEGIN
  IF pg_temp.g('gestor') = '' THEN
    PERFORM pg_temp.anota('--      sem gestor com financeiro e confirm: caso não testado');
    RETURN;
  END IF;
  PERFORM pg_temp.como(pg_temp.g('gestor'));
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    r := baixar_parcela_compromisso(pg_temp.g('parcela')::uuid, hoje_br(), NULL, NULL, true, pg_temp.g('banco')::uuid);
    RAISE EXCEPTION 'G|%', coalesce(r->>'negado', 'passou');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.espera(SQLERRM = 'G|passou', 'gestor + vendedor: segue dando baixa em parcela (' || SQLERRM || ')');
  END;
  EXECUTE 'RESET ROLE';
END $g$;

SELECT pg_temp.como(pg_temp.g('admin'));
SET LOCAL ROLE authenticated;
DO $a$
DECLARE r jsonb;
BEGIN
  r := estornar_conta_pagar(pg_temp.g('paga')::uuid, 'ensaio do admin');
  RAISE EXCEPTION 'A|%|%', coalesce(r->>'negado', 'passou'), r->>'movimentos_removidos';
EXCEPTION WHEN others THEN
  PERFORM pg_temp.espera(SQLERRM = 'A|passou|1', 'admin: segue estornando (' || SQLERRM || ')');
END $a$;
RESET ROLE;

-- -----------------------------------------------------------------------------------------------------
-- anon: nenhuma das funções.
-- -----------------------------------------------------------------------------------------------------
SELECT pg_temp.espera(NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon não executa nenhuma das 8 funções')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('_negar_conta_pagar', 'pagar_conta_pagar', 'estornar_conta_pagar',
   'remover_anexo_conta_pagar', 'anexar_arquivo_conta_pagar', 'anexar_comprovante_parcela',
   'baixar_parcela_compromisso', 'quitar_parcelas_ate');

DO $fim$
DECLARE r text := current_setting('ensaio.r');
BEGIN
  IF r LIKE '%FALHOU%' THEN
    RAISE EXCEPTION 'ENSAIO 2A FALHOU (nada gravado):%', r;
  END IF;
  RAISE EXCEPTION 'ENSAIO 2A OK (nada gravado):%', r;
END $fim$;
