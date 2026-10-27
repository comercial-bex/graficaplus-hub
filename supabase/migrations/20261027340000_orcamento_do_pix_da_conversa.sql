-- O orçamento cujo Pix do sinal foi mandado numa conversa nos últimos 10 dias (27/10/2026).
-- O webhook usa para responder ao toque nos botões do Pix ("Já paguei", "Ver orçamento",
-- "Falar com a equipe"): sem orçamento esperando, o toque é conversa normal e nada acontece.
CREATE OR REPLACE FUNCTION public.orcamento_do_pix_da_conversa(p_conversa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_conv record; v_orc record;
BEGIN
  SELECT cliente_id, telefone_normalizado INTO v_conv FROM public.whatsapp_conversas WHERE id = p_conversa_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT o.id, o.numero, o.token_publico, o.cliente_id INTO v_orc
    FROM public.orcamentos o
   WHERE o.status::text IN ('enviado', 'aprovado')
     AND (o.condicao_pagamento->'pix_enviado'->>'em')::timestamptz > now() - interval '10 days'
     AND ((v_conv.cliente_id IS NOT NULL AND o.cliente_id = v_conv.cliente_id)
          OR (v_conv.telefone_normalizado IS NOT NULL
              AND public.normalize_whatsapp_phone(o.contato_telefone) = v_conv.telefone_normalizado))
   ORDER BY (o.condicao_pagamento->'pix_enviado'->>'em')::timestamptz DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', v_orc.id, 'numero', v_orc.numero, 'token', v_orc.token_publico, 'cliente_id', v_orc.cliente_id);
END $function$;
REVOKE ALL ON FUNCTION public.orcamento_do_pix_da_conversa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_do_pix_da_conversa(uuid) TO service_role;
