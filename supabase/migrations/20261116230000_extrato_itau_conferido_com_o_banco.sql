-- =====================================================================================================
-- EXTRATO DO ITAÚ CONFERIDO COM O ARQUIVO DO BANCO: SALDO REAL (16/11/2026)
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada: md5(prosrc) de importar_extrato(uuid, jsonb) = 6f2880eddae8a07775fa9680162f92b9;
-- EXECUTE só para postgres, authenticated e service_role (anon não). Itaú: 95 lançamentos, saldo inicial
-- R$ 0,00 em 17/08/2026, extrato conferido até 16/11/2026, R$ 385,82 no card e na tela Contas bancárias,
-- nenhuma linha de saldo. correcoes_de_extrato com 161 linhas (37 + 37 apagadas, 5 + 1 alteradas, 41 + 40
-- inseridas), lida só pelo admin. C6 intacto (nenhum lançamento, saldo inicial R$ 0,00 em 09/09).
-- Ensaios no banco vivo, desfeitos: docs/ensaio-extrato-itau-conferido.sql, 22 de 22 OK (contas a pagar,
-- anexos, histórico, pagamentos, reembolsos, compromissos e consumo com a mesma impressão digital antes e
-- depois). Depois de aplicada, reimportar o OFX inteiro como a tela de hoje manda (116 linhas, as de saldo
-- junto): 0 importadas, 37 saldos e 79 já conferidas ignoradas, saldo igual.
--
-- O QUE ESTAVA ERRADO (medido no banco vivo em 16/11/2026, contra o OFX do Itaú, conta 1561988369, de
-- 17/08 a 16/11/2026, saldo final do banco R$ 385,83)
--   O card "Saldo em conta" mostrava R$ 28.009,06, todo ele do Itaú (o C6 não tem nenhum lançamento).
--   1. 27 linhas "SALDO TOTAL DISPONÍVEL DIA" (08/09 a 28/10) entraram como CRÉDITO: o arquivo de 28/10
--      trazia o saldo de cada dia como se fosse um lançamento, e o leitor do extrato aceitou. R$ 23.043,30
--      de dinheiro que não entrou (e as mesmas 27 linhas como entrada no caixa).
--   2. 10 créditos repetidos (mesmo dia, valor e descrição; o banco tem um só): R$ 543,03.
--   3. Faltavam 9 débitos (dois deles só em parte) e 1 crédito até 29/10, e todo o extrato depois de 29/10.
--   4. Saldo inicial R$ 225,00 em 10/09; pelo banco, o saldo no fim de 09/09 era R$ 183,00. O banco abre
--      o arquivo com R$ 0,00 em 17/08 e o primeiro lançamento é de 08/09.
--   Ponte: 28.009,06 − 22.712,30 (as 25 linhas de saldo de 10/09 em diante; as 2 de antes já ficavam de
--   fora pela data de corte) − 543,03 (repetidos) − 42,00 (saldo inicial 225 contra 183) − 4.229,82
--   (débitos que faltavam até 29/10) + 0,01 (crédito que faltava) = 481,92, o saldo do banco em 29/10;
--   − 96,10 (novembro) = R$ 385,82.
--
-- POR QUE R$ 385,82 E NÃO 385,83
--   Os 79 lançamentos do arquivo somam R$ 385,82 a partir do R$ 0,00 de 17/08; o próprio banco diz
--   385,83 no fim. O centavo não está em linha nenhuma do arquivo. Esta migração não inventa o centavo:
--   o sistema mostra o que as linhas somam. Se o extrato do app do banco mostrar a linha, ela entra.
--
-- O QUE ESTA MIGRAÇÃO FAZ (só na conta do Itaú; o C6 não é tocado)
--   1. correcoes_de_extrato: cópia de cada linha apagada, alterada ou inserida (antes e depois, em jsonb).
--      Desfazer é reinserir o "antes" e apagar o "depois". Lê só o admin; ninguém grava pela tela.
--   2. Apaga as 27 linhas de saldo e as 10 cópias repetidas, no extrato e no caixa (as 37 entradas do
--      caixa espelho, origem 'extrato'). Antes, o Pix da OS 212 (pagamento f6241d64, R$ 18,75 de 29/10)
--      que estava ligado à cópia de 28/10 passa para o Pix de R$ 18,75 de 27/10, que estava sem par.
--      Os 9 Pix ligados a pagamentos continuam 9.
--   3. Insere os 41 lançamentos que faltavam (8 inteiros e 2 restos até 29/10, mais 31 de novembro), cada
--      um com o espelho no caixa, como a importação faz. A saída de R$ 731,46 de 16/11 é a conta da CEA
--      paga pelo sistema: a linha do extrato liga na saída que já existe, sem criar outra.
--      O que o sistema já tinha em itens (o banco agrupa) fica como está: o total do dia bate.
--      Depois, a mesma conciliação que a tela roda a cada importação: 4 Pix de novembro (R$ 725,42) que
--      já estavam registrados como pagamento de OS ficam ligados ao extrato, senão o fluxo de caixa os
--      contaria duas vezes. Ficam 13 Pix ligados.
--   4. Itaú: saldo inicial R$ 0,00 em 17/08/2026 (o do arquivo) e extrato conferido até 16/11/2026.
--   5. contas_bancarias.extrato_conferido_ate (nova coluna): a importação passa a ignorar linha com data
--      até esse dia. Reimportar este mesmo arquivo, ou um que se sobreponha, não duplica mais nada
--      (pelo FITID não bastaria: o arquivo de 28/10 numerou diferente do banco).
--   6. importar_extrato ignora linha de saldo ("SALDO ...", "SDO ...") e devolve quantas ignorou.
--      O leitor da tela também passa a separar essas linhas (src/lib/extrato.ts).
--   O bloco CONFERE no fim recusa tudo (ROLLBACK) se o Itaú não fechar em R$ 385,82, se algum dia não
--   bater crédito e débito com o arquivo, se sobrar linha de saldo, se algum Pix perder o par ou se o C6
--   mudar.
--
-- O QUE ELA NÃO TOCA
--   Contas a pagar, compromissos, reembolsos, pagamentos, as 6 parcelas pagas sem origem, as 3 pagas sem
--   data e as saídas do caixa que não vieram do extrato.
-- =====================================================================================================
BEGIN;
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

