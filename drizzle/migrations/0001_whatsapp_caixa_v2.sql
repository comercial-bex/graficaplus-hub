
ALTER TABLE public.whatsapp_mensagens ADD COLUMN IF NOT EXISTS origem text DEFAULT 'humano';
UPDATE public.whatsapp_mensagens SET origem = 'celular' WHERE direcao = 'saida' AND enviada_por IS NULL;
ALTER TABLE public.whatsapp_mensagens ADD CONSTRAINT whatsapp_mensagens_origem_check
  CHECK (origem IS NULL OR origem IN ('humano','celular','automacao','ia'));

CREATE TABLE public.whatsapp_conversa_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('assumida','transferida','status','vinculo','nota')),
  de_usuario uuid,
  para_usuario uuid,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_conversa_eventos_conversa_idx ON public.whatsapp_conversa_eventos (conversa_id, created_at);
GRANT SELECT ON public.whatsapp_conversa_eventos TO authenticated;
GRANT ALL ON public.whatsapp_conversa_eventos TO service_role;
ALTER TABLE public.whatsapp_conversa_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa eventos leitura" ON public.whatsapp_conversa_eventos
  FOR SELECT TO authenticated USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='whatsapp_conversas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversas; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='whatsapp_mensagens') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_mensagens; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='whatsapp_conversa_eventos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversa_eventos; END IF;
END $$;

