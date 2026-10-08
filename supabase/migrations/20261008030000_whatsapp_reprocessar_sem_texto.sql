-- ============================================================================
-- WhatsApp: "Reprocessar mensagens sem texto" voltava ERRO e não gravava nada
-- ============================================================================
--
-- `whatsapp_reprocessar_sistema()` (caixa v2, Lovable, 07/10/2026) termina com
--
--   UPDATE public.whatsapp_conversas c ... FROM LATERAL (... WHERE m.conversa_id = c.id ...)
--
-- e o Postgres recusa: 42P10 "invalid reference to FROM-clause entry for table
-- c" — o alvo do UPDATE não pode ser citado num LATERAL do FROM. A função
-- inteira volta atrás. Conferido no banco vivo em 08/10/2026: o botão do
-- Monitor ("Reprocessar mensagens sem texto") nunca corrigiu nada, e as três
-- mensagens de modelo de empresa (Claro, Renova Be, Kwai) seguiam como
-- 'sistema' sem texto, com "[sistema]" na lista.
--
-- O que muda (o resto é igual, linha por linha):
--   1. o último UPDATE usa DISTINCT ON num subselect comum, sem LATERAL;
--   2. a mensagem de MODELO de empresa (hydratedTemplate) recuperada ganha
--      origem = 'automacao' — o mesmo que a onda 1 (20261007150000) grava nas
--      novas: não é gente, não conta como mensagem de cliente.
--
-- Mesma assinatura, então os privilégios ficam; o REVOKE vai de novo para não
-- depender disso. Depois de aplicar, conferir:
--   select has_function_privilege('anon', 'public.whatsapp_reprocessar_sistema()', 'EXECUTE');          -- false
--   select has_function_privilege('authenticated', 'public.whatsapp_reprocessar_sistema()', 'EXECUTE'); -- false
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_reprocessar_sistema()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; p jsonb; v_tipo text; v_texto text; v_media text; v_modelo boolean; n int := 0;
BEGIN
  FOR r IN SELECT m.id, m.conversa_id, e.payload FROM public.whatsapp_mensagens m
           JOIN public.whatsapp_webhook_eventos e ON e.provedor = 'zapi' AND e.external_id = 'msg:' || m.zapi_message_id
           WHERE m.tipo = 'sistema' AND m.texto IS NULL LOOP
    p := r.payload; v_tipo := 'texto'; v_texto := NULL; v_media := NULL; v_modelo := false;
    IF jsonb_typeof(p->'hydratedTemplate') = 'object' THEN
      v_modelo := true;
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
         SET tipo = v_tipo::whatsapp_mensagem_tipo, texto = v_texto, media_url = coalesce(media_url, v_media),
             origem = CASE WHEN v_modelo THEN 'automacao' ELSE origem END
       WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;
  UPDATE public.whatsapp_conversas c
     SET ultima_mensagem = left(coalesce(x.texto, x.legenda, '[Vídeo]'), 500)
    FROM (SELECT DISTINCT ON (m.conversa_id) m.conversa_id, m.texto, m.legenda
            FROM public.whatsapp_mensagens m
           ORDER BY m.conversa_id, m.created_at DESC) x
   WHERE x.conversa_id = c.id AND c.ultima_mensagem = '[sistema]';
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_reprocessar_sistema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_reprocessar_sistema() TO service_role;
