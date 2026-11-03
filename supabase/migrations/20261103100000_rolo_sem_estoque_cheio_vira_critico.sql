-- Rolo sem estoque cheio definido: de "atenção" (âmbar) para "crítico" (vermelho).
-- Decisão do dono (03/11/2026): enquanto o estoque cheio não estiver preenchido, o aviso de compra
-- a 15% não funciona — gerência, administrador e financeiro precisam ver isso em vermelho no painel.
-- Quem vê: admin, gestor e financeiro já veem todos os avisos (PAPEIS_QUE_VEEM_TUDO).
--
-- Muda só a gravidade dessa linha em public.pendencias_de_preenchimento(). A função é reescrita a
-- partir da definição viva, com guarda de md5: se outra sessão mudou a função, a migração aborta
-- em vez de pisar na mudança dela.
-- Desfazer: repetir a troca ao contrário ('critico', 'gestao' -> 'atencao', 'gestao').
DO $migracao$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  v_novo text;
BEGIN
  IF md5(v_def) <> '1dbf1f2d30880b361593163e3d2c211c' AND position($$'critico', 'gestao'$$ in v_def) = 0 THEN
    RAISE EXCEPTION 'pendencias_de_preenchimento mudou (md5 %); reler antes de aplicar', md5(v_def);
  END IF;
  IF position($$'atencao', 'gestao'$$ in v_def) = 0 THEN
    RAISE NOTICE 'Nada a trocar: a linha já é crítica.';
    RETURN;
  END IF;
  v_novo := replace(v_def, $$'atencao', 'gestao'$$, $$'critico', 'gestao'$$);
  EXECUTE v_novo;
END
$migracao$;

NOTIFY pgrst, 'reload schema';