COMMIT;

-- DESFAZER (só se precisar; a cópia está em correcoes_de_extrato, lote 'itau-ofx-2026-11-16'):
--   BEGIN;
--   DELETE FROM public.banco_transacoes WHERE id IN (SELECT registro_id FROM public.correcoes_de_extrato
--     WHERE lote = 'itau-ofx-2026-11-16' AND acao = 'inserida' AND tabela = 'banco_transacoes');
--   DELETE FROM public.caixa_movimentos WHERE id IN (SELECT registro_id FROM public.correcoes_de_extrato
--     WHERE lote = 'itau-ofx-2026-11-16' AND acao = 'inserida' AND tabela = 'caixa_movimentos');
--   INSERT INTO public.caixa_movimentos SELECT (jsonb_populate_record(NULL::public.caixa_movimentos, antes)).*
--     FROM public.correcoes_de_extrato WHERE lote = 'itau-ofx-2026-11-16' AND acao = 'apagada' AND tabela = 'caixa_movimentos';
--   INSERT INTO public.banco_transacoes SELECT (jsonb_populate_record(NULL::public.banco_transacoes, antes)).*
--     FROM public.correcoes_de_extrato WHERE lote = 'itau-ofx-2026-11-16' AND acao = 'apagada' AND tabela = 'banco_transacoes';
--   UPDATE public.caixa_movimentos SET pagamento_id = NULL WHERE id = '70ae837e-f896-429b-803c-a92d8acc281c';
--   UPDATE public.contas_bancarias SET saldo_inicial = 225, saldo_inicial_data = DATE '2026-09-10',
--     extrato_conferido_ate = NULL WHERE id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2';
--   (o Pix f6241d64 volta junto com o caixa 3968c7d8 reinserido; a função antiga está em
--    supabase/migrations/20260905012532_f91910da-d0ef-45d3-8415-c4173a9ebb2e.sql)
--   COMMIT;
