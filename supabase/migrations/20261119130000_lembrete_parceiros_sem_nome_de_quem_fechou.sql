-- APLICADA em 19/11/2026, direto no banco, a pedido do dono.
-- Tira o nome de quem fechou o chamado do aviso ao grupo. Idempotente (sem "fechado por" = nada a fazer).
DO $acao$
DECLARE v_antes text; v_depois text; v_n int;
BEGIN
  v_antes := pg_get_functiondef('public.lembrete_parceiros_sem_contato(boolean, date)'::regprocedure);
  v_n := (SELECT count(*) FROM regexp_matches(v_antes, 'fechado por', 'g'));
  IF v_n = 0 THEN RETURN; END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'esperava 1 ocorrencia de "fechado por", achei %', v_n; END IF;
  v_depois := regexp_replace(v_antes, '''\s·\sfechado\spor\s''\s\|\|\sr\.fechado_por_nome\s+\|\|\s''\sem\s''', ''' · fechado em ''');
  IF v_depois = v_antes OR v_depois LIKE '%fechado por%' THEN RAISE EXCEPTION 'a troca nao casou'; END IF;
  EXECUTE v_depois;
END
$acao$;
