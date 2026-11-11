-- APLICADA em 10/11/2026, em produção. Conferido antes: os 5 jobs com custo no retrato (eram 4 em 05/11; o quinto nasceu
-- em 06/11) tinham o custo guardado também em orcamento_3d_consumos, com o mesmo valor (custo por grama x gramas), e a
-- tabela não tem gatilho nenhum. Conferido depois: 5 jobs, 0 com custo no retrato, restrição válida, a função não grava
-- mais custo, e os 24 consumos com custo seguem lá.

-- Privacidade do custo, onda A2: o retrato de custo que cada job de impressão 3D carrega (10/11/2026).
--
-- POR QUÊ
--   producao_3d_jobs lê-se com impressao3d.read (vendedor e operador). Cada job guardava em custo_previsto_snapshot o custo
--   do material (custo_material e, por material, custo_por_grama). Ninguém lê essas chaves: nenhuma tela, nenhuma view e nenhuma
--   função além de quem as grava (criar_jobs_3d_da_os). A baixa de filamento usa orcamento_3d_consumos
--   (custo_por_grama_snapshot), não o retrato do job. custo_real_snapshot nasce vazio e nenhuma função o grava.
--
-- O QUE FAZ
--   1. criar_jobs_3d_da_os deixa de gravar custo_material e custo_por_grama no retrato (troca por âncora contada).
--   2. Tira essas chaves dos jobs que já existem. Nada se perde: o custo mora em orcamento_3d_consumos
--      (custo_por_grama_snapshot e custo_total), que só quem tem impressao3d.cost.read lê.
--   3. CHECK: o retrato do job não aceita chave com custo, margem, lucro ou markup.
--
-- Sem REVOKE por coluna de propósito: producao-3d.tsx e impressao-3d.tsx leem a tabela com select('*'), e coluna sem GRANT
-- derruba o '*' para todo mundo, o admin inclusive.
--
-- IDEMPOTENTE. Depende de public.jsonb_sem_custo (migração 20261104100000, aplicada).

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.criar_jobs_3d_da_os(uuid,uuid)'::regprocedure);
  v_novo text;
  v_a1 constant text := '\s*''custo_material'',\s*coalesce\(sum\(c\.custo_total\),\s*0\),';
  v_a2 constant text := ',\s*''custo_por_grama'',\s*c\.custo_por_grama_snapshot';
  n1 integer;
  n2 integer;
BEGIN
  IF to_regprocedure('public.jsonb_sem_custo(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'falta public.jsonb_sem_custo (migração 20261104100000)';
  END IF;
  IF v_def !~ '''custo_material''' AND v_def !~ '''custo_por_grama''' THEN
    RAISE NOTICE 'criar_jobs_3d_da_os já não grava custo no retrato do job';
    RETURN;
  END IF;
  SELECT count(*) INTO n1 FROM regexp_matches(v_def, v_a1, 'g');
  SELECT count(*) INTO n2 FROM regexp_matches(v_def, v_a2, 'g');
  IF n1 <> 1 OR n2 <> 1 THEN
    RAISE EXCEPTION 'criar_jobs_3d_da_os: âncoras achadas % e % vez(es), esperado 1 e 1; a função mudou, reler antes de trocar', n1, n2;
  END IF;
  v_novo := regexp_replace(regexp_replace(v_def, v_a1, '', 'g'), v_a2, '', 'g');
  IF v_novo ~ '''custo_' THEN
    RAISE EXCEPTION 'criar_jobs_3d_da_os: sobrou chave de custo depois da troca; parando';
  END IF;
  EXECUTE v_novo;
END $m$;

-- 2. Os jobs que já existem
UPDATE public.producao_3d_jobs j
   SET custo_previsto_snapshot =
         CASE WHEN jsonb_typeof(j.custo_previsto_snapshot -> 'materiais') = 'array'
              THEN jsonb_set(public.jsonb_sem_custo(j.custo_previsto_snapshot), '{materiais}',
                     coalesce((SELECT jsonb_agg(public.jsonb_sem_custo(e) ORDER BY n)
                                 FROM jsonb_array_elements(j.custo_previsto_snapshot -> 'materiais') WITH ORDINALITY AS t(e, n)),
                              '[]'::jsonb))
              ELSE public.jsonb_sem_custo(j.custo_previsto_snapshot) END,
       custo_real_snapshot = public.jsonb_sem_custo(j.custo_real_snapshot)
 WHERE j.custo_previsto_snapshot::text ~* 'custo' OR j.custo_real_snapshot::text ~* 'custo';

-- 3. Trava: o retrato do job não aceita mais chave de custo
ALTER TABLE public.producao_3d_jobs DROP CONSTRAINT IF EXISTS producao_3d_jobs_snapshot_sem_custo_chk;
ALTER TABLE public.producao_3d_jobs ADD CONSTRAINT producao_3d_jobs_snapshot_sem_custo_chk
  CHECK (custo_previsto_snapshot::text !~* '"[^"]*(custo|margem|lucro|markup)[^"]*"\s*:'
     AND custo_real_snapshot::text !~* '"[^"]*(custo|margem|lucro|markup)[^"]*"\s*:');
COMMENT ON CONSTRAINT producao_3d_jobs_snapshot_sem_custo_chk ON public.producao_3d_jobs IS
  'Quem lê o job (impressao3d.read) não pode ler custo pelo retrato. Custo por job mora em tabela de leitura restrita.';