-- Equipe para "Transferir para…" e nomes nos balões (somente leitura).
CREATE OR REPLACE FUNCTION public.whatsapp_equipe()
RETURNS TABLE (id uuid, nome text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.nome, u.avatar_url FROM public.usuarios u
  WHERE u.ativo IS NOT FALSE AND public.is_staff(u.id)
    AND public.has_permission(auth.uid(), 'whatsapp.read')
  ORDER BY u.nome
$$;
REVOKE ALL ON FUNCTION public.whatsapp_equipe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_equipe() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._wa_exigir_resposta(p_usuario uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'whatsapp.reply') THEN
    RAISE EXCEPTION 'Seu perfil não pode alterar conversas do WhatsApp (falta a permissão whatsapp › reply).';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._wa_exigir_resposta(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_exigir_resposta(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_assumir(p_conversa_id uuid, p_usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_antes uuid;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  SELECT responsavel_id INTO v_antes FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET responsavel_id = p_usuario WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, para_usuario, detalhe)
  VALUES (p_conversa_id, 'assumida', p_usuario, p_usuario, jsonb_build_object('antes', v_antes));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_transferir(p_conversa_id uuid, p_usuario uuid, p_para uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_para IS NULL OR NOT public.is_staff(p_para) THEN
    RAISE EXCEPTION 'Escolha uma pessoa ativa da equipe para transferir.';
  END IF;
  UPDATE public.whatsapp_conversas SET responsavel_id = p_para WHERE id = p_conversa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, para_usuario)
  VALUES (p_conversa_id, 'transferida', p_usuario, p_para);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_mudar_status(p_conversa_id uuid, p_usuario uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_antes text;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_status NOT IN ('aberta','pendente','resolvida','arquivada') THEN
    RAISE EXCEPTION 'Situação inválida: %', p_status;
  END IF;
  SELECT status::text INTO v_antes FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas
     SET status = p_status::whatsapp_conversa_status,
         nao_lidas = CASE WHEN p_status IN ('resolvida','arquivada') THEN 0 ELSE nao_lidas END
   WHERE id = p_conversa_id;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'status', p_usuario, jsonb_build_object('de', v_antes, 'para', p_status));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_nota(p_conversa_id uuid, p_usuario uuid, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_texto text := btrim(coalesce(p_texto, ''));
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF v_texto = '' THEN RAISE EXCEPTION 'A nota está vazia.'; END IF;
  IF length(v_texto) > 4000 THEN RAISE EXCEPTION 'Nota longa demais (máximo 4.000 caracteres).'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_conversas WHERE id = p_conversa_id) THEN
    RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'nota', p_usuario, jsonb_build_object('texto', v_texto));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_vincular_orcamento(p_conversa_id uuid, p_usuario uuid, p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_orc record; v_cliente uuid;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  SELECT id, numero, cliente_id INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  SELECT cliente_id INTO v_cliente FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  UPDATE public.orcamentos SET conversa_id = p_conversa_id WHERE id = p_orcamento_id;
  IF v_cliente IS NULL AND v_orc.cliente_id IS NOT NULL THEN
    UPDATE public.whatsapp_conversas SET cliente_id = v_orc.cliente_id WHERE id = p_conversa_id;
    UPDATE public.whatsapp_mensagens SET cliente_id = v_orc.cliente_id WHERE conversa_id = p_conversa_id AND cliente_id IS NULL;
  END IF;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'vinculo', p_usuario, jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.numero));
  RETURN jsonb_build_object('ok', true, 'cliente_herdado', v_cliente IS NULL AND v_orc.cliente_id IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_vincular_os(p_conversa_id uuid, p_usuario uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_numero int;
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  SELECT numero INTO v_numero FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.'; END IF;
  UPDATE public.whatsapp_conversas SET os_id = p_os_id WHERE id = p_conversa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  INSERT INTO public.whatsapp_conversa_eventos (conversa_id, tipo, de_usuario, detalhe)
  VALUES (p_conversa_id, 'vinculo', p_usuario, jsonb_build_object('os_id', p_os_id, 'numero', v_numero));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_responder_arquivo(
  p_conversa_id uuid, p_usuario uuid, p_tipo text, p_storage_path text,
  p_nome_arquivo text, p_legenda text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_inst record; v_msg uuid; v_fila uuid;
  v_legenda text := NULLIF(btrim(coalesce(p_legenda,'')), '');
BEGIN
  PERFORM public._wa_exigir_resposta(p_usuario);
  IF p_tipo NOT IN ('documento','imagem') THEN RAISE EXCEPTION 'Tipo de arquivo inválido.'; END IF;
  IF NULLIF(btrim(coalesce(p_storage_path,'')), '') IS NULL THEN RAISE EXCEPTION 'Arquivo não enviado.'; END IF;
  SELECT * INTO v_conversa FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  SELECT conectado, status::text AS status, ativa INTO v_inst FROM public.whatsapp_instancias WHERE id = v_conversa.instancia_id;
  IF v_inst.ativa IS NOT TRUE OR v_inst.conectado IS NOT TRUE OR v_inst.status IS DISTINCT FROM 'conectada' THEN
    RAISE EXCEPTION 'WhatsApp desconectado — o arquivo não foi enfileirado.';
  END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, legenda,
    storage_bucket, storage_path, cliente_id, os_id, enviada_por, origem, payload)
  VALUES (v_conversa.id, v_conversa.instancia_id, 'saida', p_tipo::whatsapp_mensagem_tipo, 'pendente', v_legenda,
    'whatsapp-midias', p_storage_path, v_conversa.cliente_id, v_conversa.os_id, p_usuario, 'humano',
    jsonb_build_object('origem','caixa_de_entrada','nome_arquivo', p_nome_arquivo))
  RETURNING id INTO v_msg;
  INSERT INTO public.whatsapp_fila_envio (conversa_id, mensagem_id, payload, status, idempotency_key, created_by)
  VALUES (v_conversa.id, v_msg,
    jsonb_build_object('tipo', CASE WHEN p_tipo='imagem' THEN 'imagem' ELSE 'pdf' END,
      'texto', v_legenda, 'storage_bucket', 'whatsapp-midias', 'storage_path', p_storage_path,
      'nomeArquivo', p_nome_arquivo),
    'pendente', 'caixa-de-entrada:' || v_msg::text, p_usuario)
  RETURNING id INTO v_fila;
  UPDATE public.whatsapp_conversas
     SET ultima_mensagem = left(coalesce(v_legenda, '[' || CASE WHEN p_tipo='imagem' THEN 'Imagem' ELSE 'Documento' END || ']'), 500),
         ultima_mensagem_at = now(), nao_lidas = 0,
         responsavel_id = coalesce(responsavel_id, p_usuario)
   WHERE id = v_conversa.id;
  RETURN jsonb_build_object('mensagem_id', v_msg, 'fila_id', v_fila, 'status', 'pendente');
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_reprocessar_sistema()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; p jsonb; v_tipo text; v_texto text; v_media text; n int := 0;
BEGIN
  FOR r IN SELECT m.id, m.conversa_id, e.payload FROM public.whatsapp_mensagens m
           JOIN public.whatsapp_webhook_eventos e ON e.provedor = 'zapi' AND e.external_id = 'msg:' || m.zapi_message_id
           WHERE m.tipo = 'sistema' AND m.texto IS NULL LOOP
    p := r.payload; v_tipo := 'texto'; v_texto := NULL; v_media := NULL;
    IF jsonb_typeof(p->'hydratedTemplate') = 'object' THEN
      v_texto := NULLIF(concat_ws(E'\n\n',
        NULLIF(btrim(p->'hydratedTemplate'->>'title'),''),
        NULLIF(btrim(coalesce(p->'hydratedTemplate'->>'message', p->'hydratedTemplate'->>'content')),''),
        NULLIF(btrim(p->'hydratedTemplate'->>'footer'),'')), '');
    ELSIF jsonb_typeof(p->'poll') = 'object' THEN
      v_texto := '[Enquete] ' || coalesce(p->'poll'->>'question', p->'poll'->>'name', '');
    ELSIF p ? 'editedMessage' OR p->>'isEdit' = 'true' THEN
      v_texto := '[mensagem editada]';
    ELSIF p ? 'revoked' OR p->>'type' = 'RevokedCallback' THEN
      v_texto := '[mensagem apagada]';
    ELSIF jsonb_typeof(p->'ptv') = 'object' THEN
      v_tipo := 'video'; v_media := coalesce(p->'ptv'->>'url', p->'ptv'->>'videoUrl');
    ELSIF jsonb_typeof(p->'product') = 'object' THEN
      v_texto := btrim('[Produto] ' || coalesce(p->'product'->>'title', p->'product'->>'name', ''));
    ELSIF jsonb_typeof(p->'order') = 'object' THEN
      v_texto := '[Pedido]';
    END IF;
    IF v_texto IS NOT NULL OR v_tipo = 'video' THEN
      UPDATE public.whatsapp_mensagens
         SET tipo = v_tipo::whatsapp_mensagem_tipo, texto = v_texto, media_url = coalesce(media_url, v_media)
       WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  UPDATE public.whatsapp_conversas c
     SET ultima_mensagem = left(coalesce(x.texto, x.legenda, '[Vídeo]'), 500)
    FROM LATERAL (SELECT texto, legenda FROM public.whatsapp_mensagens m
                   WHERE m.conversa_id = c.id ORDER BY created_at DESC LIMIT 1) x
   WHERE c.ultima_mensagem = '[sistema]';
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_assumir(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_transferir(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_mudar_status(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_nota(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_vincular_orcamento(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_vincular_os(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_responder_arquivo(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_reprocessar_sistema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_assumir(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_transferir(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_mudar_status(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_nota(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_vincular_orcamento(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_vincular_os(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_responder_arquivo(uuid, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_reprocessar_sistema() TO service_role;
