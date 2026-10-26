-- A especificação do item 3D saía "1.00 h de impressão" (ponto): no PDF e na linha do item o
-- cliente lê em português. Troca para "1,00 h". Só o texto; o cálculo não muda (27/10/2026).
DO $fix$
DECLARE
  v_def text := pg_get_functiondef('public.salvar_item_3d_no_orcamento(uuid, uuid, text, numeric, uuid, uuid, numeric, integer, numeric, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text)'::regprocedure);
  v_de text := $a$round(p_tempo_segundos / 3600.0, 2) || ' h de impressão'$a$;
  v_para text := $b$replace(round(p_tempo_segundos / 3600.0, 2)::text, '.', ',') || ' h de impressão'$b$;
BEGIN
  IF position(v_para IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'salvar_item_3d_no_orcamento: o texto do tempo não está como esperado';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$fix$;
