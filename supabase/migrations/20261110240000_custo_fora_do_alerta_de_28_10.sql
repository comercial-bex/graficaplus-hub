-- APLICADA em 10/11/2026, em produção. O original (2.111 caracteres, 28 valores em reais) ficou em custo_em_texto_guardado
-- com o mesmo md5; o aviso segue "enviado" e o texto novo (225 caracteres) não tem valor nenhum.

-- Custo fora do alerta da auditoria de preços de 28/10 (10/11/2026).
--
-- notificacoes_fila é lida por toda a equipe (policy is_staff, ALL). A linha fa5dae87, o aviso que o sistema mandou ao gestor
-- em 28/10 sobre a auditoria de preços, trazia 28 valores em reais: custo de máquina, mão de obra por hora, custo e margem de
-- OS e de orçamentos. Esta migração guarda o original em custo_em_texto_guardado (só quem vê custo lê) e troca só o texto da
-- linha por um resumo sem valores. Nada mais na linha muda (status, destinatário, datas, chave de idempotência).
--
-- Para tudo (RAISE EXCEPTION) se o texto vivo não for o listado (md5) ou se sobrar R$ no texto novo. Seguro para rodar de novo.

DO $alerta$
DECLARE
  c_lote constant text := '2026-11-10-alerta-de-28-10';
  c_id constant uuid := 'fa5dae87-5fc4-472b-a079-18dace29c151';
  c_md5 constant text := '692a52ddf9c343fbda8a34fd8f40d93b';
  v_atual jsonb;
  v_novo jsonb;
  v_guardado jsonb;
  v_linhas integer;
  v_upd timestamptz;
BEGIN
  IF to_regclass('public.custo_em_texto_guardado') IS NULL THEN
    RAISE EXCEPTION 'custo_em_texto_guardado não existe; nada foi alterado';
  END IF;
  SELECT n.variaveis, n.updated_at INTO v_atual, v_upd FROM public.notificacoes_fila n WHERE n.id = c_id;
  -- SELECT ... INTO estático atualiza FOUND, mas aqui o GET DIAGNOSTICS é o que vale em todo caso
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas = 0 THEN
    RAISE NOTICE 'o alerta de 28/10 não existe neste banco; nada a fazer';
    RETURN;
  END IF;
  SELECT g.novo_json INTO v_guardado FROM public.custo_em_texto_guardado g
   WHERE g.lote = c_lote AND g.tabela = 'notificacoes_fila' AND g.coluna = 'variaveis' AND g.registro_id = c_id;
  IF FOUND AND v_atual IS NOT DISTINCT FROM v_guardado THEN
    RAISE NOTICE 'o alerta de 28/10 já está sem valores';
    RETURN;
  END IF;
  IF md5(v_atual::text) <> c_md5 THEN
    RAISE EXCEPTION 'o texto vivo do alerta não é o que foi listado (md5 %); nada foi alterado', md5(v_atual::text);
  END IF;

  v_novo := jsonb_build_object('texto',
    'Bex Print · auditoria de preços (28/10): aviso do sistema ao gestor sobre medidas, apontamentos e preços de ordens de serviço e orçamentos em aberto. O texto completo, com os valores de custo, foi guardado para quem vê custo.');

  INSERT INTO public.custo_em_texto_guardado (lote, tabela, coluna, registro_id, rotulo, original_json, novo_json, atualizado_em_original)
  VALUES (c_lote, 'notificacoes_fila', 'variaveis', c_id, 'Alerta da auditoria de preços de 28/10', v_atual, v_novo, v_upd)
  ON CONFLICT (lote, tabela, coluna, registro_id) DO NOTHING;
  SELECT g.original_json INTO v_guardado FROM public.custo_em_texto_guardado g
   WHERE g.lote = c_lote AND g.tabela = 'notificacoes_fila' AND g.coluna = 'variaveis' AND g.registro_id = c_id;
  IF v_guardado IS DISTINCT FROM v_atual THEN
    RAISE EXCEPTION 'já existe um original guardado diferente do que está no banco; confira antes de repetir';
  END IF;

  UPDATE public.notificacoes_fila SET variaveis = v_novo WHERE id = c_id AND variaveis = v_atual;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN
    RAISE EXCEPTION 'a linha mudou no meio da limpeza; nada foi alterado';
  END IF;
  IF (SELECT n.variaveis::text FROM public.notificacoes_fila n WHERE n.id = c_id) ~ 'R\$' THEN
    RAISE EXCEPTION 'ainda sobrou valor em reais no alerta; nada foi alterado';
  END IF;
END $alerta$;
