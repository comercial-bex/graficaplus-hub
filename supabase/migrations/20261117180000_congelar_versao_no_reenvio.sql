-- =====================================================================================================
-- CONGELAR A VERSÃO TAMBÉM NO REENVIO (17/11/2026)
--
-- ENSAIADA no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final (ver docs/ensaio-congelar-versao-no-reenvio.md).
-- APLICADA no banco vivo em 17/11/2026 (a 100000, da área cobrada, ficou de fora até o dono dar o OK).
--
-- O QUE ESTAVA ERRADO (lido no banco vivo em 17/11/2026)
--   A versão congelada só nascia quando o status MUDAVA para enviado ou aprovado (gatilho
--   zz_orcamento_congela_versao). Reenviar um orçamento que já estava enviado (PDF ou link de novo, com
--   preço ou item alterado) não muda o status, então nenhuma versão nova nascia. A faixa "mudou depois de
--   enviado" mandava enviar de novo, a pessoa enviava, e a faixa continuava acesa para sempre.
--   5 orçamentos têm mudança real depois do envio (115, 198, 206, 227, 233): só ganham versão quando alguém
--   reenviar. Esta migração NÃO faz carga retroativa (nenhum UPDATE, nenhuma versão criada agora).
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Função NOVA interna orcamento_congelar_versao(orcamentos, boolean, uuid): o mesmo corpo do gatilho,
--      com a linha do orçamento como parâmetro. Usa o hash de itens e total: enviar de novo sem mudança
--      NÃO cria versão (reaproveita a última). Só service_role e as funções do sistema chamam.
--   2. tg_orcamento_congela_versao (md5 do corpo conferido antes, 73d5680ed15a4534da13718eafd5ed61) passa a
--      só delegar para a função nova e a guardar versao_aprovada_id. Mesmo gatilho, mesmas opções.
--   3. confirmar_envio_documento (md5 conferido antes, 9d0ab672aaba56e75de28ea6fa307317): no ramo do
--      orçamento que JÁ estava enviado, chama a função nova depois de gravar. Todo o resto é idêntico.
--      "Mesmo conteúdo" ignora a coluna derivada area_cobrada: a 100000 corrige a conta dela e, sem isso, 6 orçamentos
--      com versão congelada (54, 98, 115, 150, 175, 217) ganhariam uma versão espúria no primeiro reenvio ou
--      renovação só porque a área foi corrigida. Itens e total continuam comparados por inteiro.
--   Nada é gravado agora. enviado_em NÃO é reescrito no reenvio (só se estiver vazio, como sempre foi).
--
-- FICA DE FORA (anotado para o servidor): wa.me e link copiado passam por registrar_envio_documento, que não
--   é trocada aqui; para congelar nesses dois caminhos o servidor (service_role) chama
--   orcamento_congelar_versao depois do registro.
--
-- COMO DESFAZER (comentado): recriar tg_orcamento_congela_versao com o corpo de md5 73d5680ed15a4534da13718eafd5ed61
--   e confirmar_envio_documento com o corpo de md5 9d0ab672aaba56e75de28ea6fa307317 (estão em
--   supabase/migrations anteriores e no banco antes de aplicar); depois DROP FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $g$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tg_orcamento_congela_versao')
       IS DISTINCT FROM '73d5680ed15a4534da13718eafd5ed61' THEN
    RAISE EXCEPTION 'tg_orcamento_congela_versao mudou desde a revisão: refazer o ensaio';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.confirmar_envio_documento(uuid, uuid)'::regprocedure)
       IS DISTINCT FROM '9d0ab672aaba56e75de28ea6fa307317' THEN
    RAISE EXCEPTION 'confirmar_envio_documento mudou desde a revisão: refazer o ensaio';
  END IF;
  IF to_regprocedure('public.orcamento_itens_para_versao(uuid)') IS NULL OR to_regprocedure('public.jsonb_sem_custo(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'faltam orcamento_itens_para_versao ou jsonb_sem_custo';
  END IF;
END $g$;

-- 1. Função interna: o corpo do gatilho, com a linha como parâmetro.
CREATE OR REPLACE FUNCTION public.orcamento_congelar_versao(p_orc public.orcamentos, p_aprovando boolean, p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_itens jsonb := public.orcamento_itens_para_versao(p_orc.id);
  v_hash text := md5(v_itens::text || '|' || coalesce(p_orc.valor_total::text, '0'));
  v_ultima public.orcamento_versoes%ROWTYPE;
  v_id uuid;
  v_igual boolean := false;
BEGIN
  SELECT * INTO v_ultima FROM public.orcamento_versoes WHERE orcamento_id = p_orc.id ORDER BY numero_versao DESC LIMIT 1;
  IF FOUND THEN
    -- Mesmo conteúdo: o hash guardado bate, OU os itens batem sem a coluna derivada area_cobrada (a 100000
    -- corrigiu a conta dessa coluna, então o hash antigo de 6 orçamentos não bate só por causa dela) e o total é o mesmo.
    v_igual := v_ultima.snapshot->>'hash' = v_hash
      OR (v_ultima.snapshot->>'hash' IS NOT NULL
          AND coalesce(v_ultima.valor_total, 0) = coalesce(p_orc.valor_total, 0)
          AND coalesce((SELECT jsonb_agg(e - 'area_cobrada' ORDER BY n) FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(v_ultima.snapshot->'itens') = 'array' THEN v_ultima.snapshot->'itens' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(e, n)), '[]'::jsonb)
            = coalesce((SELECT jsonb_agg(e - 'area_cobrada' ORDER BY n) FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS t(e, n)), '[]'::jsonb));
  END IF;
  IF v_igual THEN
    v_id := v_ultima.id;
    UPDATE public.orcamento_versoes
       SET status = CASE WHEN p_aprovando THEN 'aprovada' ELSE status END,
           enviada_em = CASE WHEN NOT p_aprovando THEN coalesce(enviada_em, now()) ELSE enviada_em END,
           aprovada_em = CASE WHEN p_aprovando THEN coalesce(aprovada_em, now()) ELSE aprovada_em END,
           aprovado_por = CASE WHEN p_aprovando THEN coalesce(aprovado_por, p_uid) ELSE aprovado_por END
     WHERE id = v_id;
  ELSE
    INSERT INTO public.orcamento_versoes (orcamento_id, numero_versao, status, snapshot, valor_total, enviada_em, aprovada_em, aprovado_por, created_by)
    VALUES (p_orc.id, coalesce(v_ultima.numero_versao, 0) + 1, CASE WHEN p_aprovando THEN 'aprovada' ELSE 'enviada' END,
            jsonb_build_object('hash', v_hash, 'orcamento', public.jsonb_sem_custo(to_jsonb(p_orc) - 'token_publico' - 'aprovado_ip'), 'itens', v_itens),
            p_orc.valor_total, CASE WHEN NOT p_aprovando THEN now() END, CASE WHEN p_aprovando THEN now() END, CASE WHEN p_aprovando THEN p_uid END, p_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.orcamento_versao_itens (versao_id, orcamento_item_id, snapshot, ordem)
    SELECT v_id, (e->>'id')::uuid, e, (e->>'ordem')::int FROM jsonb_array_elements(v_itens) e;
  END IF;
  RETURN v_id;
END $function$;

REVOKE ALL ON FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.orcamento_congelar_versao(public.orcamentos, boolean, uuid) IS
  'Congela a versão do orçamento (cria ou reaproveita pelo hash de itens e total). Interna: chamada pelo gatilho de status, por confirmar_envio_documento e por renovar_orcamento_vencido; o servidor chama para wa.me e link copiado. Só service_role.';

-- 2. O gatilho passa a delegar (troca guardada pelo md5 lido acima).
CREATE OR REPLACE FUNCTION public.tg_orcamento_congela_versao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_aprovando boolean := NEW.status::text = 'aprovado';
  v_id uuid;
BEGIN
  v_id := public.orcamento_congelar_versao(NEW, v_aprovando, auth.uid());
  IF v_aprovando THEN NEW.versao_aprovada_id := v_id; END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.tg_orcamento_congela_versao() FROM PUBLIC, anon, authenticated;

-- 3. confirmar_envio_documento: igual ao vivo (md5 9d0ab672...), com o bloco novo no ramo do orçamento já enviado.
CREATE OR REPLACE FUNCTION public.confirmar_envio_documento(p_usuario uuid, p_envio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_env public.documentos_enviados%ROWTYPE;
  v_msg_status text; v_msg_em timestamptz;
  v_numero text; v_cliente uuid; v_os uuid; v_do text;
  v_status text; v_sem_data boolean;
  v_status_mudou boolean := false; v_gravou_data boolean := false;
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_usuario IS NULL OR p_envio_id IS NULL THEN RAISE EXCEPTION 'Faltou informar quem confirma ou o envio.'; END IF;
  SELECT * INTO v_env FROM public.documentos_enviados WHERE id = p_envio_id;
  IF NOT FOUND OR v_env.canal <> 'whatsapp_sistema' OR v_env.enviado_por IS DISTINCT FROM p_usuario THEN RAISE EXCEPTION 'Este envio não é seu pelo WhatsApp da gráfica.'; END IF;
  SELECT m.status::text, coalesce(m.enviado_em, now()) INTO v_msg_status, v_msg_em FROM public.whatsapp_mensagens m WHERE m.id = v_env.mensagem_id;
  IF v_msg_status IS NULL OR v_msg_status NOT IN ('enviada', 'entregue', 'lida') THEN RAISE EXCEPTION 'A mensagem ainda não saiu pelo WhatsApp.'; END IF;
  IF v_env.tipo = 'orcamento' THEN
    SELECT o.numero::text, o.cliente_id, o.os_id INTO v_numero, v_cliente, v_os FROM public.orcamentos o WHERE o.id = v_env.referencia_id;
  ELSIF v_env.tipo = 'os' THEN
    SELECT s.numero::text, s.cliente_id, s.id INTO v_numero, v_cliente, v_os FROM public.ordens_servico s WHERE s.id = v_env.referencia_id;
  ELSE
    SELECT coalesce(o.numero::text, upper(left(t.id::text, 8))), t.cliente_id, t.os_id INTO v_numero, v_cliente, v_os FROM public.orcamentos_3d t LEFT JOIN public.orcamentos o ON o.id = t.orcamento_id WHERE t.id = v_env.referencia_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado.'; END IF;
  v_do := CASE v_env.tipo WHEN 'orcamento' THEN 'do orçamento nº ' WHEN 'os' THEN 'da ordem de serviço nº ' ELSE 'do orçamento 3D nº ' END || v_numero;
  IF v_env.tipo = 'orcamento' THEN
    PERFORM set_config('request.jwt.claim.sub', p_usuario::text, true);
    SELECT o.status::text, o.enviado_em IS NULL INTO v_status, v_sem_data FROM public.orcamentos o WHERE o.id = v_env.referencia_id FOR UPDATE;
    IF v_status = 'rascunho' THEN
      UPDATE public.orcamentos SET status = 'enviado', enviado_em = coalesce(enviado_em, v_msg_em) WHERE id = v_env.referencia_id;
      v_status_mudou := true; v_gravou_data := v_sem_data;
    ELSIF v_status = 'enviado' AND v_sem_data THEN
      UPDATE public.orcamentos SET enviado_em = v_msg_em WHERE id = v_env.referencia_id;
      v_gravou_data := true;
    END IF;
    IF v_status = 'enviado' THEN
      SELECT * INTO v_orc FROM public.orcamentos WHERE id = v_env.referencia_id;
      PERFORM public.orcamento_congelar_versao(v_orc, false, p_usuario);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eventos_negocio e WHERE e.entidade = v_env.tipo AND e.entidade_id = v_env.referencia_id AND e.tipo = 'documento_enviado_ao_cliente' AND e.dados_posteriores->>'envio_id' = p_envio_id::text) THEN
    INSERT INTO public.eventos_negocio (entidade, entidade_id, os_id, cliente_id, tipo, titulo, descricao, dados_posteriores, usuario_id, origem)
    VALUES (v_env.tipo, v_env.referencia_id, v_os, v_cliente, 'documento_enviado_ao_cliente',
      CASE WHEN v_env.documento_id IS NULL THEN 'Link ' ELSE 'PDF ' END || v_do || ' enviado pelo WhatsApp da gráfica', NULL,
      jsonb_build_object('envio_id', p_envio_id, 'mensagem_id', v_env.mensagem_id, 'situacao', v_msg_status), p_usuario, 'sistema');
  END IF;
  RETURN jsonb_build_object('status_mudou', v_status_mudou, 'enviado_em_gravado', v_gravou_data);
END
$function$;

REVOKE ALL ON FUNCTION public.confirmar_envio_documento(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_envio_documento(uuid, uuid) TO service_role;

DO $v$
BEGIN
  IF has_function_privilege('anon', 'public.orcamento_congelar_versao(public.orcamentos, boolean, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.orcamento_congelar_versao(public.orcamentos, boolean, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tg_orcamento_congela_versao()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_orcamento_congela_versao()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.confirmar_envio_documento(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirmar_envio_documento(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'função de versão ficou executável por anon ou authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.orcamento_congelar_versao(public.orcamentos, boolean, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.confirmar_envio_documento(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdeu o EXECUTE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orcamentos'::regclass AND tgname = 'zz_orcamento_congela_versao' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'o gatilho zz_orcamento_congela_versao não está ligado';
  END IF;
END $v$;

COMMIT;
